"use client";

import * as React from "react";
import Link from "next/link";
import type { SplitecoGroupResponse } from "@saas/contracts/spliteco";
import { Icon } from "@/components/icons";
import { Avatar, BackButton, BigMoney, Loading, Screen, Sheet, useLoad, useQueryParam } from "@/components/ui";
import { ExpenseRow } from "@/components/expense-row";
import { BucketLine } from "@/components/bucket-line";
import { formatMoney } from "@/lib/money";
import { errorText, useSession } from "@/lib/session";
import { namesFrom, nameOf } from "@/lib/people";
import { KIND_LABELS, byMonth } from "@/lib/view";
import { groupTint, planLines } from "@/lib/groups";
import { useMe } from "@/lib/me";

export default function GroupPage() {
  const id = useQueryParam("id");
  const load = useLoad((c) => (id ? c.spliteco.group(id) : new Promise<never>(() => undefined)), [id]);
  const [invite, setInvite] = React.useState(false);
  const { me } = useMe();
  return (
    <Screen nav={false}>
      <header className="hdr">
        <BackButton href="/groups" label="Back to groups" />
        {load.data && load.data.group.kind !== "direct" ? (
          <button className="pillbtn" aria-label="Invite people" onClick={() => setInvite(true)}>
            <Icon name="invite" size={18} />
            Invite
          </button>
        ) : null}
      </header>
      {id ? <Loading load={load}>{load.data ? <Group data={load.data} me={me?.id ?? null} /> : null}</Loading> : null}
      {load.data ? (
        <Link href={`/add?group=${encodeURIComponent(load.data.group.id)}`} className="fab">
          <Icon name="plus" size={20} stroke={2.2} />
          Add expense
        </Link>
      ) : null}
      {invite && id ? <Invite groupId={id} name={load.data?.group.name ?? "the group"} onClose={() => setInvite(false)} /> : null}
    </Screen>
  );
}

