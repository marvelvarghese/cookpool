"use client";

// Scan (canvas ScanOdo): a photo of the odometer at the start and at the end
// — or reset Trip A, drive, and one photo at the end, which may also read the
// car's average (design §0.7). Every reading is shown beside its photo to
// check (Retake · Use) or type (risk TR-A). The photos stay on the ride as
// proof. A ride in progress lives on the server, so leaving and coming back
// (Home's "end km · Add") picks up at the end photo.
//
//   /scan?vehicle=veh_…&group=org_…   start a ride
//   /scan?ride=trp_…                  its end photo

import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import type { TripecoRide, TripecoVehicle } from "@saas/sdk";
import type { AiOdometerResponse } from "@saas/contracts/kitchen";
import { Icon } from "@/components/icons";
import { Sheet, SignedIn } from "@/components/ui";
import { errorText, newIdempotencyKey, useSession } from "@/lib/session";
import { shrink, type Shot } from "@/lib/photo";
import { km as kmText, rupees } from "@/lib/money";
import { UNIT_WORDS } from "@/lib/units";

type Step = "aimStart" | "tripStart" | "riding" | "aimEnd" | "done";

export default function ScanPage() {
  return (
    <SignedIn>
      <Scan />
    </SignedIn>
  );
}

function Scan() {
  const params = useSearchParams();
  const router = useRouter();
  const { client } = useSession();
  const rideParam = params.get("ride");
  const [vehicles, setVehicles] = React.useState<TripecoVehicle[] | null>(null);
  const [vehicleId, setVehicleId] = React.useState<string | null>(params.get("vehicle"));
  const [groupId] = React.useState<string | null>(params.get("group"));
  const [ride, setRide] = React.useState<TripecoRide | null>(null);
  const [mode, setMode] = React.useState<"odo" | "trip">("odo");
  const [step, setStep] = React.useState<Step>(rideParam ? "aimEnd" : "aimStart");
  const [shot, setShot] = React.useState<Shot | null>(null);
  const [reading, setReading] = React.useState<{ value: string; average: number | null; note: string | null } | null>(null);
  const [scanning, setScanning] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [startShot, setStartShot] = React.useState<string | null>(null);
  const input = React.useRef<HTMLInputElement | null>(null);

  React.useEffect(() => {
    void client.tripeco.me().then((r) => {
      setVehicles(r.vehicles);
      setVehicleId((v) => v ?? r.vehicles[0]?.id ?? null);
    });
  }, [client]);
  React.useEffect(() => {
    if (!rideParam) return;
    void client.tripeco.ride(rideParam).then(
      (r) => {
        setRide(r.ride);
        setMode(r.ride.mode);
        setStep(r.ride.state === "open" ? "riding" : "aimEnd");
      },
      (err: unknown) => setError(errorText(err)),
    );
  }, [client, rideParam]);

  const vehicle = vehicles?.find((v) => v.id === (ride?.vehicleId ?? vehicleId)) ?? null;
  const atEnd = step === "aimEnd";
  const readTrip = mode === "trip" && atEnd;
  const label = readTrip ? "Trip A" : atEnd ? "End odometer" : "Start odometer";

  async function onPhoto(file: File | undefined) {
    if (!file) return;
    setScanning(true);
    setError(null);
    try {
      const s = await shrink(file);
      setShot(s);
      let read: AiOdometerResponse | null = null;
      let note: string | null = null;
      try {
        read = await client.kitchen.aiOdometer(s.base64, readTrip ? "trip" : "odo");
      } catch (err) {
        note = errorText(err);
      }
      const value = readTrip ? read?.tripKm : read?.odometerKm;
      setReading({ value: value === null || value === undefined ? "" : String(value), average: readTrip ? (read?.averageKmPer ?? null) : null, note: value === null || value === undefined ? (note ?? "Couldn't read it — type it") : null });
    } catch {
      setReading({ value: "", average: null, note: "Couldn't open that photo — type it" });
    } finally {
      setScanning(false);
      if (input.current) input.current.value = "";
    }
  }

  async function use() {
    if (!reading) return;
    const value = Number(reading.value.replace(/,/g, ""));
    if (!Number.isFinite(value) || value < 0 || reading.value.trim() === "") return;
    setBusy(true);
    setError(null);
    try {
      if (!atEnd) {
        if (!vehicle) return;
        const { ride: r } = await client.tripeco.startRide(
          { vehicleId: vehicle.id, mode: "odo", startKm: value, ...(groupId ? { groupId } : {}) },
          { idempotencyKey: newIdempotencyKey() },
        );
        if (shot) await client.tripeco.putPhoto(r.id, { role: "start", image: shot.base64 }).catch(() => undefined);
        setStartShot(shot?.url ?? null);
        setRide(r);
        window.history.replaceState(null, "", `/scan?ride=${r.id}`);
        setStep("riding");
      } else if (ride) {
        // The car's own average is offered on Done; the ride keeps the learned one until picked (design §0.5).
        const patch = readTrip ? { tripKm: value, carAverage: reading.average } : { endKm: value };
        const { ride: r } = await client.tripeco.updateRide(ride.id, patch);
        if (shot) await client.tripeco.putPhoto(r.id, { role: "end", image: shot.base64 }).catch(() => undefined);
        setRide(r);
        setStep("done");
      }
      setReading(null);
      setShot(null);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  // Manual entry (no photo): a past trip, or no camera — New ride takes both readings typed.
  async function typeBoth() {
    if (!vehicle) return;
    setBusy(true);
    try {
      const start = Number((reading?.value ?? "").replace(/,/g, ""));
      const { ride: r } = await client.tripeco.startRide(
        { vehicleId: vehicle.id, mode: "odo", startKm: reading?.value.trim() && Number.isFinite(start) ? start : vehicle.odometerKm, ...(groupId ? { groupId } : {}) },
        { idempotencyKey: newIdempotencyKey() },
      );
      router.replace(`/ride?id=${r.id}`);
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  }

  async function startTrip() {
    if (!vehicle) return;
    setBusy(true);
    try {
      const { ride: r } = await client.tripeco.startRide({ vehicleId: vehicle.id, mode: "trip", ...(groupId ? { groupId } : {}) }, { idempotencyKey: newIdempotencyKey() });
      setRide(r);
      window.history.replaceState(null, "", `/scan?ride=${r.id}`);
      setStep("riding");
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  async function pickMileage(source: "learned" | "car") {
    if (!ride) return;
    const { ride: r } = await client.tripeco.updateRide(ride.id, { mileageSource: source });
    setRide(r);
  }

  // ── Riding ──
  if (step === "riding" && ride) {
    const started = new Date(ride.startedAt).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" });
    return (
      <div className="app">
        <main className="page" style={{ minHeight: "100dvh" }}>
          <header className="head">
            <Link href="/" className="icon-btn plain" aria-label="Home"><Icon name="back" /></Link>
            <span />
            <span style={{ width: 40 }} />
          </header>
          <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 10, textAlign: "center" }}>
            <span className="chip" style={{ background: "var(--lime-tint)" }}>
              <span style={{ width: 8, height: 8, borderRadius: 4, background: "var(--lime)" }} />
              Trip on
            </span>
            <span style={{ fontSize: 28, fontWeight: 500 }}>{ride.vehicleName}</span>
            <span className="muted mono">{ride.mode === "trip" ? `Trip A from 0.0 · ${started}` : `From ${kmText(ride.startKm)} km · ${started}`}</span>
          </div>
          <div className="foot">
            <div className="foot-inner">
              <button className="btn" onClick={() => setStep("aimEnd")}>
                <Icon name="camera" />
                End trip · photo
              </button>
            </div>
          </div>
        </main>
      </div>
    );
  }

  // ── Done ──
  if (step === "done" && ride) {
    const words = UNIT_WORDS[ride.unit];
    const litres = ride.km !== null && ride.mileage > 0 ? (ride.km / ride.mileage).toFixed(1) : "—";
    const learned = ride.learnedMileage;
    return (
      <div className="app">
        <main className="page" style={{ minHeight: "100dvh" }}>
          <header className="head">
            <Link href="/" className="icon-btn plain" aria-label="Home"><Icon name="close" /></Link>
            <span className="title">Trip done</span>
            <span style={{ width: 40 }} />
          </header>
          <div className="total">
            <b>{rupees(ride.fuelMinor + ride.wearMinor)}</b>
            <span>{kmText(ride.km)} km · {litres} {words.short}</span>
          </div>
          <div className="two">
            {(ride.mode === "trip" ? [{ v: "0.0", l: "Trip reset" }, { v: kmText(ride.tripKm), l: "End" }] : [{ v: kmText(ride.startKm), l: "Start" }, { v: kmText(ride.endKm), l: "End" }]).map((p, i) => (
              <div key={p.l} className="card" style={{ padding: 0, position: "relative", height: 96, display: "flex", flexDirection: "column", justifyContent: "flex-end", gap: 2, paddingLeft: 14, paddingBottom: 12 }}>
                {i === 0 && startShot ? <img src={startShot} alt="" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", opacity: 0.35 }} /> : null}
                <span className="mono" style={{ position: "relative", fontSize: 20 }}>{p.v}</span>
                <span className="label" style={{ position: "relative" }}>{p.l}</span>
              </div>
            ))}
          </div>
          {ride.carAverage ? (
            <div role="radiogroup" aria-label="Mileage" className="two">
              <button className="choice" role="radio" aria-checked={ride.mileageSource !== "car"} onClick={() => void pickMileage("learned")}>
                <b>{learned} {words.mileage}</b>
                <span>Learned</span>
              </button>
              <button className="choice" role="radio" aria-checked={ride.mileageSource === "car"} onClick={() => void pickMileage("car")}>
                <b>{ride.carAverage} {words.mileage}</b>
                <span>Car display</span>
              </button>
            </div>
          ) : null}
          <div className="foot">
            <div className="foot-inner two">
              <Link href={`/ride?id=${ride.id}`} className="btn ghost">Fix numbers</Link>
              <Link href={ride.groupId ? `/split?id=${ride.id}` : `/ride?id=${ride.id}`} className="btn">Split</Link>
            </div>
          </div>
        </main>
      </div>
    );
  }

  // ── Camera ──
  return (
    <div className="app" style={{ background: "#000" }}>
      <main className="page" style={{ minHeight: "100dvh", background: "#000" }}>
        <header className="head">
          <Link href="/" className="icon-btn plain" aria-label="Close"><Icon name="close" /></Link>
          <span className="title">{atEnd ? "Trip end photo" : "Trip start photo"}</span>
          {!ride && vehicles && vehicles.length > 1 ? (
            <button
              className="chip"
              onClick={() => {
                const i = vehicles.findIndex((v) => v.id === vehicleId);
                setVehicleId(vehicles[(i + 1) % vehicles.length]!.id);
              }}
            >
              {vehicle?.name}
              <Icon name="down" size={14} />
            </button>
          ) : (
            <span className="chip">{vehicle?.name ?? ride?.vehicleName ?? ""}</span>
          )}
        </header>

        <div style={{ position: "relative", aspectRatio: "3 / 4", borderRadius: 24, overflow: "hidden", background: "#111316", display: "flex", alignItems: "center", justifyContent: "center" }}>
          {shot ? <img src={shot.url} alt="The photo" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : null}
          <div aria-hidden="true" style={{ position: "absolute", left: "12%", right: "12%", top: readTrip ? "52%" : "40%", height: readTrip ? 44 : 64, border: "2px solid var(--lime)", borderRadius: 14, boxShadow: "0 0 0 2000px rgba(0,0,0,.35)" }} />
          {scanning ? <span className="mono" style={{ position: "absolute", bottom: 18, color: "var(--lime)" }}>Reading…</span> : null}
        </div>

        {!ride ? (
          <div className="seg" role="radiogroup" aria-label="What to read">
            <button role="radio" aria-checked={mode === "odo"} onClick={() => { setMode("odo"); setStep("aimStart"); }}>Odometer</button>
            <button role="radio" aria-checked={mode === "trip"} onClick={() => { setMode("trip"); setStep("tripStart"); }}>Trip reset</button>
          </div>
        ) : null}

        {step === "tripStart" ? (
          <div className="stack" style={{ alignItems: "center", textAlign: "center" }}>
            <span className="muted">Reset Trip A to 0, then drive</span>
            <button className="btn" disabled={busy || !vehicle} onClick={() => void startTrip()}>Reset done · start trip</button>
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr", alignItems: "center", padding: "6px 10px" }}>
            <button className="chip" style={{ justifySelf: "start", color: "var(--text)" }} onClick={() => setReading({ value: "", average: null, note: null })}>Type km</button>
            <label aria-label="Take photo" style={{ width: 76, height: 76, borderRadius: "50%", border: "4px solid var(--text)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
              <span style={{ width: 58, height: 58, borderRadius: "50%", background: scanning ? "var(--lime)" : "var(--text)" }} />
              <input ref={input} type="file" accept="image/*" capture="environment" className="sr-only" disabled={scanning || (!atEnd && !vehicle)} onChange={(ev) => void onPhoto(ev.target.files?.[0])} />
            </label>
            <span />
          </div>
        )}
        {!vehicle && vehicles?.length === 0 ? <Link href="/vehicle/new" className="btn ghost">Add a vehicle first</Link> : null}
        {error ? <p className="error" role="alert">{error}</p> : null}
      </main>

      {reading ? (
        <Sheet label="Check the reading" onClose={() => setReading(null)}>
          <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
            <div aria-hidden="true" style={{ width: 96, height: 72, borderRadius: 14, overflow: "hidden", background: "#111316", flex: "none" }}>
              {shot ? <img src={shot.url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : null}
            </div>
            <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 4 }}>
              <span className="label">{label}</span>
              <label style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
                <input
                  className="mono"
                  inputMode="decimal"
                  autoFocus
                  value={reading.value}
                  aria-label={label}
                  onChange={(ev) => setReading({ ...reading, value: ev.target.value })}
                  style={{ width: "100%", background: "none", border: 0, fontSize: 30, color: "var(--text)", outline: "none", padding: 0 }}
                />
                <span className="muted">km</span>
              </label>
            </div>
          </div>
          {reading.note ? <p className="muted" style={{ margin: 0, fontSize: 13 }}>{reading.note}</p> : null}
          {reading.average ? (
            <div className="row-between" style={{ background: "var(--card-2)", borderRadius: 14, padding: "12px 14px" }}>
              <span className="muted">Car says</span>
              <span>{reading.average} {vehicle ? UNIT_WORDS[vehicle.unit].mileage : ""}</span>
            </div>
          ) : null}
          {!atEnd && !shot ? (
            <button className="link-btn" disabled={busy || !vehicle} onClick={() => void typeBoth()}>
              Enter start and end
            </button>
          ) : null}
          <div className="two">
            <button
              className="btn ghost"
              onClick={() => {
                setReading(null);
                input.current?.click();
              }}
            >
              {shot ? "Retake" : "Photo"}
            </button>
            <button className="btn" disabled={busy || reading.value.trim() === ""} onClick={() => void use()}>Use</button>
          </div>
        </Sheet>
      ) : null}
    </div>
  );
}
