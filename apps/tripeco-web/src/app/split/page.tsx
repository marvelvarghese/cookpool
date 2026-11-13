"use client";

// Split (canvas SplitHow): everyone equal; tap a name to leave them out (the
// owner too); tap the km to slide how far someone rode; + Toll, + Parking,
// + Wear. Fuel and wear follow the km, extras split equally (design §2).

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Icon } from "@/components/icons";
import { Face, Screen, SignedIn } from "@/components/ui";
import { GroupChip } from "@/components/group-picker";
import { useRide } from "@/lib/use-ride";
import { useMe } from "@/lib/me";
import { parseRupees, rupees, km as kmText } from "@/lib/money";
import { hasOthers } from "@/lib/ride-draft";

export default function SplitPage() {
  return (
    <SignedIn>
      <Split />
    </SignedIn>
  );
}

function Split() {
  const id = useSearchParams().get("id");
  const router = useRouter();
  const e = useRide(id);
  const { me } = useMe();
  const [open, setOpen] = React.useState<number | null>(null);
  const [touched, setTouched] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const { ride, draft, worked, group } = e;
  if (!ride || !draft || !worked) return <Screen back={`/ride?id=${id ?? ""}`}>{e.error ? <p className="error">{e.error}</p> : <p className="spinner">Loading…</p>}</Screen>;
  const rideKm = worked.km ?? 0;
  const others = hasOthers(draft, e.owner);
  const groupName = group?.group.name ?? "Just me";

  const setRider = (i: number, update: Partial<(typeof draft.riders)[number]>) => {
    setTouched(true);
    e.change((d) => ({ ...d, riders: d.riders.map((r, j) => (j === i ? { ...r, ...update } : r)) }));
  };
  const addExtra = (kind: "toll" | "parking") => {
    setTouched(true);
    e.change((d) => ({ ...d, extras: [...d.extras, { kind, amountMinor: 0 }] }));
  };

  async function post() {
    setBusy(true);
    const r = await e.post();
    setBusy(false);
    if (r) router.replace(`/posted?id=${r.id}`);
  }

  return (
    <Screen back={`/ride?id=${ride.id}`} title={<GroupChip name={groupName} />}>
      <div className="total">
        <b>{rupees(worked.totalMinor)}</b>
        <span>{kmText(rideKm)} km</span>
      </div>

      <div className="card rows">
        {draft.riders.map((r, i) => {
          const part = r.km !== null && r.km < rideKm;
          const share = worked.shares[i] ?? 0;
          return (
            <div key={r.subjectId}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, height: 68, padding: "0 14px 0 6px" }}>
                <button
                  aria-pressed={r.on}
                  aria-label={`${r.name} pays`}
                  onClick={() => {
                    setRider(i, { on: !r.on });
                    if (open === i) setOpen(null);
                  }}
                  style={{ flex: 1, minWidth: 0, height: 60, border: 0, background: "none", display: "flex", alignItems: "center", gap: 12, padding: "0 8px", textAlign: "left" }}
                >
                  <span style={{ opacity: r.on ? 1 : 0.35 }}>
                    <Face id={r.subjectId} name={r.name} me={me?.id ?? null} />
                  </span>
                  <span style={{ fontSize: 17, fontWeight: 500, color: r.on ? "var(--text)" : "var(--muted)", textDecoration: r.on ? "none" : "line-through" }}>{r.name}</span>
                </button>
                {r.on ? (
                  <button
                    aria-label={`Distance ${r.name} rode`}
                    aria-expanded={open === i}
                    onClick={() => {
                      setTouched(true);
                      setOpen(open === i ? null : i);
                    }}
                    style={{ height: 32, padding: "0 10px", borderRadius: 10, border: 0, background: part ? "var(--lime-tint)" : "var(--card-2)", color: part ? "var(--lime)" : "var(--muted)", fontSize: 13, fontWeight: 600 }}
                  >
                    {kmText(r.km === null ? rideKm : Math.min(r.km, rideKm))} km
                  </button>
                ) : null}
                <span style={{ width: 64, textAlign: "right", fontSize: 17, fontWeight: 500, color: !r.on || r.subjectId === e.owner ? "var(--muted)" : "var(--money)" }}>
                  {r.on ? rupees(share) : "—"}
                </span>
              </div>
              {r.on && open === i ? (
                <div className="row-in" style={{ padding: "0 20px 18px", display: "flex", flexDirection: "column", gap: 10 }} data-no-pager="">
                  <input
                    type="range"
                    min={0}
                    max={Math.max(1, Math.round(rideKm))}
                    step={1}
                    value={Math.round(r.km === null ? rideKm : Math.min(r.km, rideKm))}
                    aria-label={`Kilometres ${r.name} rode`}
                    onChange={(ev) => {
                      const v = Number(ev.target.value);
                      setRider(i, { km: v >= Math.round(rideKm) ? null : v });
                    }}
                  />
                  <div className="row-between" style={{ fontSize: 12, color: "var(--muted)" }}>
                    <span>0</span>
                    <span>Whole ride</span>
                  </div>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>

      {!touched ? <span style={{ textAlign: "center", fontSize: 13, color: "var(--muted)" }}>Tap a name to leave them out</span> : null}

      <div className="stack" style={{ gap: 8 }}>
        {draft.extras.map((x, i) => (
          <div key={i} className="card row-in" style={{ height: 56, borderRadius: 18, display: "flex", alignItems: "center", gap: 10, padding: "0 8px 0 16px" }}>
            <span style={{ flex: 1, fontSize: 15, fontWeight: 500 }}>{x.kind === "toll" ? "Toll" : "Parking"}</span>
            <label style={{ display: "flex", alignItems: "center", gap: 2, color: "var(--money)", fontSize: 17, fontWeight: 500 }}>
              ₹
              <input
                inputMode="numeric"
                aria-label={`${x.kind === "toll" ? "Toll" : "Parking"} amount`}
                defaultValue={x.amountMinor ? String(x.amountMinor / 100) : ""}
                autoFocus={x.amountMinor === 0}
                onChange={(ev) => {
                  const v = parseRupees(ev.target.value) ?? 0;
                  e.change((d) => ({ ...d, extras: d.extras.map((y, j) => (j === i ? { ...y, amountMinor: v } : y)) }));
                }}
                style={{ width: 64, background: "none", border: 0, color: "var(--money)", padding: 0, outline: "none" }}
              />
            </label>
            <button className="icon-btn" aria-label={`Remove ${x.kind}`} style={{ borderRadius: 12, color: "var(--muted)" }} onClick={() => e.change((d) => ({ ...d, extras: d.extras.filter((_, j) => j !== i) }))}>
              <Icon name="close" size={16} />
            </button>
          </div>
        ))}
        {draft.wearOn && draft.wearMinorPerKm > 0 ? (
          <div className="card row-in" style={{ height: 56, borderRadius: 18, display: "flex", alignItems: "center", gap: 10, padding: "0 8px 0 16px" }}>
            <span style={{ flex: 1, fontSize: 15, fontWeight: 500 }}>Wear · ₹{draft.wearMinorPerKm / 100}/km</span>
            <span style={{ fontSize: 17, fontWeight: 500, color: "var(--money)" }}>{rupees(worked.wearMinor)}</span>
            <button className="icon-btn" aria-label="Remove wear" style={{ borderRadius: 12, color: "var(--muted)" }} onClick={() => e.change((d) => ({ ...d, wearOn: false }))}>
              <Icon name="close" size={16} />
            </button>
          </div>
        ) : null}
        <div style={{ display: "grid", gridTemplateColumns: `repeat(${draft.wearMinorPerKm > 0 && !draft.wearOn ? 3 : 2}, minmax(0, 1fr))`, gap: 8 }}>
          <button className="dashed" onClick={() => addExtra("toll")}>+ Toll</button>
          <button className="dashed" onClick={() => addExtra("parking")}>+ Parking</button>
          {draft.wearMinorPerKm > 0 && !draft.wearOn ? (
            <button className="dashed" onClick={() => e.change((d) => ({ ...d, wearOn: true }))}>+ Wear</button>
          ) : null}
        </div>
      </div>

      {e.error ? <p className="error" role="alert">{e.error}</p> : null}
      <div style={{ height: 70 }} />
      <div className="foot">
        <div className="foot-inner">
          {others && draft.groupId ? (
            <button className="btn" disabled={busy || worked.othersMinor <= 0} onClick={() => void post()}>
              Post {rupees(worked.othersMinor)} to {groupName}
            </button>
          ) : (
            <button
              className="btn"
              onClick={() => {
                void e.flush().then(() => router.replace(others ? `/ride?id=${ride.id}` : "/"));
              }}
            >
              {others ? "Pick a group" : "Save as solo drive"}
            </button>
          )}
        </div>
      </div>
    </Screen>
  );
}
