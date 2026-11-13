"use client";

// Log fuel / Log charge (canvas LogFuel): paid, how much, the odometer, full
// tank or part fill, and who paid. A full tank teaches the real mileage: the
// line under it shows what this fill-up makes it (design §0.5). Never leaves
// Tripeco (§0.9).

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { learnedMileage } from "@saas/kitchen-engine/drive";
import type { TripecoVehicleResponse } from "@saas/sdk";
import { Icon } from "@/components/icons";
import { Screen, SignedIn } from "@/components/ui";
import { errorText, newIdempotencyKey, useSession } from "@/lib/session";
import { parseRupees, rupeesDecimal } from "@/lib/money";
import { UNIT_WORDS } from "@/lib/units";

export default function FuelPage() {
  return (
    <SignedIn>
      <Fuel />
    </SignedIn>
  );
}

function Fuel() {
  const router = useRouter();
  const { client } = useSession();
  const [vehicleId, setVehicleId] = React.useState<string | null>(useSearchParams().get("vehicle"));
  const [ids, setIds] = React.useState<string[]>([]);
  const [data, setData] = React.useState<TripecoVehicleResponse | null>(null);
  const [amount, setAmount] = React.useState("");
  const [qty, setQty] = React.useState("");
  const [odo, setOdo] = React.useState("");
  const [full, setFull] = React.useState(true);
  const [paidBy, setPaidBy] = React.useState<"me" | "rider">("me");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    void client.tripeco.vehicles().then((r) => {
      setIds(r.vehicles.map((v) => v.id));
      setVehicleId((v) => v ?? r.vehicles[0]?.id ?? null);
    });
  }, [client]);
  React.useEffect(() => {
    if (!vehicleId) return;
    void client.tripeco.vehicle(vehicleId).then(setData, (err: unknown) => setError(errorText(err)));
  }, [client, vehicleId]);

  if (!data) return <Screen close="/">{error ? <p className="error">{error}</p> : <p className="spinner">Loading…</p>}</Screen>;
  const v = data.vehicle;
  const ev = v.fuel === "electric";
  const words = UNIT_WORDS[v.unit];
  const paid = parseRupees(amount) ?? 0;
  const q = Number(qty);
  const odometer = Number(odo || v.odometerKm);
  const rate = q > 0 ? Math.round(paid / q) : 0;
  const after =
    full && q > 0 && odometer > 0
      ? learnedMileage([
          ...data.fuel.map((f) => ({ odometerKm: f.odometerKm, quantityMilli: Math.round(f.quantity * 1000), amountMinor: f.amountMinor, full: f.full, loggedAt: f.loggedAt })),
          { odometerKm: odometer, quantityMilli: Math.round(q * 1000), amountMinor: paid, full: true, loggedAt: new Date().toISOString() },
        ]).mileage
      : null;

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await client.tripeco.logFuel(v.id, { amountMinor: paid, quantity: q, odometerKm: odometer, full, paidBy }, { idempotencyKey: newIdempotencyKey() });
      router.replace(`/vehicle?id=${v.id}`);
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  }

  return (
    <Screen
      close="/"
      title={ev ? "Log charge" : "Log fuel"}
      action={
        ids.length > 1 ? (
          <button className="chip" onClick={() => setVehicleId(ids[(ids.indexOf(v.id) + 1) % ids.length]!)}>
            {v.name}
            <Icon name="down" size={14} />
          </button>
        ) : (
          <span className="chip">{v.name}</span>
        )
      }
    >
      <label className="total" style={{ gap: 6 }}>
        <span>Paid</span>
        <span style={{ display: "flex", alignItems: "baseline", gap: 4, color: "var(--money)", fontSize: 44, fontWeight: 500 }}>
          ₹
          <input
            inputMode="decimal"
            aria-label="Amount paid"
            placeholder="0"
            value={amount}
            autoFocus
            onChange={(e) => setAmount(e.target.value)}
            style={{ width: 180, background: "none", border: 0, color: "var(--money)", fontSize: 44, fontWeight: 500, outline: "none", padding: 0 }}
          />
        </span>
      </label>

      <div className="card grid2">
        <label className="field">
          <span>{words.qty}</span>
          <input inputMode="decimal" value={qty} placeholder="0" onChange={(e) => setQty(e.target.value)} />
        </label>
        <div className="field">
          <span>{words.price.replace(" / ", " per ")}</span>
          <span className="value">{rate ? rupeesDecimal(rate) : "—"}</span>
        </div>
        <label className="field">
          <span>Odometer</span>
          <input className="mono" inputMode="numeric" placeholder={String(v.odometerKm)} value={odo} onChange={(e) => setOdo(e.target.value)} />
        </label>
        <button className="field" aria-pressed={full} onClick={() => setFull(!full)} style={{ border: 0, background: "none", textAlign: "left", flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
          <span style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ fontSize: 12, color: "var(--muted)" }}>{ev ? "Battery" : "Tank"}</span>
            <span style={{ fontSize: 16, fontWeight: 500 }}>{full ? (ev ? "Charged to 100%" : "Full tank") : ev ? "Top-up" : "Part fill"}</span>
          </span>
          <span className="toggle" aria-hidden="true" />
        </button>
      </div>

      <div role="status" className="card" style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 16px", background: after ? "rgba(94,234,212,.08)" : "var(--card)", color: after ? "var(--get)" : "var(--muted)" }}>
        <Icon name="fuel" size={20} />
        <span style={{ fontSize: 15, fontWeight: 500 }}>{after ? `${after} ${words.mileage}` : `${v.mileage} ${words.mileage}`}</span>
      </div>

      <div className="two" role="radiogroup" aria-label="Who paid">
        {(["me", "rider"] as const).map((p) => (
          <button key={p} className="choice" role="radio" aria-checked={paidBy === p} onClick={() => setPaidBy(p)} style={{ alignItems: "center" }}>
            <b style={{ fontSize: 15 }}>{p === "me" ? "I paid" : "A rider paid"}</b>
          </button>
        ))}
      </div>

      {error ? <p className="error" role="alert">{error}</p> : null}
      <div style={{ height: 70 }} />
      <div className="foot">
        <div className="foot-inner">
          <button className="btn" disabled={busy || paid <= 0 || !(q > 0)} onClick={() => void save()}>Save</button>
        </div>
      </div>
    </Screen>
  );
}
