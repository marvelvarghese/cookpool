"use client";

import Link from "next/link";
import type { SplitecoActivityResponse } from "@saas/contracts/spliteco";
import { Avatar, Loading, type Load } from "../ui";
import { activityAmount, activityLine, activityWhat, byDay, viaName } from "@/lib/activity-text";
import { nameOf, namesFrom } from "@/lib/people";

/**
 * Activity (V2Home page 3, design §3): one line per change under a small
 * day header — the face, what it was, "· Claude" when an assistant made
 * it, and what it did to you, signed. The full sentence is the row's label.
 */
export function ActivityTab({ load, me }: { load: Load<SplitecoActivityResponse>; me: string | null }) {
  return (
    <>
      <header className="hdr">
        <h1 className="h1">Activity</h1>
      </header>
      <Loading load={load}>{load.data ? <Entries data={load.data} me={me} /> : null}</Loading>
    </>
  );
}

function Entries({ data, me }: { data: SplitecoActivityResponse; me: string | null }) {
  const names = namesFrom(data.people);
  if (data.entries.length === 0) return <p className="empty">Nothing here yet. Changes in your groups show up here.</p>;
  return (
    <>
      {byDay(data.entries).map(([day, rows]) => (
        <section key={day} aria-label={day} className="stack" style={{ gap: 18 }}>
          <h2 className="day">{day}</h2>
          <div className="card flush">
            {rows.map((e) => {
              const actorName = nameOf(names, e.actorId, me);
              const line = activityLine(e, actorName);
              const amount = activityAmount(e);
              const via = viaName(e);
              return (
                <Link
                  key={`${e.txnId}-${e.action}`}
                  href={`/expense?id=${encodeURIComponent(e.expenseId)}`}
                  className="prow"
                  aria-label={`${line.actor} ${line.text}${via ? `, via ${via}` : ""}. ${line.effect}.`}
                >
                  {e.action === "cookpool" ? (
                    <span className="cface" aria-hidden="true">C</span>
                  ) : (
                    <Avatar id={e.actorId} name={line.actor} me={me} size={38} />
                  )}
                  <span className="line">
                    <span className="what">{activityWhat(e)}</span>
                    {via ? <span className="via">· {via}</span> : null}
                  </span>
                  <span className={`amt ${amount.tone}`}>{amount.text}</span>
                </Link>
              );
            })}
          </div>
        </section>
      ))}
    </>
  );
}
