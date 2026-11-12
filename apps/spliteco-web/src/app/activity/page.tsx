"use client";

import * as React from "react";
import Link from "next/link";
import type { SplitecoActivityEntry, SplitecoActivityResponse } from "@saas/contracts/spliteco";
import { filterEntries, type ActivityFilter as Filter } from "@/lib/view";
import { Avatar, Loading, Screen, useLoad } from "@/components/ui";
import { activityLine, timeAgo, viaChip } from "@/lib/activity-text";
import { nameOf, namesFrom } from "@/lib/people";
import { useMe } from "@/lib/me";

export default function ActivityPage() {
  const load = useLoad((c) => c.spliteco.activity(), []);
  const [filter, setFilter] = React.useState<Filter>("all");
  const { me } = useMe();
  return (
    <Screen tight>
      <header className="hdr">
        <h1 className="h1">Activity</h1>
      </header>
      <div role="tablist" aria-label="Filter activity" className="filters">
        {(["all", "payments", "cookpool"] as const).map((f) => (
          <button key={f} role="tab" aria-selected={filter === f} onClick={() => setFilter(f)} style={f === "cookpool" && filter !== f ? { color: "var(--cook-ink)" } : undefined}>
            {f === "all" ? "All" : f === "payments" ? "Payments" : "Cookpool"}
          </button>
        ))}
      </div>
      <Loading load={load}>{load.data ? <Entries data={load.data} filter={filter} me={me?.id ?? null} /> : null}</Loading>
    </Screen>
  );
}

function dayKey(iso: string, now = new Date()): string {
  const d = new Date(iso);
  const same = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  const y = new Date(now);
  y.setDate(now.getDate() - 1);
  if (same(d, now)) return "Today";
  if (same(d, y)) return "Yesterday";
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "long", year: d.getFullYear() === now.getFullYear() ? undefined : "numeric" });
}

function Entries({ data, filter, me }: { data: SplitecoActivityResponse; filter: Filter; me: string | null }) {
  const names = namesFrom(data.people);
  const entries = filterEntries(data.entries, filter);
  if (entries.length === 0) return <p className="empty">Nothing here yet. Changes in your groups show up here.</p>;
  const groups = new Map<string, SplitecoActivityEntry[]>();
  for (const e of entries) {
    const k = dayKey(e.at);
    (groups.get(k) ?? groups.set(k, []).get(k)!).push(e);
  }
  return (
    <section aria-label="Recent" className="stack s4">
      {[...groups.entries()].map(([day, rows]) => (
        <div key={day} className="list">
          <h2 className="eyebrow" style={{ margin: "4px 0 2px" }}>{day}</h2>
          {rows.map((e) => {
            const actorName = nameOf(names, e.actorId, me);
            const line = activityLine(e, actorName);
            const avatarName = line.actor;
            return (
              <Link key={`${e.txnId}-${e.action}`} href={`/expense?id=${encodeURIComponent(e.expenseId)}`} className="lrow" style={{ alignItems: "flex-start" }}>
                {e.action === "cookpool" ? (
                  <span className="avatar" aria-hidden="true" style={{ width: 38, height: 38, background: "rgba(76,201,138,0.16)", color: "#6FD9A3", fontSize: 13 }}>C</span>
                ) : (
                  <Avatar id={e.actorId} name={avatarName} me={me} size={38} />
                )}
                <div className="main" style={{ gap: 3 }}>
                  <span style={{ fontSize: 14, lineHeight: 1.4, color: "var(--text-2)" }}>
                    <b style={{ color: "var(--text)" }}>{line.actor}</b> {line.text}
                  </span>
                  {viaChip(e) ? <span className="tag" style={{ alignSelf: "flex-start" }}>{viaChip(e)}</span> : null}
                  <span className={`small bold ${line.tone === "get" ? "get" : line.tone === "owe" ? "owe" : "dim"}`}>{line.effect}</span>
                  <span className="dim" style={{ fontSize: 11 }}>{timeAgo(e.at)}</span>
                </div>
              </Link>
            );
          })}
        </div>
      ))}
    </section>
  );
}
