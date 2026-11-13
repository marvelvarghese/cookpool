"use client";

// Vehicles: one row per vehicle — its mileage and where that figure came from — and Add a vehicle.

import Link from "next/link";
import type { TripecoMeResponse } from "@saas/contracts/tripeco";
import { Icon } from "../icons";
import { Loading, type Load } from "../ui";
import { rupeesDecimal } from "@/lib/money";
import { UNIT_WORDS } from "@/lib/units";

export function VehiclesTab({ load }: { load: Load<TripecoMeResponse> }) {
  return (
    <>
      <header className="head">
        <h1 className="h1">Vehicles</h1>
        <Link href="/vehicle/new" className="icon-btn" aria-label="Add a vehicle">
          <Icon name="plus" size={20} />
        </Link>
      </header>
      <Loading load={load}>
        {load.data && load.data.vehicles.length > 0 ? (
          <div className="card rows">
            {load.data.vehicles.map((v) => (
              <Link key={v.id} href={`/vehicle?id=${v.id}`} className="row">
                <span className="tile lime">
                  <Icon name={v.fuel === "electric" ? "bolt" : "car"} size={20} />
                </span>
                <span className="grow">
                  <span className="t">{v.name}</span>
                  <span className="s">
                    {v.mileage} {UNIT_WORDS[v.unit].mileage} · {v.mileageSource === "learned" ? "Learned" : "Estimate"}
                  </span>
                </span>
                <span className="amt" style={{ color: "var(--lime)" }}>{rupeesDecimal(v.perKmMinor)}/km</span>
              </Link>
            ))}
          </div>
        ) : (
          <Link href="/vehicle/new" className="add-veh">
            <Icon name="plus" size={20} />
            Add a vehicle
          </Link>
        )}
      </Loading>
    </>
  );
}
