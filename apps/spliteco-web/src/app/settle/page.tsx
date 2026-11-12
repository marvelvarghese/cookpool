"use client";

// Settle up (SE2, canvas SettleUp): who pays whom, the amount with "All" or
// "Part of it", and UPI, cash or bank.
//
//   /settle                     everyone you owe, across your groups
//   /settle?group=org_…         everyone you owe in that group
//   /settle?group=org_…&to=usr_ paying one person
//
// UPI opens the person's UPI app with a `upi://pay` link and records nothing;
// back in the app, "I paid ₹X" records it and "It didn't" doesn't. Cash and
// bank record in one tap. The person paid can mark it "Not received" later.

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { SplitecoGroupResponse, SplitecoGroupsResponse, SplitecoSettlePlanResponse } from "@saas/contracts/spliteco";
import { Avatar, BackButton, Loading, Screen, useLoad, useQueryParam } from "@/components/ui";
import { Icon } from "@/components/icons";
import { formatMoney, formatShort, moneyInput, parseMoney, splitMoney } from "@/lib/money";
import { nameOf, namesFrom } from "@/lib/people";
import { errorText, newIdempotencyKey, useSession } from "@/lib/session";
import { useMe } from "@/lib/me";
import {
  checkAmount,
  ctaText,
  initialSettle,
  kitchenFirst,
  payOptions,
  settleStep,
  upiLink,
  upiUnavailable,
  type PayMethod,
  type SettleEvent,
} from "@/lib/settle";

export default function SettlePage() {
  const group = useQueryParam("group");
  const to = useQueryParam("to");
  const [ready, setReady] = React.useState(false);
  React.useEffect(() => setReady(true), []);
  return (
    <Screen nav={false}>
      {!ready ? null : group ? <InGroup groupId={group} to={to} /> : <Everywhere />}
    </Screen>
  );
}

/** Everyone you owe, group by group (from each group's plan). */
function Everywhere() {
  const load = useLoad((c) => c.spliteco.groups(), []);
  return (
    <>
      <header className="hdr">
        <BackButton href="/" label="Back to Home" />
        <span className="hdr-title">Settle up</span>
        <span style={{ width: 44 }} />
      </header>
      <Loading load={load}>{load.data ? <OwedList data={load.data} /> : null}</Loading>
    </>
  );
}

function OwedList({ data }: { data: SplitecoGroupsResponse }) {
  const names = namesFrom(data.friends);
  const lines = data.groups.flatMap((g) => g.myPlan.filter((p) => p.amountMinor < 0).map((p) => ({ g, p })));
  const owedToMe = data.groups.flatMap((g) => g.myPlan.filter((p) => p.amountMinor > 0).map((p) => ({ g, p })));
  return (
    <>
      <section aria-label="Who you pay" className="stack s4">
        <h2 className="eyebrow">You pay</h2>
        {lines.length === 0 ? <p className="empty">You don&apos;t owe anyone. Nice.</p> : null}
        <div className="list">
          {lines.map(({ g, p }) => {
            const name = names.get(p.subjectId) ?? "Someone";
            return (
              <Link key={`${g.id}-${p.subjectId}`} href={`/settle?group=${encodeURIComponent(g.id)}&to=${encodeURIComponent(p.subjectId)}`} className="lrow">
                <Avatar id={p.subjectId} name={name} me={null} />
                <div className="main">
                  <span className="title">{name}</span>
                  <span className="sub ellipsis">{g.kind === "direct" ? "Outside groups" : g.name}</span>
                </div>
                <div className="end">
                  <span className="k">you owe</span>
                  <span className="v owe">{formatMoney(-p.amountMinor, g.currency)}</span>
                </div>
              </Link>
            );
          })}
        </div>
      </section>
      {owedToMe.length > 0 ? (
        <section aria-label="Who pays you" className="stack s4">
          <h2 className="eyebrow">They pay you</h2>
          <p className="note">Only the person paying records a payment. Nudge them from their page.</p>
          <div className="list">
            {owedToMe.map(({ g, p }) => {
              const name = names.get(p.subjectId) ?? "Someone";
              return (
                <Link key={`${g.id}-${p.subjectId}`} href={`/friend?id=${encodeURIComponent(p.subjectId)}`} className="lrow">
                  <Avatar id={p.subjectId} name={name} me={null} />
                  <div className="main">
                    <span className="title">{name}</span>
                    <span className="sub ellipsis">{g.kind === "direct" ? "Outside groups" : g.name}</span>
                  </div>
                  <div className="end">
                    <span className="k">owes you</span>
                    <span className="v get">{formatMoney(p.amountMinor, g.currency)}</span>
                  </div>
                </Link>
              );
            })}
          </div>
        </section>
      ) : null}
    </>
  );
}

