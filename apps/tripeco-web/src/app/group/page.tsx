"use client";

// Group rides (canvas GroupRides): a Spliteco group's rides — km and total,
// Rides · Owed as a swipeable pager (the segment is the twin), Settle in
// Spliteco, and Ride for this group.

import * as React from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import type { SplitecoGroupResponse, TripecoGroupRidesResponse } from "@saas/sdk";
import { usePager } from "@saas/gestures/react/pager";
import { Icon } from "@/components/icons";
import { Face, Loading, Screen, SignedIn, useLoad } from "@/components/ui";
import { useMe } from "@/lib/me";
import { splitecoGroupUrl } from "@/lib/links";
import { km as kmText, rupees, signedRupees } from "@/lib/money";
import { initialOf } from "@/lib/people";
import { myNet } from "@/lib/rides";

export default function GroupPage() {
  return (
    <SignedIn>
      <Group />
    </SignedIn>
  );
}

function Group() {
  const id = useSearchParams().get("id") ?? "";
  const { me } = useMe();
  const load = useLoad(async (c) => {
    const [g, rides] = await Promise.all([c.spliteco.group(id), c.tripeco.groupRides(id)]);
    return { g, rides } as { g: SplitecoGroupResponse; rides: TripecoGroupRidesResponse };
  }, [id]);
  const [tab, setTab] = React.useState(0);
  const pager = usePager({ index: tab, count: 2, onChange: setTab, leaveEdge: true });
  const [settle, setSettle] = React.useState<string | null>(null);
  React.useEffect(() => setSettle(splitecoGroupUrl(window.location.host, id)), [id]);
  const d = load.data;
  const names = new Map((d?.g.members ?? []).map((m) => [m.subjectId, m.subjectId === me?.id ? "You" : (m.name ?? "Someone")]));

  return (
    <Screen
      back="/groups"
      action={
        settle ? (
          <a href={settle} className="chip" style={{ color: "var(--cobalt-ink)" }}>
            Settle
            <Icon name="out" size={14} />
          </a>
        ) : undefined
      }
    >
      <Loading load={load}>
        {d ? (
          <>
            <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
              <span className="tile" style={{ width: 56, height: 56, borderRadius: 18, background: "rgba(37,99,235,.18)", color: "#93C5FD", fontSize: 22 }} aria-hidden="true">
                {initialOf(d.g.group.name)}
              </span>
              <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                <h1 className="h1">{d.g.group.name}</h1>
                <span className="muted">{kmText(d.rides.kmTotal)} km · {rupees(d.rides.totalMinor)}</span>
              </div>
            </div>
            <div className="seg" role="tablist">
              <button role="tab" aria-selected={tab === 0} onClick={() => setTab(0)}>Rides</button>
              <button role="tab" aria-selected={tab === 1} onClick={() => setTab(1)}>Owed</button>
            </div>
            <div ref={pager.viewport} className="pager" style={{ margin: "0 -20px" }}>
              <div ref={pager.track} className="pager-track tabs">
                <section aria-label="Rides" style={{ padding: "0 20px", display: "flex", flexDirection: "column", gap: 12 }} inert={tab !== 0}>
                  {d.rides.rides.length > 0 ? (
                    <div className="card rows">
                      {d.rides.rides.map((r) => {
                        const net = myNet(r, me?.id ?? null);
                        const inner = (
                          <>
                            <span className="tile km">
                              {r.km === null ? "—" : Math.round(r.km)}
                              <small>km</small>
                            </span>
                            <span className="grow"><span className="t">{r.title}</span><span className="s">{names.get(r.ownerSubject) ?? ""}</span></span>
                            <span className={`amt ${net > 0 ? "get" : net < 0 ? "owe" : "dim"}`}>{signedRupees(net)}</span>
                          </>
                        );
                        return r.ownerSubject === me?.id ? (
                          <Link key={r.id} href={`/ride?id=${r.id}`} className="row">{inner}</Link>
                        ) : (
                          <div key={r.id} className="row">{inner}</div>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="muted" style={{ margin: 0 }}>No rides yet</p>
                  )}
                  <Link href={`/scan?group=${id}`} className="btn ghost">
                    <Icon name="car" size={20} />
                    Ride for {d.g.group.name}
                  </Link>
                </section>
                <section aria-label="Who owes what" style={{ padding: "0 20px" }} inert={tab !== 1}>
                  <div className="card rows">
                    {d.rides.owed.map((o) => (
                      <div key={o.subjectId} className="row">
                        <Face id={o.subjectId} name={names.get(o.subjectId) ?? "Someone"} me={me?.id ?? null} />
                        <span className="grow"><span className="t">{names.get(o.subjectId) ?? "Someone"}</span></span>
                        <span className="amt money">{rupees(o.shareMinor)}</span>
                      </div>
                    ))}
                    {d.rides.owed.length === 0 ? <div className="row"><span className="muted">Nothing yet</span></div> : null}
                  </div>
                </section>
              </div>
            </div>
          </>
        ) : null}
      </Loading>
    </Screen>
  );
}
