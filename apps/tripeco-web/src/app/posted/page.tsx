"use client";

// Posted (canvas Posted): the tick, "₹519 to Goa Trip", the row as it shows
// in Spliteco (car mark, lock, Tripeco) with who owes what, Open in
// Spliteco, and Undo — a real unpost — or Post again; Done.

import * as React from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import type { SplitecoGroupResponse, TripecoRide } from "@saas/sdk";
import { Icon } from "@/components/icons";
import { SignedIn } from "@/components/ui";
import { errorText, newIdempotencyKey, useSession } from "@/lib/session";
import { splitecoGroupUrl } from "@/lib/links";
import { rupees, signedRupees } from "@/lib/money";
import { othersOwe } from "@/lib/rides";

export default function PostedPage() {
  return (
    <SignedIn>
      <Posted />
    </SignedIn>
  );
}

function Posted() {
  const id = useSearchParams().get("id");
  const { client } = useSession();
  const [ride, setRide] = React.useState<TripecoRide | null>(null);
  const [group, setGroup] = React.useState<SplitecoGroupResponse | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [href, setHref] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!id) return;
    void client.tripeco.ride(id).then(
      async ({ ride: r }) => {
        setRide(r);
        const g = r.posted?.groupId ?? r.groupId;
        if (g) {
          setGroup(await client.spliteco.group(g).catch(() => null));
          setHref(splitecoGroupUrl(window.location.host, g));
        }
      },
      (err: unknown) => setError(errorText(err)),
    );
  }, [client, id]);

  if (!ride) return <div className="app"><main className="page">{error ? <p className="error">{error}</p> : <p className="spinner">Loading…</p>}</main></div>;
  const posted = ride.state === "posted";
  const owner = ride.riders[0]?.subjectId ?? null;
  const owed = othersOwe(ride, owner);
  const names = new Map((group?.members ?? []).map((m) => [m.subjectId, m.name ?? "Someone"]));

  async function flip() {
    if (!ride) return;
    setBusy(true);
    setError(null);
    try {
      const r = posted
        ? await client.tripeco.unpostRide(ride.id, { idempotencyKey: newIdempotencyKey() })
        : await client.tripeco.postRide(ride.id, {}, { idempotencyKey: newIdempotencyKey() });
      setRide(r.ride);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="app">
      <main className="page" style={{ paddingTop: 96, alignItems: "stretch" }}>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 14 }}>
          {posted ? (
            <>
              <div className="pop" style={{ width: 72, height: 72, borderRadius: "50%", background: "var(--get-tint)", color: "var(--get)", display: "flex", alignItems: "center", justifyContent: "center", animation: "pop .45s ease-out" }}>
                <Icon name="check" size={34} />
              </div>
              <h1 style={{ margin: 0, fontSize: 24, fontWeight: 500, textAlign: "center" }}>
                {rupees(owed)} to {group?.group.name ?? "the group"}
              </h1>
            </>
          ) : (
            <>
              <div style={{ width: 72, height: 72, borderRadius: "50%", background: "var(--card)", color: "var(--muted)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <Icon name="undo" size={30} />
              </div>
              <h1 style={{ margin: 0, fontSize: 24, fontWeight: 500, textAlign: "center" }}>Not posted</h1>
            </>
          )}
        </div>

        {posted ? (
          <section aria-label="How it shows in Spliteco" className="card" style={{ marginTop: 14 }}>
            <div className="row" style={{ minHeight: 66, borderBottom: "1px solid var(--hair)" }}>
              <span className="tile lime"><Icon name="car" size={20} /></span>
              <span className="grow">
                <span className="t">{ride.title}</span>
                <span className="s" style={{ display: "flex", alignItems: "center", gap: 4 }}>
                  <Icon name="lock" size={12} />
                  Tripeco
                </span>
              </span>
              <span className="amt get">{signedRupees(owed)}</span>
            </div>
            {ride.riders
              .filter((r) => r.on && r.subjectId !== owner && r.shareMinor > 0)
              .map((r) => (
                <div key={r.subjectId} className="row-between" style={{ height: 44, padding: "0 16px", alignItems: "center" }}>
                  <span style={{ fontSize: 14, color: "var(--soft)" }}>{names.get(r.subjectId) ?? "Someone"}</span>
                  <span style={{ fontSize: 14, fontWeight: 500, color: "var(--money)" }}>{rupees(r.shareMinor)}</span>
                </div>
              ))}
          </section>
        ) : null}
        {error ? <p className="error" role="alert">{error}</p> : null}

        <div className="foot">
          <div className="foot-inner">
            {posted && href ? (
              <a href={href} className="btn spliteco">
                Open in Spliteco
                <Icon name="out" size={16} />
              </a>
            ) : null}
            <div className="two">
              <button className="btn ghost" disabled={busy} onClick={() => void flip()}>{posted ? "Undo" : "Post again"}</button>
              <Link href="/" className="btn">Done</Link>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