function InGroup({ groupId, to }: { groupId: string; to: string | null }) {
  const load = useLoad((c) => Promise.all([c.spliteco.group(groupId), c.spliteco.settlePlan(groupId)]), [groupId]);
  const { me } = useMe();
  return (
    <>
      <header className="hdr">
        <BackButton href={`/group?id=${encodeURIComponent(groupId)}`} label="Back to the group" />
        <span className="hdr-title">Settle up</span>
        {to ? (
          <Link href={`/settle?group=${encodeURIComponent(groupId)}`} style={{ fontSize: 14, fontWeight: 600, padding: "10px 0" }}>
            Change
          </Link>
        ) : (
          <span style={{ width: 44 }} />
        )}
      </header>
      <Loading load={load}>
        {load.data ? (
          to ? (
            <Pay group={load.data[0]} plan={load.data[1]} to={to} me={me?.id ?? null} />
          ) : (
            <PickPayee group={load.data[0]} plan={load.data[1]} me={me?.id ?? null} />
          )
        ) : null}
      </Loading>
    </>
  );
}

function PickPayee({ group, plan, me }: { group: SplitecoGroupResponse; plan: SplitecoSettlePlanResponse; me: string | null }) {
  const names = namesFrom(group.members, group.people);
  const options = payOptions(plan);
  return (
    <section aria-label="Who you pay" className="stack s4">
      <h2 className="eyebrow">You pay · {group.group.name}</h2>
      {options.length === 0 ? <p className="empty">You don&apos;t owe anyone in this group.</p> : null}
      <div className="list">
        {options.map((o) => {
          const name = nameOf(names, o.toSubjectId, me);
          return (
            <Link key={o.toSubjectId} href={`/settle?group=${encodeURIComponent(group.group.id)}&to=${encodeURIComponent(o.toSubjectId)}`} className="lrow">
              <Avatar id={o.toSubjectId} name={name} me={me} />
              <div className="main">
                <span className="title">{name}</span>
                <span className="sub">{group.upi.some((u) => u.subjectId === o.toSubjectId) ? "UPI, cash or bank" : "Cash or bank"}</span>
              </div>
              <div className="end">
                <span className="k">you owe</span>
                <span className="v owe">{formatMoney(o.totalMinor, plan.currency)}</span>
              </div>
            </Link>
          );
        })}
      </div>
    </section>
  );
}

const METHODS: { id: PayMethod; badge: string; name: string }[] = [
  { id: "upi", badge: "UPI", name: "Pay with a UPI app" },
  { id: "cash", badge: "₹", name: "I paid in cash" },
  { id: "bank", badge: "IMPS", name: "Bank transfer" },
];

