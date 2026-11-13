"use client";

// Vehicle (canvas Vehicle): the odometer, the real mileage with its last six
// full-tank segments as bars, this month's fuel split You · Riders, wear per
// km (− / +), and the fuel log — swipe a fill-up left to delete, with Undo
// (held UNDO_MS before it is sent, so Undo is real).

import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import type { TripecoVehicleResponse } from "@saas/sdk";
import { SwipeRow } from "@saas/gestures/react/swipe-row";
import { Icon } from "@/components/icons";
import { Screen, Sheet, SignedIn, useLoad, useToast, Loading } from "@/components/ui";
import { DelayedSends } from "@/lib/delayed";
import { errorText, useSession } from "@/lib/session";
import { km as kmText, rupees, rupeesDecimal } from "@/lib/money";
import { UNIT_WORDS } from "@/lib/units";

export default function VehiclePage() {
  return (
    <SignedIn>
      <Vehicle />
    </SignedIn>
  );
}

const MONTH = (iso: string) => new Date(`${iso}-01T00:00:00Z`).toLocaleString("en-IN", { month: "long", timeZone: "UTC" });
const DAY = (iso: string) => new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short" });

function Vehicle() {
  const id = useSearchParams().get("id");
  const router = useRouter();
  const { client } = useSession();
  const load = useLoad((c) => (id ? c.tripeco.vehicle(id) : Promise.reject(new Error("No vehicle"))), [id]);
  const { toast, show } = useToast();
  const [gone, setGone] = React.useState<Set<string>>(new Set());
  const [more, setMore] = React.useState(false);
  const sends = React.useMemo(() => new DelayedSends(), []);
  React.useEffect(() => {
    const leave = () => sends.flush();
    window.addEventListener("pagehide", leave);
    return () => {
      window.removeEventListener("pagehide", leave);
      sends.flush();
    };
  }, [sends]);

  const data: TripecoVehicleResponse | null = load.data;

  function remove(fuelId: string) {
    setGone((g) => new Set(g).add(fuelId));
    sends.schedule(fuelId, () => {
      client.tripeco.deleteFuel(fuelId).then(
        () => void load.reload(),
        (err: unknown) => {
          setGone((g) => {
            const n = new Set(g);
            n.delete(fuelId);
            return n;
          });
          show(`Not deleted · ${errorText(err)}`);
        },
      );
    });
    show("Deleted", () => {
      if (sends.undo(fuelId)) {
        setGone((g) => {
          const n = new Set(g);
          n.delete(fuelId);
          return n;
        });
      }
    });
  }

  async function wear(delta: number) {
    if (!data) return;
    const next = Math.max(0, Math.min(1000, data.vehicle.wearMinorPerKm + delta));
    load.set({ ...data, vehicle: { ...data.vehicle, wearMinorPerKm: next } });
    try {
      load.set(await client.tripeco.updateVehicle(data.vehicle.id, { wearMinorPerKm: next }));
    } catch (err) {
      show(errorText(err));
      void load.reload();
    }
  }

  async function archive() {
    if (!data) return;
    await client.tripeco.archiveVehicle(data.vehicle.id).catch(() => undefined);
    router.replace("/vehicles");
  }

  return (
    <Screen
      back="/vehicles"
      action={
        <button className="icon-btn" aria-label="More" onClick={() => setMore(true)}>
          <span aria-hidden="true" style={{ fontSize: 18, lineHeight: 1 }}>⋯</span>
        </button>
      }
    >
      <Loading load={load}>
        {data ? (
          <>
            <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
              <span className="veh-mark" style={{ width: 56, height: 56, borderRadius: 18 }}>
                <Icon name={data.vehicle.fuel === "electric" ? "bolt" : "car"} size={26} />
              </span>
              <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                <h1 className="h1">{data.vehicle.name}</h1>
                <span className="muted mono">{kmText(data.vehicle.odometerKm)} km</span>
              </div>
            </div>

            <Mileage data={data} />

            <section aria-label={MONTH(data.vehicle.month.month)} className="card" style={{ padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
              <div className="row-between">
                <span className="label">{MONTH(data.vehicle.month.month)} {data.vehicle.fuel === "electric" ? "charging" : "fuel"}</span>
                <span style={{ fontSize: 17, fontWeight: 500, color: "var(--money)" }}>{rupees(data.vehicle.month.fuelMinor)}</span>
              </div>
              <MonthBar you={data.vehicle.month.youMinor} riders={data.vehicle.month.ridersMinor} />
            </section>

            <section aria-label="Wear and tear" className="card" style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 12px 12px 16px" }}>
              <span style={{ flex: 1, display: "flex", flexDirection: "column", gap: 2 }}>
                <span style={{ fontSize: 15, fontWeight: 500 }}>Wear &amp; tear</span>
                <span style={{ fontSize: 12, color: "var(--muted)" }}>{data.vehicle.wearMinorPerKm ? "Riders pay it too" : "Fuel only"}</span>
              </span>
              <button className="icon-btn" aria-label="Less wear per km" onClick={() => void wear(-50)}><Icon name="minus" size={18} /></button>
              <span style={{ minWidth: 74, textAlign: "center", fontWeight: 600, color: data.vehicle.wearMinorPerKm ? "var(--lime)" : "var(--muted)" }}>
                {data.vehicle.wearMinorPerKm ? `${rupeesDecimal(data.vehicle.wearMinorPerKm)}/km` : "Off"}
              </span>
              <button className="icon-btn" aria-label="More wear per km" onClick={() => void wear(50)}><Icon name="plus" size={18} /></button>
            </section>

            <section aria-label="Fuel log" className="stack">
              <div className="row-between">
                <span className="label">{data.vehicle.fuel === "electric" ? "Charge log" : "Fuel log"}</span>
                <Link href={`/fuel?vehicle=${data.vehicle.id}`} style={{ fontSize: 13, fontWeight: 600 }}>{data.vehicle.fuel === "electric" ? "Log charge" : "Log fuel"}</Link>
              </div>
              <div className="card rows">
                {data.fuel
                  .filter((f) => !gone.has(f.id))
                  .map((f) => (
                    <SwipeRow
                      key={f.id}
                      actionTone="red"
                      action={<button onClick={() => remove(f.id)} aria-label={`Delete ${DAY(f.loggedAt)}`}>Delete</button>}
                      onFire={() => remove(f.id)}
                    >
                      <div className="row" style={{ minHeight: 60 }}>
                        <span className="grow">
                          <span className="t">{DAY(f.loggedAt)}</span>
                          <span className="s">{f.paidBy === "rider" ? "A rider paid" : `${f.quantity} ${UNIT_WORDS[data.vehicle.unit].short}${f.full ? " · full" : ""}`}</span>
                        </span>
                        <span className="amt">{rupees(f.amountMinor)}</span>
                      </div>
                    </SwipeRow>
                  ))}
                {data.fuel.length === 0 ? <div className="row"><span className="muted">No fill-ups yet</span></div> : null}
              </div>
            </section>
          </>
        ) : null}
      </Loading>
      {more ? (
        <Sheet label="Vehicle" onClose={() => setMore(false)}>
          <button className="btn danger" onClick={() => void archive()}>Remove vehicle</button>
        </Sheet>
      ) : null}
      {toast}
    </Screen>
  );
}

function Mileage({ data }: { data: TripecoVehicleResponse }) {
  const v = data.vehicle;
  const words = UNIT_WORDS[v.unit];
  const segs = data.segments;
  const lo = Math.min(...segs.map((s) => s.mileage), v.mileage) - 0.5;
  const hi = Math.max(...segs.map((s) => s.mileage), v.mileage);
  return (
    <section aria-label="Mileage" className="card" style={{ padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
      <span className="label">{v.mileageSource === "learned" ? "Real mileage" : "Estimate"}</span>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
        <span style={{ fontSize: 40, fontWeight: 500 }}>{v.mileage}</span>
        <span className="muted">{words.mileage}</span>
        <span style={{ marginLeft: "auto", fontSize: 17, fontWeight: 500, color: "var(--lime)" }}>
          {rupeesDecimal(v.perKmMinor)}<span className="muted" style={{ fontSize: 13 }}> /km</span>
        </span>
      </div>
      {segs.length > 0 ? (
        <div role="img" aria-label={`Mileage across the last ${segs.length} full tanks, from ${Math.min(...segs.map((s) => s.mileage))} to ${Math.max(...segs.map((s) => s.mileage))} ${words.mileage}`} style={{ display: "flex", alignItems: "flex-end", gap: 8, height: 54 }}>
          {segs.map((s, i) => (
            <div key={s.endKm} style={{ flex: 1, height: `${Math.max(14, ((s.mileage - lo) / Math.max(0.1, hi - lo)) * 100)}%`, borderRadius: 6, background: i === segs.length - 1 ? "var(--lime)" : "var(--border)" }} />
          ))}
        </div>
      ) : null}
    </section>
  );
}

function MonthBar({ you, riders }: { you: number; riders: number }) {
  const total = Math.max(1, you + riders);
  return (
    <>
      <div aria-hidden="true" style={{ display: "flex", height: 10, borderRadius: 5, overflow: "hidden", background: "var(--card-2)" }}>
        <div style={{ width: `${(you / total) * 100}%`, background: "var(--money)" }} />
        <div style={{ width: `${(riders / total) * 100}%`, background: "var(--get)" }} />
      </div>
      <div className="two">
        <div className="figure">
          <b style={{ fontSize: 17 }}>{rupees(you)}</b>
          <span style={{ display: "flex", alignItems: "center", gap: 6 }}><span style={{ width: 8, height: 8, borderRadius: 4, background: "var(--money)" }} />You</span>
        </div>
        <div className="figure">
          <b style={{ fontSize: 17 }}>{rupees(riders)}</b>
          <span style={{ display: "flex", alignItems: "center", gap: 6 }}><span style={{ width: 8, height: 8, borderRadius: 4, background: "var(--get)" }} />Riders</span>
        </div>
      </div>
    </>
  );
}
