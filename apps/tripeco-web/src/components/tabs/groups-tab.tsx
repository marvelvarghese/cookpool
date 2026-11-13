"use client";

// Groups (canvas Groups): your Spliteco groups — those with rides first, with
// how many and your side of them; the rest with a Ride button. No groups of
// Tripeco's own: New opens Spliteco (design §0.2).

import * as React from "react";
import Link from "next/link";
import type { SplitecoGroupsResponse, SplitecoGroupSummary, TripecoGroupRidesResponse } from "@saas/sdk";
import { Icon } from "../icons";
import { Loading, type Load } from "../ui";
import { useSession } from "@/lib/session";
import { useMe } from "@/lib/me";
import { splitecoGroupUrl } from "@/lib/links";
import { signedRupees } from "@/lib/money";
import { initialOf } from "@/lib/people";
import { myNet } from "@/lib/rides";

export function GroupsTab({ groups }: { groups: Load<SplitecoGroupsResponse> }) {
  const { client } = useSession();
  const { me } = useMe();
  const [rides, setRides] = React.useState<Map<string, TripecoGroupRidesResponse>>(new Map());
  const [newHref, setNewHref] = React.useState<string | null>(null);
  React.useEffect(() => setNewHref(splitecoGroupUrl(window.location.host, null)), []);

  const list = groups.data?.groups;
  React.useEffect(() => {
    if (!list) return;
    let live = true;
    void Promise.all(list.map((g) => client.tripeco.groupRides(g.id).then((r) => [g.id, r] as const, () => null))).then((all) => {
      if (live) setRides(new Map(all.filter((x): x is readonly [string, TripecoGroupRidesResponse] => x !== null)));
    });
    return () => {
      live = false;
    };
  }, [client, list]);

  const withRides = (list ?? []).filter((g) => (rides.get(g.id)?.rides.length ?? 0) > 0);
  const others = (list ?? []).filter((g) => (rides.get(g.id)?.rides.length ?? 0) === 0);
  return (
    <>
      <header className="head">
        <h1 className="h1">Groups</h1>
        {newHref ? (
          <a href={newHref} className="chip" style={{ color: "var(--cobalt-ink)" }}>
            <span className="dot-cobalt" />
            New
          </a>
        ) : null}
      </header>
      <Loading load={groups}>
        {withRides.length > 0 ? (
          <section aria-label="With rides" className="card rows">
            {withRides.map((g) => {
              const r = rides.get(g.id)!;
              const net = r.rides.reduce((s, p) => s + myNet(p, me?.id ?? null), 0);
              return (
                <Link key={g.id} href={`/group?id=${g.id}`} className="row">
                  <GroupMark g={g} />
                  <span className="grow">
                    <span className="t">{g.name}</span>
                    <span className="s">{r.rides.length === 1 ? "1 ride" : `${r.rides.length} rides`}</span>
                  </span>
                  <span className={`amt ${net > 0 ? "get" : net < 0 ? "owe" : "dim"}`}>{signedRupees(net)}</span>
                </Link>
              );
            })}
          </section>
        ) : null}
        {others.length > 0 ? (
          <section aria-label="Your other Spliteco groups" className="stack">
            {withRides.length > 0 ? <span className="label">Other groups</span> : null}
            <div className="card rows">
              {others.map((g) => (
                <div key={g.id} className="row" style={{ paddingRight: 10 }}>
                  <GroupMark g={g} />
                  <span className="grow">
                    <span className="t">{g.name}</span>
                  </span>
                  <Link href={`/scan?group=${g.id}`} className="small-btn" style={{ display: "inline-flex", alignItems: "center" }}>
                    Ride
                  </Link>
                </div>
              ))}
            </div>
          </section>
        ) : null}
        {list && list.length === 0 && newHref ? (
          <a href={newHref} className="btn spliteco">
            Make a group in Spliteco
            <Icon name="out" size={16} />
          </a>
        ) : null}
      </Loading>
    </>
  );
}

function GroupMark({ g }: { g: SplitecoGroupSummary }) {
  return (
    <span className="tile" style={{ background: "rgba(37,99,235,.18)", color: "#93C5FD", fontSize: 15 }} aria-hidden="true">
      {initialOf(g.name)}
    </span>
  );
}
