"use client";

// Settle up (SE2; V2Settle since spliteco-calm SL5): who pays whom, the big
// amount with All, Part (and Kitchen / Other where a kitchen group owes on
// both), the UPI · Cash · Bank tiles and the slider.
//
//   /settle                     everyone you owe, across your groups
//   /settle?group=org_…         everyone you owe in that group
//   /settle?group=org_…&to=usr_ paying one person
//
// UPI: "Open UPI app" opens the person's UPI app with a `upi://pay` link and
// records nothing; the slider ("Slide when paid") moves only after that, and
// sliding is the payer's "I paid". Cash and bank: "Slide to record". The
// slide shows the tick and Undo at once and the record call waits UNDO_MS
// behind it (lib/slide-pay.ts), so Undo sends nothing. The person paid can
// mark it "Not received" later. The rules are shared with Cookpool's Money
// tab (@saas/spliteco-ui/settle); the tiles and slider are Spliteco's own.

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { SplitecoGroupResponse, SplitecoGroupsResponse, SplitecoSettlePlanResponse } from "@saas/contracts/spliteco";
import { Avatar, BackButton, Loading, Screen, useLoad, useQueryParam, useToast } from "../../components/ui";
import { Icon } from "../../components/icons";
import { Slider } from "@saas/gestures/react/slider";
import { useLatest } from "@saas/gestures/react/motion";
import { formatMoney, formatShort, moneyInput, parseMoney } from "../../lib/money";
import { nameOf, namesFrom } from "../../lib/people";
import { errorText, newIdempotencyKey, useSession } from "../../lib/session";
import { useMe } from "../../lib/me";
import { payOptions, upiLink, upiUnavailable, type PayMethod } from "../../lib/settle";
import {
  SlidePay,
  allocationShown,
  hasBothBalances,
  partChips,
  payAmount,
  slideEnabled,
  slideLabel,
  slideText,
  upiTileState,
  type PayPart,
  type SlidePhase,
} from "../../lib/slide-pay";
import { to as toPath } from "../../lib/paths";

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
        <BackButton href={toPath("/")} label="Back to Home" />
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
              <Link key={`${g.id}-${p.subjectId}`} href={toPath(`/settle?group=${encodeURIComponent(g.id)}&to=${encodeURIComponent(p.subjectId)}`)} className="lrow">
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
                <Link key={`${g.id}-${p.subjectId}`} href={toPath(`/friend?id=${encodeURIComponent(p.subjectId)}`)} className="lrow">
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
        <BackButton href={toPath(`/group?id=${encodeURIComponent(groupId)}`)} label="Back to the group" />
        <span className="hdr-title">Settle up</span>
        {to ? (
          <Link href={toPath(`/settle?group=${encodeURIComponent(groupId)}`)} style={{ fontSize: 14, fontWeight: 500, padding: "10px 0" }}>
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
            <Link key={o.toSubjectId} href={toPath(`/settle?group=${encodeURIComponent(group.group.id)}&to=${encodeURIComponent(o.toSubjectId)}`)} className="lrow">
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

const METHOD_TILES: { id: PayMethod; name: string; icon: string }[] = [
  { id: "upi", name: "UPI", icon: "📲" },
  { id: "cash", name: "Cash", icon: "💵" },
  { id: "bank", name: "Bank", icon: "🏦" },
];

function Pay({ group, plan, to, me }: { group: SplitecoGroupResponse; plan: SplitecoSettlePlanResponse; to: string; me: string | null }) {
  const { client } = useSession();
  const router = useRouter();
  const names = namesFrom(group.members, group.people);
  const payee = nameOf(names, to, me);
  const currency = plan.currency;
  const option = payOptions(plan).find((o) => o.toSubjectId === to) ?? null;
  const owed = option?.owed ?? { kitchen: 0, other: 0 };
  const vpa = group.upi.find((u) => u.subjectId === to)?.upiVpa ?? null;
  const upiOff = upiUnavailable({ vpa, name: payee, currency });
  const kitchenGroup = group.group.madeIn === "cookpool";
  const both = hasBothBalances(kitchenGroup, owed);
  const groupName = group.group.kind === "direct" ? "Spliteco" : group.group.name;

  const [part, setPart] = React.useState<PayPart>("all");
  const [partText, setPartText] = React.useState("");
  const [kitchenText, setKitchenText] = React.useState<string | null>(null);
  const [method, setMethod] = React.useState<PayMethod>(upiOff ? "cash" : "upi");
  const [note, setNote] = React.useState("");
  const [openedLink, setOpenedLink] = React.useState<string | null>(null);
  const [phase, setPhase] = React.useState<SlidePhase>("slide");
  const [toast, say] = useToast();
  const key = React.useRef(newIdempotencyKey());

  const amount = payAmount({
    part,
    owed,
    partMinor: parseMoney(partText),
    ownKitchenMinor: kitchenText === null ? null : (parseMoney(kitchenText) ?? 0),
    kitchenGroup,
    currency,
  });
  const amountMinor = amount.ok ? amount.amountMinor : 0;
  const split = amount.ok ? amount.split : null;
  const shown = allocationShown(amountMinor, owed, split);
  const noteText = note.trim();
  const link = upiLink({ vpa, name: payee, amountMinor, note: noteText || groupName, currency });
  const amountText = formatShort(amountMinor || option?.totalMinor || 0, currency);
  const canSlide = slideEnabled({ method, amountOk: amount.ok, link, openedLink });

  // Slide → tick + Undo; the record call waits UNDO_MS behind it, and leaving
  // the page sends what is waiting (pagehide or unmount).
  const live = React.useRef(true);
  const sayLatest = useLatest(say);
  const pay = React.useMemo(
    () =>
      new SlidePay({
        change: (p) => {
          if (live.current) setPhase(p);
        },
        failed: (err) => {
          if (live.current) sayLatest.current(`Not recorded · ${errorText(err)}`);
        },
      }),
    [sayLatest],
  );
  React.useEffect(() => {
    live.current = true;
    const leave = () => pay.flush();
    window.addEventListener("pagehide", leave);
    return () => {
      window.removeEventListener("pagehide", leave);
      pay.flush();
      live.current = false;
    };
  }, [pay]);

  function slid() {
    if (!canSlide || !amount.ok) return;
    const body = { toSubjectId: to, amountMinor: amount.amountMinor, method, note: noteText || null, ...(amount.split ? { split: amount.split } : {}) };
    pay.slide(() => client.spliteco.settle(group.group.id, body, { idempotencyKey: key.current }));
  }

  function openUpi() {
    if (!link) return;
    setOpenedLink(link);
    window.location.href = link;
  }

  if (!option) {
    return (
      <section className="stack" style={{ alignItems: "center", textAlign: "center" }}>
        <p className="empty">You don&apos;t owe {payee} anything in {groupName} right now.</p>
        <Link href={toPath(`/group?id=${encodeURIComponent(group.group.id)}`)} className="btn ghost">Back to the group</Link>
      </section>
    );
  }

  const locked = phase !== "slide";
  return (
    <div className="settle">
      <div className="settle-faces">
        <Avatar id={me ?? "me"} name="You" me={me} size={64} />
        <svg aria-label="pays" role="img" width="32" height="20" viewBox="0 0 32 20" fill="none" stroke="var(--line-strong)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M2 10h26M21 3l7 7-7 7" /></svg>
        <Avatar id={to} name={payee} me={me} size={64} />
      </div>

      <div className="settle-amount">
        <span className="settle-name">{payee}{groupName !== "Spliteco" ? <span className="dim"> · {groupName}</span> : null}</span>
        <span className="settle-big" aria-live="polite">{amountText}</span>
        <div role="radiogroup" aria-label="How much" className="settle-parts">
          {partChips({ kitchenGroup, owed, currency }).map((c) => (
            <button
              key={c.id}
              type="button"
              role="radio"
              aria-checked={part === c.id}
              disabled={locked}
              onClick={() => {
                setPart(c.id);
                if (c.id === "part" && !partText) setPartText(moneyInput(option.totalMinor));
                if (c.id !== "part") setKitchenText(null);
              }}
            >
              {c.label}
            </button>
          ))}
        </div>
        {part === "part" ? (
          <div className="settle-part">
            <label className="amount-box">
              <span>{currency === "INR" ? "₹" : currency}</span>
              <input inputMode="decimal" aria-label="Amount you paid" value={partText} disabled={locked} onChange={(e) => setPartText(e.target.value)} autoFocus style={{ width: 120 }} />
            </label>
            {both && amountMinor > 0 ? (
              kitchenText === null ? (
                <button type="button" className="settle-split" disabled={locked} onClick={() => setKitchenText(moneyInput(shown.kitchen))}>
                  Kitchen {formatShort(shown.kitchen, currency)} · Other {formatShort(shown.other, currency)} · Change
                </button>
              ) : (
                <label className="amount-box">
                  <span>Kitchen</span>
                  <input inputMode="decimal" aria-label="Kitchen part" value={kitchenText} disabled={locked} onChange={(e) => setKitchenText(e.target.value)} style={{ width: 90 }} />
                  <span className="small muted">Other {formatShort(Math.max(0, amountMinor - (parseMoney(kitchenText) ?? 0)), currency)}</span>
                </label>
              )
            ) : null}
          </div>
        ) : null}
        {!amount.ok && part === "part" ? <p className="error" role="alert">{amount.message}</p> : null}
      </div>

      <div role="radiogroup" aria-label="How you paid" className="settle-methods">
        {METHOD_TILES.map((m) => {
          const off = m.id === "upi" && upiOff !== null;
          return (
            <button
              key={m.id}
              type="button"
              role="radio"
              aria-checked={method === m.id}
              aria-disabled={off || undefined}
              disabled={off || locked}
              title={off ? (upiOff ?? undefined) : undefined}
              onClick={() => setMethod(m.id)}
            >
              <span aria-hidden="true" className="ic">{m.icon}</span>
              {m.name}
              {off ? <span className="off">{upiTileState(upiOff, currency)}</span> : null}
            </button>
          );
        })}
      </div>
      {upiOff && method !== "upi" ? <p className="small dim center" style={{ margin: 0 }}>{upiOff}</p> : null}

      {method === "upi" && !locked ? (
        <button type="button" className={`settle-upi ${openedLink === link && link ? "opened" : ""}`} disabled={!link} onClick={openUpi}>
          {openedLink === link && link ? `UPI app opened · ${vpa}` : `Open UPI app · ${amountText}`}
        </button>
      ) : null}

      {method !== "upi" && !locked ? (
        <input
          className="input settle-note"
          maxLength={60}
          value={note}
          aria-label={method === "bank" ? "Reference (optional)" : "Note (optional)"}
          onChange={(e) => setNote(e.target.value)}
          placeholder={method === "bank" ? "Reference (optional)" : "Note (optional)"}
        />
      ) : null}

      <div className="settle-foot">
        {phase === "slide" ? (
          <Slider text={slideText(method)} label={slideLabel(method, amountText, payee)} disabled={!canSlide} onFire={slid} />
        ) : (
          <div role="status" className="settle-done">
            <span className="tick"><Icon name="check" size={30} /></span>
            <span className="paid">Paid {amountText}</span>
            {phase === "held" ? (
              <button type="button" className="undo" onClick={() => pay.undo()}>Undo</button>
            ) : phase === "sending" ? (
              <span className="small dim">Recording…</span>
            ) : (
              <>
                <span className="small dim">{payee} can mark it &ldquo;not received&rdquo;.</span>
                <button type="button" className="undo" onClick={() => router.push(toPath(`/group?id=${encodeURIComponent(group.group.id)}`))}>Done</button>
              </>
            )}
          </div>
        )}
      </div>
      {toast}
    </div>
  );
}
