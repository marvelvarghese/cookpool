"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { SplitecoFriendResponse } from "@saas/contracts/spliteco";
import { Icon } from "@/components/icons";
import { Avatar, BackButton, BigMoney, Loading, Screen, moneyList, useLoad, useQueryParam } from "@/components/ui";
import { ExpenseRow } from "@/components/expense-row";
import { formatMoney } from "@/lib/money";
import { namesFrom } from "@/lib/people";
import { shortDate } from "@/lib/activity-text";
import { errorText, newIdempotencyKey, useSession } from "@/lib/session";
import { useMe } from "@/lib/me";
import { RemindButton } from "@/components/remind";

export default function FriendPage() {
  const id = useQueryParam("id");
  const load = useLoad((c) => (id ? c.spliteco.friend(id) : new Promise<never>(() => undefined)), [id]);
  const { me } = useMe();
  return (
    <Screen nav={false}>
      <header className="hdr">
        <BackButton href="/groups?tab=friends" label="Back to friends" />
      </header>
      {id ? <Loading load={load}>{load.data ? <Friend data={load.data} me={me?.id ?? null} reload={load.reload} /> : null}</Loading> : null}
    </Screen>
  );
}

function Friend({ data, me, reload }: { data: SplitecoFriendResponse; me: string | null; reload: () => void }) {
  const { client } = useSession();
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const key = React.useRef(newIdempotencyKey());
  const name = data.friend.name ?? "Someone";
  const names = namesFrom([data.friend]);
  const main = data.balances.find((b) => b.currency === "INR") ?? data.balances[0] ?? { currency: "INR", amountMinor: 0 };
  const others = data.balances.filter((b) => b !== main && b.amountMinor !== 0);
  const n = main.amountMinor;
  const shared = data.byGroup.filter((g) => g.kind !== "direct").map((g) => g.groupName);
  const outside = data.expenses.filter((e) => e.groupId === data.directGroupId).length;
  // SE2: what the plans say — I pay them (Settle up) or they pay me (Remind), largest first.
  const iPay = data.plans.filter((p) => p.fromSubjectId !== data.friend.subjectId);
  const theyPay = data.plans.filter((p) => p.fromSubjectId === data.friend.subjectId);
  const remindFor = theyPay[0] ?? null;

  async function addWith() {
    setBusy(true);
    setError(null);
    try {
      const r = await client.spliteco.directGroup(data.friend.subjectId, { idempotencyKey: key.current });
      router.push(`/add?group=${encodeURIComponent(r.group.id)}`);
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  }

  return (
    <>
      <section className="stack" style={{ alignItems: "center", textAlign: "center", gap: 8 }}>
        <Avatar id={data.friend.subjectId} name={name} me={me} size={76} />
        <h1 className="h1" style={{ fontSize: 24 }}>{name}</h1>
        <span className="small dim" style={{ fontSize: 13 }}>
          {shared.length > 0 ? `In ${shared.join(", ")} with you` : "No groups in common"}
          {outside > 0 ? ` · ${outside} expense${outside === 1 ? "" : "s"} outside groups` : ""}
        </span>
      </section>

      <section aria-label={`Balance with ${name}`} className="card r22">
        <div className="stack" style={{ gap: 2 }}>
          <span className="muted" style={{ fontSize: 13 }}>{n > 0 ? `${name} owes you` : n < 0 ? `You owe ${name}` : `You and ${name} are all square`}</span>
          <BigMoney minor={n} currency={main.currency} tone={n > 0 ? "get" : n < 0 ? "owe" : "even"} size="md" />
          {others.length > 0 ? <span className="note">Also {moneyList(others)}</span> : null}
        </div>
        {data.byGroup.length > 0 ? (
          <div className="stack s8" style={{ fontSize: 14, borderTop: "1px solid var(--line)", paddingTop: 12 }}>
            {data.byGroup.map((g) => (
              <Link key={g.groupId} href={`/group?id=${encodeURIComponent(g.groupId)}`} className="row-between" style={{ color: "inherit", minHeight: 28 }}>
                <span className="muted">{g.kind === "direct" ? "Outside groups" : `In ${g.groupName}`}</span>
                <b className={g.amountMinor > 0 ? "get" : g.amountMinor < 0 ? "owe" : "even"}>{formatMoney(Math.abs(g.amountMinor), g.currency)}</b>
              </Link>
            ))}
          </div>
        ) : null}
        <div className="inline" style={{ flexWrap: "nowrap" }}>
          {iPay[0] ? (
            <Link
              href={iPay.length === 1 ? `/settle?group=${encodeURIComponent(iPay[0].groupId)}&to=${encodeURIComponent(data.friend.subjectId)}` : "/settle"}
              className="btn flex1"
            >
              Settle up
            </Link>
          ) : remindFor ? (
            <RemindButton
              onSent={reload}
              target={{
                to: data.friend.subjectId,
                toName: name,
                amountMinor: remindFor.amountMinor,
                currency: remindFor.currency,
                groupId: remindFor.groupId,
                groupName: remindFor.groupName === "Outside groups" ? null : remindFor.groupName,
                lastSentAt: data.lastRemindedAt,
              }}
            />
          ) : (
            <button className="btn flex1" disabled aria-disabled="true" title="Nothing to settle">Settle up</button>
          )}
          <button className="btn ghost flex1" onClick={addWith} disabled={busy}>
            <Icon name="plus" size={18} />
            {busy ? "Opening…" : "Add expense"}
          </button>
        </div>
        {remindFor && data.lastRemindedAt ? <span className="note">Last reminded {shortDate(data.lastRemindedAt)}.</span> : null}
        {iPay.length > 1 ? <span className="note">You pay {name} in {iPay.length} groups; Settle up lists each.</span> : null}
        <span className="note">“Add expense” splits with {name} outside any group.</span>
        {error ? <p className="error" role="alert">{error}</p> : null}
      </section>

      <section aria-label="Shared expenses" className="list">
        <h2 className="eyebrow">Shared with {name}</h2>
        {data.expenses.length === 0 ? <p className="empty">Nothing shared yet.</p> : null}
        {data.expenses.map((e) => {
          const outsideRow = e.groupId === data.directGroupId;
          return (
            <div key={e.id} className="inline" style={{ flexWrap: "nowrap", gap: 10 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <ExpenseRow e={e} names={names} me={me} sub={`${shortDate(e.occurredAt)} · ${outsideRow ? "no group" : e.groupName}`} />
              </div>
              {outsideRow && !e.locked ? (
                <Link href={`/move?id=${encodeURIComponent(e.id)}`} aria-label={`Move ${e.title} into a group`} className="pillbtn" style={{ height: 44, padding: "0 10px", background: "#1A3050", border: 0, color: "#93C5FD", fontSize: 12, fontWeight: 700 }}>
                  <Icon name="move" size={14} />
                  Move
                </Link>
              ) : null}
            </div>
          );
        })}
      </section>
    </>
  );
}
