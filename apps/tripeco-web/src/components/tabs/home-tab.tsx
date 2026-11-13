"use client";

// Home (canvas Main): the vehicle cards (swipe between them; the dots are
// the twin), Start trip · Log fuel, what needs you (or All caught up), and
// the recent rides. One line per row, no helper copy.

import * as React from "react";
import Link from "next/link";
import type { TripecoMeResponse, TripecoNeed, TripecoRide, TripecoVehicle } from "@saas/contracts/tripeco";
import { Icon } from "../icons";
import { Loading, Sheet, type Load } from "../ui";
import { useMe } from "@/lib/me";
import { errorText, newIdempotencyKey, useSession } from "@/lib/session";
import { needLine } from "@/lib/home";
import { rupees, rupeesDecimal } from "@/lib/money";
import { initialOf } from "@/lib/people";
import { rideAmount } from "@/lib/rides";

const MONTH = (iso: string) => new Date(`${iso}-01T00:00:00Z`).toLocaleString("en-IN", { month: "long", timeZone: "UTC" });

export function HomeTab({ load, show }: { load: Load<TripecoMeResponse>; show: (text: string, undo?: () => void) => void }) {
  const { me } = useMe();
  const [account, setAccount] = React.useState(false);
  return (
    <>
      <header className="head">
        <span className="brand">Tripeco</span>
        <button className="face" aria-label="Account" style={{ background: "#1C3357", color: "#93C5FD", border: 0 }} onClick={() => setAccount(true)}>
          {me ? initialOf(me.displayName ?? me.email) : ""}
        </button>
      </header>
      <Loading load={load}>{load.data ? <HomeBody data={load.data} reload={load.reload} show={show} /> : null}</Loading>
      {account ? <AccountSheet onClose={() => setAccount(false)} /> : null}
    </>
  );
}

function HomeBody({ data, reload, show }: { data: TripecoMeResponse; reload: () => Promise<void>; show: (text: string, undo?: () => void) => void }) {
  // The cards scroll natively with snap points, marked `data-no-pager` so the
  // tab pager leaves a swipe that starts on them alone (a pager inside the
  // pager would fight it). The dots are the tap twin.
  const [veh, setVeh] = React.useState(0);
  const scroller = React.useRef<HTMLDivElement | null>(null);
  const count = data.vehicles.length + 1;
  const current: TripecoVehicle | undefined = data.vehicles[Math.min(veh, data.vehicles.length - 1)];
  const q = current ? `?vehicle=${current.id}` : "";
  const onScroll = () => {
    const el = scroller.current;
    if (el && el.clientWidth > 0) setVeh(Math.round(el.scrollLeft / el.clientWidth));
  };
  const go = (i: number) => scroller.current?.scrollTo({ left: i * (scroller.current?.clientWidth ?? 0), behavior: "smooth" });
  return (
    <>
      <div ref={scroller} className="veh-scroller" data-no-pager="" onScroll={onScroll} aria-roledescription="carousel">
        {data.vehicles.map((v) => (
          <div key={v.id} className="veh-slide">
            <VehicleCard v={v} />
          </div>
        ))}
        <div className="veh-slide">
          <Link href="/vehicle/new" className="add-veh">
            <Icon name="plus" size={20} />
            Add a vehicle
          </Link>
        </div>
      </div>
      {count > 1 ? (
        <div className="dots">
          {Array.from({ length: count }, (_, i) => (
            <button key={i} aria-label={i < data.vehicles.length ? data.vehicles[i]!.name : "Add a vehicle"} aria-current={veh === i ? "true" : "false"} onClick={() => go(i)} />
          ))}
        </div>
      ) : null}

      <div className="quick">
        <Link href={current ? `/scan${q}` : "/vehicle/new"} className="go">
          <Icon name="camera" />
          Start trip
        </Link>
        <Link href={current ? `/fuel${q}` : "/vehicle/new"}>
          <Icon name="fuel" size={20} stroke="#C6F432" />
          {current?.fuel === "electric" ? "Log charge" : "Log fuel"}
        </Link>
      </div>

      <Needs needs={data.needs} reload={reload} show={show} />

      {data.rides.length > 0 ? (
        <section aria-label="Recent rides" className="stack">
          <div className="row-between">
            <span className="label">Recent rides</span>
            <Link href="/rides" style={{ fontSize: 13, fontWeight: 500 }}>All</Link>
          </div>
          <div className="card rows">
            {data.rides.slice(0, 5).map((r) => (
              <RideRow key={r.id} ride={r} />
            ))}
          </div>
        </section>
      ) : null}
    </>
  );
}