function Pay({ group, plan, to, me }: { group: SplitecoGroupResponse; plan: SplitecoSettlePlanResponse; to: string; me: string | null }) {
  const { client } = useSession();
  const router = useRouter();
  const names = namesFrom(group.members, group.people);
  const payee = nameOf(names, to, me);
  const currency = plan.currency;
  const option = payOptions(plan).find((o) => o.toSubjectId === to) ?? null;
  const owedMinor = option?.totalMinor ?? 0;
  const vpa = group.upi.find((u) => u.subjectId === to)?.upiVpa ?? null;
  const upiOff = upiUnavailable({ vpa, name: payee, currency });
  const kitchenGroup = group.group.madeIn === "cookpool";

  const [mode, setMode] = React.useState<"all" | "part">("all");
  const [partText, setPartText] = React.useState("");
  const [note, setNote] = React.useState("");
  const [flow, setFlow] = React.useState(() => initialSettle(upiOff ? "cash" : "upi"));
  const [splitOwn, setSplitOwn] = React.useState(false);
  const [kitchenText, setKitchenText] = React.useState("");
  const key = React.useRef(newIdempotencyKey());

  const amount = checkAmount(mode, parseMoney(partText), owedMinor, currency);
  const amountMinor = amount.ok ? amount.amountMinor : 0;
  const auto = option ? kitchenFirst(amountMinor, option.owed) : { kitchen: 0, other: amountMinor };
  const ownKitchen = parseMoney(kitchenText) ?? 0;
  const split = kitchenGroup && splitOwn ? { kitchen: ownKitchen, other: amountMinor - ownKitchen } : null;
  const splitOk = !split || (split.kitchen >= 0 && split.other >= 0 && split.kitchen <= (option?.owed.kitchen ?? 0) && split.other <= (option?.owed.other ?? 0));
  const groupName = group.group.kind === "direct" ? "Spliteco" : group.group.name;
  const link = upiLink({ vpa, name: payee, amountMinor, note: note.trim() || groupName, currency });

  // The flow's state lives in a ref as well, so a press is handled once
  // against the latest state (never inside a React updater, which may run twice).
  const flowRef = React.useRef(flow);

  async function record(method: PayMethod) {
    try {
      await client.spliteco.settle(
        group.group.id,
        { toSubjectId: to, amountMinor, method, note: note.trim() || null, ...(split ? { split } : {}) },
        { idempotencyKey: key.current },
      );
      dispatch({ type: "saved" });
    } catch (err) {
      dispatch({ type: "failed", message: errorText(err) });
    }
  }

  function dispatch(event: SettleEvent) {
    const { state, effect } = settleStep(flowRef.current, event);
    flowRef.current = state;
    setFlow(state);
    if (effect === "open_upi" && link) window.location.href = link;
    if (effect === "record") void record(state.method);
  }

  if (!option) {
    return (
      <section className="stack" style={{ alignItems: "center", textAlign: "center" }}>
        <p className="empty">You don&apos;t owe {payee} anything in {groupName} right now.</p>
        <Link href={`/group?id=${encodeURIComponent(group.group.id)}`} className="btn ghost">Back to the group</Link>
      </section>
    );
  }

  if (flow.step === "done") {
    return (
      <section className="stack" style={{ alignItems: "center", textAlign: "center", gap: 12 }} role="status">
        <span className="cat" style={{ width: 64, height: 64, background: "rgba(127,216,176,0.16)", color: "#7FD8B0" }}><Icon name="check" size={30} /></span>
        <h1 className="h1" style={{ fontSize: 24 }}>Recorded {formatShort(amountMinor, currency)} to {payee}</h1>
        <p className="muted" style={{ margin: 0, fontSize: 14 }}>{payee} gets a heads-up, and can mark it &ldquo;not received&rdquo; if it never arrived.</p>
        <button className="btn big" onClick={() => router.push(`/group?id=${encodeURIComponent(group.group.id)}`)}>Done</button>
      </section>
    );
  }

  const { whole, fraction } = splitMoney(amountMinor || owedMinor, currency);
  return (
    <>
      <section className="stack" style={{ alignItems: "center", gap: 10 }}>
        <div className="inline" style={{ gap: 18, flexWrap: "nowrap" }}>
          <span className="stack" style={{ alignItems: "center", gap: 4 }}>
            <Avatar id={me ?? "me"} name="You" me={me} size={56} />
            <span className="small bold">You</span>
          </span>
          <Icon name="swap" size={22} color="#FFC857" />
          <span className="stack" style={{ alignItems: "center", gap: 4 }}>
            <Avatar id={to} name={payee} me={me} size={56} />
            <span className="small bold">{payee}</span>
          </span>
        </div>
        <span className="small dim">You pay {payee} · {groupName}</span>
        <div className="bigmoney owe" aria-live="polite">
          <span className="w">{whole}</span>
          <span className="f">{fraction}</span>
        </div>
        <div role="radiogroup" aria-label="How much" className="seg" style={{ width: 260 }}>
          <button role="radio" aria-checked={mode === "all"} onClick={() => setMode("all")}>All {formatShort(owedMinor, currency)}</button>
          <button
            role="radio"
            aria-checked={mode === "part"}
            onClick={() => {
              setMode("part");
              if (!partText) setPartText(moneyInput(owedMinor));
            }}
          >
            Part of it
          </button>
        </div>
        {mode === "part" ? (
          <label className="amount-box" style={{ minWidth: 180 }}>
            <span>{currency === "INR" ? "₹" : currency}</span>
            <input inputMode="decimal" aria-label="Amount you paid" value={partText} onChange={(e) => setPartText(e.target.value)} autoFocus style={{ width: 140 }} />
          </label>
        ) : null}
        {!amount.ok && mode === "part" ? <p className="error" role="alert">{amount.message}</p> : null}
      </section>

      {kitchenGroup && amountMinor > 0 && option.owed.kitchen > 0 && option.owed.other > 0 ? (
        <section aria-label="Which balance it pays" className="panel" style={{ gap: 8, padding: 14 }}>
          <div className="row-between">
            <span className="small bold muted">Pays Kitchen first, then Other</span>
            <button className="pillbtn" onClick={() => {
              setSplitOwn(!splitOwn);
              setKitchenText(moneyInput(auto.kitchen));
            }}>{splitOwn ? "Kitchen first" : "Change split"}</button>
          </div>
          {splitOwn ? (
            <div className="row-between">
              <label className="amount-box">
                <span>Kitchen</span>
                <input inputMode="decimal" aria-label="Kitchen part" value={kitchenText} onChange={(e) => setKitchenText(e.target.value)} />
              </label>
              <span className="small muted">Other {formatMoney(Math.max(0, amountMinor - ownKitchen), currency)}</span>
            </div>
          ) : (
            <div className="row-between small">
              <span className="muted">Kitchen {formatMoney(auto.kitchen, currency)}</span>
              <span className="muted">Other {formatMoney(auto.other, currency)}</span>
            </div>
          )}
          {!splitOk ? <p className="error" role="alert">Each part must be within what you owe there (Kitchen {formatMoney(option.owed.kitchen, currency)}, Other {formatMoney(option.owed.other, currency)}).</p> : null}
        </section>
      ) : null}

      <section aria-label="How you paid" role="radiogroup" className="stack s8">
        {METHODS.map((m) => {
          const on = flow.method === m.id;
          const off = m.id === "upi" && upiOff !== null;
          const noteText =
            m.id === "upi"
              ? off
                ? upiOff
                : `Opens your app with ${formatShort(amountMinor, currency)} to ${vpa} and "${note.trim() || groupName}" as the note`
              : m.id === "cash"
                ? `Records it now. ${payee} gets a heads-up.`
                : "Records it now, with an optional reference number";
          return (
            <button
              key={m.id}
              role="radio"
              aria-checked={on}
              aria-disabled={off}
              disabled={off || flow.step !== "pick"}
              onClick={() => dispatch({ type: "pick", method: m.id })}
              className="lrow"
              style={{
                textAlign: "left",
                width: "100%",
                borderRadius: 16,
                padding: 14,
                background: on ? "rgba(37,99,235,0.14)" : "var(--surface)",
                border: `1px solid ${on ? "#3B82F6" : "var(--line)"}`,
                opacity: off ? 0.55 : 1,
                color: "inherit",
              }}
            >
              <span className="cat" style={{ background: "#16243A", color: "#93C5FD", fontSize: 12, fontWeight: 800 }}>{m.badge}</span>
              <span className="main">
                <span className="title">{m.name}</span>
                <span className="sub" style={{ whiteSpace: "normal" }}>{noteText}</span>
              </span>
              <span className={`radio ${on ? "on" : ""}`} aria-hidden="true" />
            </button>
          );
        })}
      </section>

      <label className="stack s8">
        <span className="small muted bold">{flow.method === "bank" ? "Reference (optional)" : "Note (optional)"}</span>
        <input className="input" maxLength={60} value={note} onChange={(e) => setNote(e.target.value)} placeholder={flow.method === "bank" ? "UTR or IMPS reference" : groupName} />
      </label>

      <div style={{ height: 150 }} />
      <div className="footer-fixed">
        <div>
          {flow.step === "confirm" ? (
            <section aria-label="Did it go through?" className="panel" style={{ gap: 10, padding: 16 }} role="alertdialog">
              <b style={{ fontSize: 16 }}>Back from your UPI app — did it go through?</b>
              <span className="small muted">We only record it when you say so. {payee} can mark it &ldquo;not received&rdquo;.</span>
              {flow.error ? <p className="error" role="alert">{flow.error}</p> : null}
              <div className="inline" style={{ flexWrap: "nowrap" }}>
                <button className="btn flex1" onClick={() => dispatch({ type: "paid" })}>I paid {formatShort(amountMinor, currency)}</button>
                <button className="btn ghost flex1" onClick={() => dispatch({ type: "didnt" })}>It didn&apos;t</button>
              </div>
              {link ? <a href={link} className="small" style={{ textAlign: "center" }}>Open the UPI app again</a> : null}
            </section>
          ) : (
            <>
              {flow.error ? <p className="error" role="alert">{flow.error}</p> : null}
              <button
                className="btn big"
                disabled={!amount.ok || !splitOk || flow.step === "saving" || (flow.method === "upi" && !link)}
                onClick={() => dispatch({ type: "go" })}
              >
                {flow.step === "saving" ? "Recording…" : ctaText(flow.method, amountMinor, payee, currency)}
              </button>
            </>
          )}
        </div>
      </div>
    </>
  );
}