function Group({ data, me }: { data: SplitecoGroupResponse; me: string | null }) {
  const g = data.group;
  const names = namesFrom(data.members, data.people);
  const tint = groupTint(g);
  const n = g.myBalanceMinor;
  const lines = planLines(g, new Map([...names].map(([k, v]) => [k, v ?? "Someone"])));
  const memberNames = data.members.map((m) => nameOf(names, m.subjectId, me));
  return (
    <>
      <section className="inline" style={{ gap: 14, flexWrap: "nowrap" }}>
        <div className="gicon" style={{ width: 64, height: 64, borderRadius: 20, background: tint.bg, color: tint.fg }}>
          <Icon name={g.kind} size={28} />
        </div>
        <div className="stack" style={{ flex: 1, minWidth: 0, gap: 4 }}>
          <h1 className="h1 ellipsis">{g.kind === "direct" ? "Outside groups" : g.name}</h1>
          <span className="small dim" style={{ fontSize: 13 }}>
            {KIND_LABELS[g.kind]} · {formatMoney(data.totalSpentMinor, g.currency)} spent
            {g.madeIn === "cookpool" ? " · " : ""}
            {g.madeIn === "cookpool" ? <span className="cookpool-tag">From Cookpool</span> : null}
          </span>
          <div className="inline" style={{ gap: 0, paddingTop: 2, flexWrap: "nowrap" }}>
            <span className="faces">
              {data.members.slice(0, 5).map((m) => (
                <Avatar key={m.subjectId} id={m.subjectId} name={nameOf(names, m.subjectId, me)} me={me} size={26} />
              ))}
            </span>
            <span className="small muted ellipsis" style={{ paddingLeft: 8 }}>{memberNames.join(", ")}</span>
          </div>
        </div>
      </section>

      <section aria-label="Your balance in this group" className="card r22">
        <div className="row-between" style={{ alignItems: "flex-end" }}>
          <div className="stack" style={{ gap: 2 }}>
            <span className="muted" style={{ fontSize: 13 }}>{n > 0 ? "You get back" : n < 0 ? "You owe" : "You're all square"}</span>
            <BigMoney minor={n} currency={g.currency} tone={n > 0 ? "get" : n < 0 ? "owe" : "even"} size="md" />
            <BucketLine myBuckets={g.myBuckets} currency={g.currency} />
          </div>
          {lines.length > 0 ? (
            <span style={{ padding: "6px 10px", borderRadius: 999, background: "rgba(255,200,87,0.12)", color: "#FFC857", fontSize: 12, fontWeight: 700 }}>
              Simplified
            </span>
          ) : null}
        </div>
        {lines.length > 0 ? (
          <div className="stack s8" style={{ fontSize: 14 }}>
            {g.myPlan.map((p) => (
              <div key={p.subjectId} className="row-between">
                <span className="muted">{p.amountMinor > 0 ? `${nameOf(names, p.subjectId, me)} owes you` : `You owe ${nameOf(names, p.subjectId, me)}`}</span>
                <b className={p.amountMinor > 0 ? "get" : "owe"}>{formatMoney(Math.abs(p.amountMinor), g.currency)}</b>
              </div>
            ))}
          </div>
        ) : null}
      </section>

      <div className="inline" style={{ flexWrap: "nowrap" }}>
        <button className="btn" style={{ flex: 1.3, fontSize: 14 }} disabled aria-disabled="true" title="Coming soon">
          Settle up <span className="tag">Soon</span>
        </button>
        <Link href={`/insights?group=${encodeURIComponent(g.id)}`} className="btn surface flex1" style={{ fontSize: 14 }}>
          Totals
        </Link>
        <Link href={`/share?group=${encodeURIComponent(g.id)}`} className="iconbtn" aria-label="Share or export" style={{ width: 46, height: 46 }}>
          <Icon name="share" />
        </Link>
      </div>

      <section aria-label="Expenses" className="stack s4">
        {data.expenses.length === 0 ? <p className="empty">No expenses yet. Add the first one.</p> : null}
        {byMonth(data.expenses).map(([month, rows]) => (
          <div key={month} className="list">
            <h2 className="eyebrow">{month}</h2>
            {rows.map((e) => (
              <ExpenseRow key={e.id} e={e} names={names} me={me} withDate kitchenGroup={g.madeIn === "cookpool"} />
            ))}
          </div>
        ))}
      </section>
    </>
  );
}

function Invite({ groupId, name, onClose }: { groupId: string; name: string; onClose: () => void }) {
  const { client } = useSession();
  const [code, setCode] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [copied, setCopied] = React.useState(false);
  React.useEffect(() => {
    client.memberships.getJoinCode(groupId).then(
      (r) => setCode(r.code),
      (err: unknown) => setError(errorText(err)),
    );
  }, [client, groupId]);
  async function copy() {
    if (!code) return;
    const text = `Join ${name} on Spliteco with the code ${code} — ${window.location.origin}/groups`;
    try {
      if (navigator.share) await navigator.share({ title: `Join ${name}`, text });
      else await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      /* cancelled */
    }
  }
  return (
    <Sheet label="Invite people" onClose={onClose}>
      <h2 className="h1" style={{ fontSize: 22 }}>Invite people to {name}</h2>
      <p className="muted" style={{ margin: 0, fontSize: 14, lineHeight: 1.5 }}>
        Anyone with this code can join from Groups → Join, in Spliteco or Cookpool.
      </p>
      {error ? <p className="error" role="alert">{error}</p> : null}
      {code ? (
        <div className="panel" style={{ alignItems: "center" }}>
          <span style={{ fontSize: 32, fontWeight: 800, letterSpacing: "0.25em" }} className="money">{code}</span>
        </div>
      ) : !error ? (
        <p className="spinner" role="status">Getting the code…</p>
      ) : null}
      <button className="btn big" onClick={copy} disabled={!code}>
        {copied ? "Shared" : "Share the code"}
      </button>
    </Sheet>
  );
}
