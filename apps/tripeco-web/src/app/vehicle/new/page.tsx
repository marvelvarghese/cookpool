"use client";

// Add a vehicle (canvas AddVehicle): what it runs on, name, plate, odometer,
// a rough mileage and price (full tanks soon teach the real ones), and wear
// per km if you want riders to pay it too.

import * as React from "react";
import { useRouter } from "next/navigation";
import type { TripecoFuel } from "@saas/sdk";
import { Icon } from "@/components/icons";
import { Screen, SignedIn } from "@/components/ui";
import { errorText, newIdempotencyKey, useSession } from "@/lib/session";
import { parseRupees } from "@/lib/money";
import { FUEL_LABEL, UNIT_WORDS, unitOf } from "@/lib/units";

const HINTS: Record<TripecoFuel, { mileage: string; price: string }> = {
  petrol: { mileage: "18", price: "104.0" },
  diesel: { mileage: "15", price: "92.5" },
  cng: { mileage: "24", price: "88.0" },
  electric: { mileage: "7", price: "9.5" },
};

export default function AddVehiclePage() {
  return (
    <SignedIn>
      <AddVehicle />
    </SignedIn>
  );
}

function AddVehicle() {
  const router = useRouter();
  const { client } = useSession();
  const [fuel, setFuel] = React.useState<TripecoFuel>("petrol");
  const [name, setName] = React.useState("");
  const [plate, setPlate] = React.useState("");
  const [odo, setOdo] = React.useState("");
  const [mileage, setMileage] = React.useState("");
  const [price, setPrice] = React.useState("");
  const [wear, setWear] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const words = UNIT_WORDS[unitOf(fuel)];
  const ok = name.trim() !== "" && Number(mileage || HINTS[fuel].mileage) > 0;

  async function add() {
    setBusy(true);
    setError(null);
    try {
      const { vehicle } = await client.tripeco.createVehicle(
        {
          name: name.trim(),
          plate: plate.trim() || null,
          fuel,
          odometerKm: Number(odo.replace(/,/g, "")) || 0,
          mileage: Number(mileage || HINTS[fuel].mileage),
          priceMinor: parseRupees(price || HINTS[fuel].price) ?? 0,
          wearMinorPerKm: parseRupees(wear || "0") ?? 0,
        },
        { idempotencyKey: newIdempotencyKey() },
      );
      router.replace(`/vehicle?id=${vehicle.id}`);
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  }

  return (
    <Screen close="/vehicles" title="Add a vehicle">
      <div role="radiogroup" aria-label="Runs on" style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 8 }}>
        {(Object.keys(FUEL_LABEL) as TripecoFuel[]).map((f) => (
          <button key={f} className="choice" role="radio" aria-checked={fuel === f} onClick={() => setFuel(f)} style={{ alignItems: "center", gap: 6, padding: "12px 4px", color: fuel === f ? "var(--lime)" : "var(--soft)" }}>
            <Icon name={f === "electric" ? "bolt" : "car"} size={20} />
            <span style={{ fontSize: 13, color: "inherit", fontWeight: 600 }}>{FUEL_LABEL[f]}</span>
          </button>
        ))}
      </div>
      <div className="card stack-fields">
        <label className="field">
          <span>Name</span>
          <input placeholder="Swift, Dad's Innova…" value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="field">
          <span>Plate</span>
          <input placeholder="KL 07 AB 1234" value={plate} onChange={(e) => setPlate(e.target.value)} />
        </label>
        <label className="field">
          <span>Odometer</span>
          <input className="mono" inputMode="numeric" placeholder="48,410" value={odo} onChange={(e) => setOdo(e.target.value)} />
        </label>
      </div>
      <div className="card grid2">
        <label className="field">
          <span>{words.mileage}</span>
          <input inputMode="decimal" placeholder={HINTS[fuel].mileage} value={mileage} onChange={(e) => setMileage(e.target.value)} />
        </label>
        <label className="field">
          <span>{fuel === "electric" ? "₹ per kWh · home" : words.price.replace(" / ", " per ")}</span>
          <input inputMode="decimal" placeholder={HINTS[fuel].price} value={price} onChange={(e) => setPrice(e.target.value)} />
        </label>
      </div>
      <label className="card field" style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <span style={{ fontSize: 15, fontWeight: 500, color: "var(--text)" }}>Wear &amp; tear</span>
          <span style={{ fontSize: 12, color: "var(--muted)" }}>₹ per km · optional</span>
        </span>
        <input inputMode="decimal" placeholder="0" value={wear} onChange={(e) => setWear(e.target.value)} style={{ width: 80, textAlign: "right" }} />
      </label>
      {error ? <p className="error" role="alert">{error}</p> : null}
      <div style={{ height: 70 }} />
      <div className="foot">
        <div className="foot-inner">
          <button className="btn" disabled={busy || !ok} onClick={() => void add()}>Add vehicle</button>
        </div>
      </div>
    </Screen>
  );
}
