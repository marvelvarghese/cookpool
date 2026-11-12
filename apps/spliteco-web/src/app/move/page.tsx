"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import type { SplitecoExpenseResponse, SplitecoGroupSummary } from "@saas/contracts/spliteco";
import { Icon } from "@/components/icons";
import { BackButton, Loading, Screen, useLoad, useQueryParam } from "@/components/ui";
import { formatMoney } from "@/lib/money";
import { listNames, nameOf, namesFrom } from "@/lib/people";
import { shortDate } from "@/lib/activity-text";
import { groupTint, missingMembers } from "@/lib/groups";
import { errorReason, errorText, newIdempotencyKey, useSession } from "@/lib/session";
import { useMe } from "@/lib/me";

interface Target {
  group: SplitecoGroupSummary;
  missing: string[];
}

export default function MovePage() {
  const id = useQueryParam("id");
  const load = useLoad(
    async (c) => {
      if (!id) throw new Error("no expense");
      const [x, list] = await Promise.all([c.spliteco.expense(id), c.spliteco.groups()]);
      const candidates = list.groups.filter((g) => g.id !== x.expense.groupId && g.role !== "viewer");
      const onIt = x.expense.splits.map((s) => s.subjectId);
      const targets: Target[] = await Promise.all(
        candidates.slice(0, 30).map(async (g) => {
          try {
            const detail = await c.spliteco.group(g.id);
            return { group: g, missing: missingMembers(onIt, detail.members.map((m) => m.subjectId)) };
          } catch {
            return { group: g, missing: [] };
          }
        }),
      );
      return { x, targets, fromDirect: !list.groups.some((g) => g.id === x.expense.groupId) };
    },
    [id],
  );
  const { me } = useMe();
  return (
    <Screen nav={false}>
      {load.data ? <Move x={load.data.x} targets={load.data.targets} fromDirect={load.data.fromDirect} me={me?.id ?? null} /> : <Loading load={load}>{null}</Loading>}
    </Screen>
  );
}

function Move({ x, targets, fromDirect, me }: { x: SplitecoExpenseResponse; targets: Target[]; fromDirect: boolean; me: string | null }) {
  const { client } = useSession();
  const router = useRouter();
  const e = x.expense;
  const names = namesFrom(x.people);
  const [pick, setPick] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const key = React.useRef(newIdempotencyKey());
  const others = e.splits.map((s) => s.subjectId).filter((s) => s !== me).map((s) => nameOf(names, s, me));
  const target = targets.find((t) => t.group.id === pick) ?? null;
  const fromName = fromDirect ? "Outside groups" : e.groupName;

  async function move() {
    if (!target) return;
    setBusy(true);
    setError(null);
    try {
      const r = await client.spliteco.moveExpense(e.id, { toGroupId: target.group.id }, { idempotencyKey: key.current });
      router.replace(`/expense?id=${encodeURIComponent(r.expense.id)}`);
    } catch (err) {
      setError(errorReason(err) === "not_members" ? "Not everyone on it is a member of that group. Add them there first." : errorText(err));
      setBusy(false);
    }
  }

  if (e.locked) {
    return (
      <>
        <header className="hdr"><BackButton label="Close" /></header>
        <p className="infobox">Bills Cookpool posted can&apos;t be moved — they belong to their kitchen.</p>
      </>
    );
  }

  return (
    <>
      <header className="hdr">
        <BackButton label="Close" />
        <div className="hdr-title"><h1>Move expense</h1></div>
        <span style={{ width: 44 }} />
      </header>
      <section aria-label="The expense" className="panel" style={{ gap: 6 }}>
        <div className="row-between">
          <span style={{ fontSize: 16, fontWeight: 500 }}>{e.title}</span>
          <span className="money" style={{ fontWeight: 500 }}>{formatMoney(e.totalMinor, e.currency)}</span>
        </div>
        <span className="small dim">{shortDate(e.occurredAt)} · {others.length ? `split with ${listNames(others)}` : "just you"}</span>
        <div className="row-between small" style={{ paddingTop: 6 }}>
          <span className="dim">Now in</span>
          <span className="bold">{fromDirect ? `No group · just you & ${listNames(others)}` : fromName}</span>
        </div>
      </section>
      <section aria-label="Move to" className="stack">
        <h2 className="eyebrow" style={{ margin: 0 }}>Move to</h2>
        {targets.length === 0 ? <p className="empty">No other group to move it to.</p> : null}
        <div role="radiogroup" aria-label="Group to move it to" className="stack s8">
          {targets.map((t) => {
            const ok = t.missing.length === 0;
            const on = pick === t.group.id;
            const tint = groupTint(t.group);
            return (
              <button
                key={t.group.id}
                role="radio"
                aria-checked={on}
                aria-disabled={!ok}
                onClick={() => ok && setPick(t.group.id)}
                className="prow"
                style={{ textAlign: "left", color: "var(--text)", opacity: ok ? 1 : 0.55, background: on ? "rgba(37,99,235,0.14)" : undefined, borderColor: on ? "var(--cobalt-ring)" : undefined }}
              >
                <span className="gicon" style={{ width: 40, height: 40, borderRadius: 12, background: tint.bg, color: tint.fg, fontSize: 15 }}>{t.group.name.charAt(0).toUpperCase()}</span>
                <span className="main">
                  <span className="inline" style={{ gap: 6, fontWeight: 500 }}>
                    {t.group.name}
                    {t.group.madeIn === "cookpool" ? <span className="cookpool-tag">From Cookpool</span> : null}
                  </span>
                  <span className="small" style={{ color: ok ? "var(--dim)" : "var(--owe)" }}>
                    {ok ? "Everyone on it is a member" : `${listNames(t.missing.map((m) => nameOf(names, m, me)))} ${t.missing.length === 1 ? "isn't" : "aren't"} in this group — add them there first`}
                  </span>
                </span>
                <span className={`radio ${on ? "on" : ""}`} aria-hidden="true" />
              </button>
            );
          })}
        </div>
      </section>
      {target ? (
        <section aria-label="What changes" className="panel" style={{ gap: 8 }}>
          <span className="small bold muted">What changes</span>
          <div className="row-between small"><span className="muted">{fromName} · your balance</span><b>{e.myNetMinor === 0 ? "no change" : `${formatMoney(-e.myNetMinor, e.currency, { sign: true })}`}</b></div>
          <div className="row-between small"><span className="muted">{target.group.name} · your balance</span><b>{e.myNetMinor === 0 ? "no change" : `${formatMoney(e.myNetMinor, e.currency, { sign: true })}`}</b></div>
          <span className="note">Others in {target.group.name} see it in its activity, but owe nothing for it unless they&apos;re on it.</span>
        </section>
      ) : null}
      <div className="infobox inline" style={{ flexWrap: "nowrap", alignItems: "flex-start" }}>
        <Icon name="lock" size={16} />
        <span>Bills Cookpool posted can&apos;t be moved — they belong to their kitchen. Anything you added yourself can go into a Cookpool group if everyone on it is a member there.</span>
      </div>
      {error ? <p className="error" role="alert">{error}</p> : null}
      <button className="btn big" onClick={move} disabled={!target || busy}>
        {busy ? "Moving…" : target ? `Move to ${target.group.name}` : "Pick a group to move it to"}
      </button>
    </>
  );
}