function VehicleCard({ v }: { v: TripecoVehicle }) {
  return (
    <section aria-label={v.name} className="veh-card">
      <div className="top">
        <span className="veh-mark">
          <Icon name={v.fuel === "electric" ? "bolt" : "car"} />
        </span>
        <span className="name">{v.name}</span>
        <Link href={`/vehicle?id=${v.id}`} aria-label={`Open ${v.name}`} className="icon-btn">
          <Icon name="chevron" size={18} />
        </Link>
      </div>
      <div className="figures">
        <div className="figure">
          <b style={{ color: "var(--lime)" }}>{rupeesDecimal(v.perKmMinor)}</b>
          <span>per km</span>
        </div>
        <div className="figure">
          <b style={{ color: "var(--money)" }}>{rupees(v.month.fuelMinor)}</b>
          <span>{MONTH(v.month.month)}</span>
        </div>
      </div>
    </section>
  );
}

function Needs({ needs, reload, show }: { needs: TripecoNeed[]; reload: () => Promise<void>; show: (text: string, undo?: () => void) => void }) {
  const { client } = useSession();
  const [busy, setBusy] = React.useState<string | null>(null);
  if (needs.length === 0) {
    return (
      <div className="caught-up">
        <Icon name="check" size={20} />
        All caught up
      </div>
    );
  }
  async function post(n: TripecoNeed) {
    setBusy(n.rideId);
    try {
      await client.tripeco.postRide(n.rideId, {}, { idempotencyKey: newIdempotencyKey() });
      await reload();
      show("Posted", () => {
        void client.tripeco.unpostRide(n.rideId, { idempotencyKey: newIdempotencyKey() }).then(reload, (err: unknown) => show(errorText(err)));
      });
    } catch (err) {
      show(errorText(err));
    } finally {
      setBusy(null);
    }
  }
  return (
    <section aria-label="Needs you" className="card rows">
      {needs.map((n) => (
        <div key={`${n.kind}-${n.rideId}`} className="row" style={{ minHeight: 64, paddingRight: 10 }}>
          <Link href={n.kind === "end" ? `/scan?ride=${n.rideId}` : `/ride?id=${n.rideId}`} className="grow" style={{ color: "inherit" }}>
            <span className="t">{needLine(n.title, n.amountMinor)}</span>
          </Link>
          {n.kind === "end" ? (
            <Link href={`/scan?ride=${n.rideId}`} className="small-btn" style={{ display: "inline-flex", alignItems: "center" }}>Add</Link>
          ) : (
            <button className="small-btn" disabled={busy === n.rideId} onClick={() => void post(n)}>Post</button>
          )}
        </div>
      ))}
    </section>
  );
}

export function RideRow({ ride }: { ride: TripecoRide }) {
  const a = rideAmount(ride);
  return (
    <Link href={ride.state === "posted" ? `/posted?id=${ride.id}` : `/ride?id=${ride.id}`} className="row">
      <span className="tile">{ride.km === null ? "—" : Math.round(ride.km)}</span>
      <span className="grow">
        <span className="t">{ride.title}</span>
      </span>
      <span className={`amt ${a.tone}`}>{a.text}</span>
    </Link>
  );
}

function AccountSheet({ onClose }: { onClose: () => void }) {
  const { me } = useMe();
  const { signOut } = useSession();
  return (
    <Sheet label="Account" onClose={onClose}>
      <div className="row" style={{ padding: 0 }}>
        <span className="face" style={{ background: "#1C3357", color: "#93C5FD" }} aria-hidden="true">
          {me ? initialOf(me.displayName ?? me.email) : ""}
        </span>
        <span className="grow">
          <span className="t">{me?.displayName ?? me?.email ?? ""}</span>
          <span className="s">{me?.email ?? ""}</span>
        </span>
      </div>
      <button
        className="btn danger"
        onClick={() => {
          void signOut().then(() => window.location.replace("/sign-in"));
        }}
      >
        Sign out
      </button>
    </Sheet>
  );
}
