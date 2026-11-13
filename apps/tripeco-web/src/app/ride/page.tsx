"use client";

// New ride (canvas NewRide): the total, Scan odometer, the readings, price
// and mileage, who rode (tap a name to leave them out), the split, and Post.
// Numbers move as you type (lib/ride-draft.ts) and save half a second later.

import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Icon } from "@/components/icons";
import { Face, Screen, SignedIn } from "@/components/ui";
import { GroupChip, GroupPicker } from "@/components/group-picker";
import { useRide } from "@/lib/use-ride";
import { useMe } from "@/lib/me";
import { rupees, km as kmText } from "@/lib/money";
import { UNIT_WORDS } from "@/lib/units";
import { hasOthers } from "@/lib/ride-draft";

export default function RidePage() {
  return (
    <SignedIn>
      <Ride />
    </SignedIn>
  );
}

function Ride() {
  const id = useSearchParams().get("id");
  const router = useRouter();
  const e = useRide(id);
  const { me } = useMe();
  const [picking, setPicking] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const { ride, draft, worked, group } = e;
  if (!id) return <Screen close="/">{null}</Screen>;
  if (!ride || !draft || !worked) return <Screen close="/">{e.error ? <p className="error">{e.error}</p> : <p className="spinner">Loading…</p>}</Screen>;

  const words = UNIT_WORDS[ride.unit];
  const others = hasOthers(draft, e.owner);
  const groupName = group?.group.name ?? "Just me";
  const cta = others && draft.groupId ? `Post ${rupees(worked.othersMinor)} to ${groupName}` : others ? "Pick a group" : "Save as a solo drive";

  async function go() {
    setBusy(true);
    if (others && !draft!.groupId) {
      setPicking(true);
      setBusy(false);
      return;
    }
    if (!others) {
      await e.flush();
      router.replace("/");
      return;
    }
    const r = await e.post();
    setBusy(false);
    if (r) router.replace(`/posted?id=${r.id}`);
  }

  return (
    <Screen close="/" title={ride.state === "posted" ? "Ride" : "New ride"} action={<span className="chip">{ride.vehicleName}</span>}>
      <label className="sr-only" htmlFor="title">Where to?</label>
      <input
        id="title"
        className="text-input"
        style={{ textAlign: "center", background: "none", border: 0, fontSize: 17 }}
        placeholder={ride.title}
        value={draft.title}
        onChange={(ev) => e.change((d) => ({ ...d, title: ev.target.value }))}
      />
      <div className="total" style={{ marginTop: -10 }}>
        <b>{rupees(worked.totalMinor)}</b>
        <span>{worked.km === null ? "— km" : `${kmText(worked.km)} km`}</span>
      </div>

      <Link href={`/scan?ride=${ride.id}`} className="btn ghost" style={{ height: 52, color: "var(--link)", fontWeight: 600 }}>
        <Icon name="camera" size={20} />
        Scan odometer
      </Link>

      <div className="card grid2">
        {draft.mode === "odo" ? (
          <>
            <label className="field">
              <span>Start km</span>
              <input className="mono" inputMode="numeric" value={draft.startKm} onChange={(ev) => e.change((d) => ({ ...d, startKm: ev.target.value }))} />
            </label>
            <label className="field">
              <span>End km</span>
              <input className="mono lime" inputMode="numeric" value={draft.endKm} onChange={(ev) => e.change((d) => ({ ...d, endKm: ev.target.value }))} />
            </label>
          </>
        ) : (
          <>
            <div className="field">
              <span>Trip reset</span>
              <span className="value mono">0.0</span>
            </div>
            <label className="field">
              <span>Trip A</span>
              <input className="mono lime" inputMode="decimal" value={draft.tripKm} onChange={(ev) => e.change((d) => ({ ...d, tripKm: ev.target.value }))} />
            </label>
          </>
        )}
        <label className="field">
          <span>{words.price}</span>
          <input inputMode="decimal" value={draft.priceRupees} onChange={(ev) => e.change((d) => ({ ...d, priceRupees: ev.target.value }))} />
        </label>
        <div className="field">
          <span>Mileage</span>
          <span className="value">
            {draft.mileage} <small>{words.mileage}</small>
          </span>
        </div>
      </div>

      <section aria-label="Who rode" className="stack">
        <div className="row-between" style={{ alignItems: "center" }}>
          <span className="label">Who rode</span>
          <GroupChip name={groupName} onClick={() => setPicking(true)} />
        </div>
        <div className="people">
          {draft.riders.map((r, i) => (
            <button
              key={r.subjectId}
              className="person-chip"
              aria-pressed={r.on}
              onClick={() => e.change((d) => ({ ...d, riders: d.riders.map((x, j) => (j === i ? { ...x, on: !x.on } : x)) }))}
            >
              <Face id={r.subjectId} name={r.name} me={me?.id ?? null} size={32} />
              {r.name}
            </button>
          ))}
        </div>
      </section>

      {others ? (
        <Link href={`/split?id=${ride.id}`} className="card" style={{ display: "block", color: "var(--text)", padding: "4px 0" }} onClick={() => void e.flush()}>
          <div className="row-between" style={{ padding: "10px 16px 6px" }}>
            <span className="label">{draft.riders.some((r) => r.km !== null) || draft.extras.length > 0 ? "By km" : "Equal"}</span>
            <span style={{ fontSize: 13, fontWeight: 600, color: "var(--link)" }}>Change</span>
          </div>
          {draft.riders.map((r, i) =>
            r.on ? (
              <div key={r.subjectId} className="row-between" style={{ height: 40, padding: "0 16px", alignItems: "center" }}>
                <span style={{ fontSize: 15 }}>{r.name}</span>
                <span style={{ fontSize: 15, fontWeight: 500, color: r.subjectId === e.owner ? "var(--muted)" : "var(--money)" }}>{rupees(worked.shares[i] ?? 0)}</span>
              </div>
            ) : null,
          )}
        </Link>
      ) : null}

      {e.error ? <p className="error" role="alert">{e.error}</p> : null}
      <div style={{ height: 70 }} />
      <div className="foot">
        <div className="foot-inner">
          <button className="btn" disabled={busy || worked.km === null} onClick={() => void go()}>{cta}</button>
        </div>
      </div>
      {picking ? (
        <GroupPicker
          current={draft.groupId}
          onClose={() => setPicking(false)}
          onPick={(g) => {
            setPicking(false);
            void e.pickGroup(g);
          }}
        />
      ) : null}
    </Screen>
  );
}
