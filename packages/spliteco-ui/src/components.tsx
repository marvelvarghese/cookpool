"use client";

// The shared money screens (cookpool-spliteco SE3, design §0.4): the balance
// card, the "why" list, add a bill and Settle up — the parts Cookpool's Money
// tab and the Spliteco app both draw. They hold the words, the structure and
// the behaviour; every class and the money format come from the app's theme
// (./theme.tsx), so the same part reads as Cookpool in the console and as
// Deep ocean in Spliteco. Nothing here talks to the API: an app passes what
// it read and gets called back to write.

import * as React from "react";
import { balanceHeadline, bucketParts, type BalanceView } from "./balance.js";
import { billRequest, eachText, newBill, toggleBetween, type BillDraft, type BillErrors } from "./bill.js";
import { initialSettle, settleStep, upiLink, upiUnavailable, type PayMethod, type SettleEvent, type SettleState } from "./settle.js";
import { whyAmount, type WhySection } from "./why.js";
import { cx, useSplitecoUi } from "./theme.js";
import type { SplitecoExpenseRequest } from "@saas/contracts/spliteco";

// ── The balance card ─────────────────────────────────────

export interface BalanceCardProps {
  view: BalanceView;
  /** The card's small heading ("Kitchen money"). */
  title?: string;
  /** A small mark beside the heading ("powered by Spliteco"). */
  badge?: React.ReactNode;
  /** Settle up with the person the caller pays first; left out, the card has no button. */
  onSettle?: (to: { subjectId: string; name: string; amountMinor: number }) => void;
  /** How many square rows to show after the open ones (default all). */
  squareRows?: number;
}

/** The caller's money in one group: who they owe and who owes them, and at most one button, Settle up. */
export function BalanceCard({ view, title, badge, onSettle, squareRows }: BalanceCardProps) {
  const { slots: s, money } = useSplitecoUi();
  const open = view.rows.filter((r) => r.amountMinor !== 0);
  const square = view.rows.filter((r) => r.amountMinor === 0).slice(0, squareRows ?? Number.POSITIVE_INFINITY);
  const tone = (t: "owe" | "owed" | "settled") => (t === "owe" ? s.owe : t === "owed" ? s.owed : s.settled);
  return (
    <section aria-label={title ?? "Balance"} className={cx(s.card)}>
      {title || badge ? (
        <div className={cx(s.cardHead)}>
          {title ? <span className={cx(s.cardTitle)}>{title}</span> : null}
          {badge ? <span className={cx(s.cardBadge)}>{badge}</span> : null}
        </div>
      ) : null}
      <ul aria-label={balanceHeadline(view, money)} className={cx(s.balanceRows)}>
        {open.length === 0 && square.length === 0 ? (
          <li className={cx(s.balanceRow)}>
            <span className={cx(s.balanceText)}>All square</span>
            <span className={cx(s.amount, s.settled)}>{money(0, view.currency)}</span>
          </li>
        ) : null}
        {[...open, ...square].map((r) => (
          <li key={r.subjectId} className={cx(s.balanceRow)}>
            <span className={cx(s.balanceText)}>{r.text}</span>
            <span className={cx(s.amount, tone(r.tone))}>{money(Math.abs(r.amountMinor), view.currency)}</span>
          </li>
        ))}
      </ul>
      {onSettle && view.payNext && view.canWrite ? (
        <button type="button" className={cx(s.cardAction)} onClick={() => onSettle(view.payNext!)}>
          Settle up with {view.payNext.name}
        </button>
      ) : null}
    </section>
  );
}

/** "Kitchen +₹120.00 · Other −₹40.00" — a Cookpool-made group's two balances, as Spliteco shows them. */
export function BucketLine({ myBuckets, currency, style }: { myBuckets: { kitchen: number; other: number } | null; currency: string; style?: React.CSSProperties }) {
  const { slots: s, money } = useSplitecoUi();
  const parts = bucketParts(myBuckets, currency, money);
  if (!parts) return null;
  const tone = { get: s.bucketGet, owe: s.bucketOwe, even: s.bucketEven };
  return (
    <span className={cx(s.buckets)} style={style} aria-label={parts.map((p) => `${p.label} ${p.amount}`).join(", ")}>
      {parts.map((p, i) => (
        <span key={p.label}>
          {i > 0 ? " · " : ""}
          {p.label} <b className={cx(tone[p.tone])}>{p.amount}</b>
        </span>
      ))}
    </span>
  );
}

// ── The "why" list ───────────────────────────────────────

export interface WhyListProps {
  sections: readonly WhySection[];
  title?: string;
  /** Rows before "See all" (default 6). */
  limit?: number;
  empty?: string;
  /** Opens a row (its expense, in the app that draws it). */
  href?: (id: string) => string | null;
  /** The app's link component (Next's), for rows with an href. */
  LinkAs?: React.ComponentType<{ href: string; className?: string; children: React.ReactNode }>;
}

/** What makes up the balance, one line per row, newest first, in This week and Earlier. */
export function WhyList({ sections, title = "Why", limit = 6, empty = "Nothing yet", href, LinkAs }: WhyListProps) {
  const { slots: s, money } = useSplitecoUi();
  const [all, setAll] = React.useState(false);
  const total = sections.reduce((n, sec) => n + sec.rows.length, 0);
  let left = all ? Number.POSITIVE_INFINITY : limit;
  const tone = (t: "owe" | "owed" | "settled") => (t === "owe" ? s.owe : t === "owed" ? s.owed : s.settled);
  return (
    <section aria-label={title} className={cx(s.why)}>
      <h2 className={cx(s.whyTitle)}>{title}</h2>
      {total === 0 ? <p className={cx(s.empty)}>{empty}</p> : null}
      {sections.map((sec) => {
        const rows = sec.rows.slice(0, Math.max(0, left));
        left -= rows.length;
        if (rows.length === 0) return null;
        return (
          <div key={sec.title} className={cx(s.whySection)}>
            <h3 className={cx(s.whySectionTitle)}>{sec.title}</h3>
            <ul className={cx(s.whyRows)}>
              {rows.map((r) => {
                const body = (
                  <>
                    <span className={cx(s.whyMain)}>
                      <span className={cx(s.whyRowTitle)}>{r.title}</span>
                      <span className={cx(s.whyRowDetail)}> · {r.detail}</span>
                    </span>
                    <span className={cx(s.amount, tone(r.tone))}>{whyAmount(r, money)}</span>
                  </>
                );
                const to = href?.(r.id) ?? null;
                return (
                  <li key={r.id}>
                    {to && LinkAs ? (
                      <LinkAs href={to} className={s.whyRow}>
                        {body}
                      </LinkAs>
                    ) : (
                      <div className={cx(s.whyRow)}>{body}</div>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
      {total > limit ? (
        <button type="button" className={cx(s.whyMore)} aria-expanded={all} onClick={() => setAll(!all)}>
          {all ? "Show less" : `See all ${total}`}
        </button>
      ) : null}
    </section>
  );
}

// ── Add a bill ───────────────────────────────────────────

export interface AddBillFormProps {
  members: readonly { subjectId: string; name: string }[];
  me: string;
  currency: string;
  /** `kitchen`: a bill added in Cookpool, on the Kitchen balance. */
  bucket?: "kitchen" | null;
  /** Saves the request; resolves when saved, rejects with the words to show. */
  onSubmit: (request: SplitecoExpenseRequest) => Promise<void>;
  submitLabel?: string;
  /** An id prefix for the fields (several forms on a page). */
  idPrefix?: string;
}

/** What it was, how much, who paid, and who shares it equally. */
export function AddBillForm({ members, me, currency, bucket = null, onSubmit, submitLabel = "Add bill", idPrefix = "bill" }: AddBillFormProps) {
  const { slots: s, money } = useSplitecoUi();
  const ids = React.useMemo(() => members.map((m) => m.subjectId), [members]);
  const [draft, setDraft] = React.useState<BillDraft>(() => newBill(me, ids));
  const [errors, setErrors] = React.useState<BillErrors>({});
  const [busy, setBusy] = React.useState(false);
  const [failed, setFailed] = React.useState<string | null>(null);
  const each = eachText(draft, currency, money);
  const set = (patch: Partial<BillDraft>) => setDraft((d) => ({ ...d, ...patch }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    const checked = billRequest(draft, ids, { bucket });
    if (!checked.ok) {
      setErrors(checked.errors);
      return;
    }
    setErrors({});
    setFailed(null);
    setBusy(true);
    try {
      await onSubmit(checked.request);
    } catch (err) {
      setFailed(err instanceof Error && err.message ? err.message : "Couldn't add the bill. Try again.");
    } finally {
      setBusy(false);
    }
  }

  const fieldError = (k: keyof BillErrors) =>
    errors[k] ? (
      <span id={`${idPrefix}-${k}-error`} className={cx(s.error)} role="alert">
        {errors[k]}
      </span>
    ) : null;

  return (
    <form className={cx(s.form)} onSubmit={(e) => void submit(e)} noValidate aria-label="Add a bill">
      <label className={cx(s.field)} htmlFor={`${idPrefix}-title`}>
        <span className={cx(s.label)}>What was it?</span>
        <input
          id={`${idPrefix}-title`}
          className={cx(s.input)}
          value={draft.title}
          maxLength={120}
          placeholder="Gas cylinder"
          aria-invalid={!!errors.title}
          aria-describedby={errors.title ? `${idPrefix}-title-error` : undefined}
          onChange={(e) => set({ title: e.target.value })}
        />
        {fieldError("title")}
      </label>
      <label className={cx(s.field)} htmlFor={`${idPrefix}-amount`}>
        <span className={cx(s.label)}>How much? ({currency})</span>
        <input
          id={`${idPrefix}-amount`}
          className={cx(s.input)}
          inputMode="decimal"
          value={draft.amount}
          placeholder="0.00"
          aria-invalid={!!errors.amount}
          aria-describedby={errors.amount ? `${idPrefix}-amount-error` : undefined}
          onChange={(e) => set({ amount: e.target.value })}
        />
        {fieldError("amount")}
      </label>
      <label className={cx(s.field)} htmlFor={`${idPrefix}-payer`}>
        <span className={cx(s.label)}>Who paid?</span>
        <select id={`${idPrefix}-payer`} className={cx(s.select)} value={draft.payerId} onChange={(e) => set({ payerId: e.target.value })}>
          {members.map((m) => (
            <option key={m.subjectId} value={m.subjectId}>
              {m.subjectId === me ? "You" : m.name}
            </option>
          ))}
        </select>
        {fieldError("payer")}
      </label>
      <fieldset className={cx(s.field)}>
        <legend className={cx(s.label)}>Split equally between</legend>
        <div className={cx(s.chips)}>
          {members.map((m) => {
            const on = draft.between.includes(m.subjectId);
            return (
              <button
                key={m.subjectId}
                type="button"
                role="checkbox"
                aria-checked={on}
                className={cx(s.chip)}
                onClick={() => setDraft((d) => toggleBetween(d, m.subjectId))}
              >
                {m.subjectId === me ? "You" : m.name}
              </button>
            );
          })}
        </div>
        {each ? <span className={cx(s.hint)}>{each}</span> : null}
        {fieldError("between")}
      </fieldset>
      {failed ? (
        <p className={cx(s.error)} role="alert">
          {failed}
        </p>
      ) : null}
      <button type="submit" className={cx(s.button)} disabled={busy}>
        {busy ? "Adding…" : submitLabel}
      </button>
    </form>
  );
}

// ── Settle up ────────────────────────────────────────────

const METHODS: { id: PayMethod; badge: string; name: string }[] = [
  { id: "upi", badge: "UPI", name: "Pay with a UPI app" },
  { id: "cash", badge: "₹", name: "I paid in cash" },
  { id: "bank", badge: "IMPS", name: "Bank transfer" },
];

/** The note under each way to pay. */
export function methodNote(method: PayMethod, input: { upiOff: string | null; amount: string; vpa: string | null; note: string; payee: string }): string {
  if (method === "upi") return input.upiOff ?? `Opens your app with ${input.amount} to ${input.vpa} and "${input.note}" as the note`;
  if (method === "cash") return `Records it now. ${input.payee} gets a heads-up.`;
  return "Records it now, with an optional reference number";
}

export interface PayMethodsProps {
  value: PayMethod;
  onPick: (method: PayMethod) => void;
  /** Why UPI can't be used here, or null. */
  upiOff: string | null;
  note: (method: PayMethod) => string;
  /** While saving or done, nothing can be picked. */
  locked?: boolean;
  label?: string;
}

/** UPI, cash or bank: one radio group, UPI off (with why) when the payee has no UPI ID. */
export function PayMethods({ value, onPick, upiOff, note, locked = false, label = "How you paid" }: PayMethodsProps) {
  const { slots: s } = useSplitecoUi();
  return (
    <section aria-label={label} role="radiogroup" className={cx(s.methods)}>
      {METHODS.map((m) => {
        const on = value === m.id;
        const off = m.id === "upi" && upiOff !== null;
        return (
          <button
            key={m.id}
            type="button"
            role="radio"
            aria-checked={on}
            aria-disabled={off}
            disabled={off || locked}
            onClick={() => onPick(m.id)}
            className={cx(s.method, on && s.methodOn)}
          >
            <span className={cx(s.badge)}>{m.badge}</span>
            <span className={cx(s.methodMain)}>
              <span className={cx(s.methodTitle)}>{m.name}</span>
              <span className={cx(s.methodNote)}>{note(m.id)}</span>
            </span>
            <span className={cx(s.radio, on && s.radioOn)} aria-hidden="true" />
          </button>
        );
      })}
    </section>
  );
}

export interface UpiConfirmProps {
  payee: string;
  amountText: string;
  link: string | null;
  error: string | null;
  onPaid: () => void;
  onDidnt: () => void;
}

/** Back from the UPI app: "I paid ₹X" records it, "It didn't" records nothing. */
export function UpiConfirm({ payee, amountText, link, error, onPaid, onDidnt }: UpiConfirmProps) {
  const { slots: s } = useSplitecoUi();
  return (
    <section aria-label="Did it go through?" className={cx(s.confirm)} role="alertdialog">
      <b className={cx(s.confirmTitle)}>Back from your UPI app — did it go through?</b>
      <span className={cx(s.confirmNote)}>We only record it when you say so. {payee} can mark it &ldquo;not received&rdquo;.</span>
      {error ? (
        <p className={cx(s.error)} role="alert">
          {error}
        </p>
      ) : null}
      <div className={cx(s.confirmActions)}>
        <button type="button" className={cx(s.confirmButton)} onClick={onPaid}>
          I paid {amountText}
        </button>
        <button type="button" className={cx(s.confirmQuiet)} onClick={onDidnt}>
          It didn&apos;t
        </button>
      </div>
      {link ? (
        <a href={link} className={cx(s.link)}>
          Open the UPI app again
        </a>
      ) : null}
    </section>
  );
}

export interface SettleUpProps {
  payee: { subjectId: string; name: string; upiVpa: string | null };
  /** "Flat 4B": the group, and UPI's default note. */
  groupName: string;
  amountMinor: number;
  currency: string;
  /** Records the payment (the caller paid `payee`); rejects with the words to show. */
  onRecord: (method: PayMethod, note: string | null) => Promise<void>;
  /** After "Done". */
  onDone: () => void;
  /** Opens the UPI link (the browser's navigation by default). */
  openLink?: (href: string) => void;
}

/**
 * Settle up with one person, the whole amount: UPI (the `upi://pay` link, then
 * "I paid" or "It didn't"), cash or bank (recorded in one tap). The steps are
 * ./settle.ts's `settleStep`; nothing is recorded until the payer says so.
 */
export function SettleUp({ payee, groupName, amountMinor, currency, onRecord, onDone, openLink }: SettleUpProps) {
  const { slots: s, money } = useSplitecoUi();
  const upiOff = upiUnavailable({ vpa: payee.upiVpa, name: payee.name, currency });
  const [flow, setFlow] = React.useState<SettleState>(() => initialSettle(upiOff ? "cash" : "upi"));
  const [note, setNote] = React.useState("");
  const flowRef = React.useRef(flow);
  const noteText = note.trim() || groupName;
  const link = upiLink({ vpa: payee.upiVpa, name: payee.name, amountMinor, note: noteText, currency });
  const amount = money(amountMinor, currency);

  async function record(method: PayMethod) {
    try {
      await onRecord(method, note.trim() || null);
      dispatch({ type: "saved" });
    } catch (err) {
      dispatch({ type: "failed", message: err instanceof Error && err.message ? err.message : "Couldn't record it. Try again." });
    }
  }

  function dispatch(event: SettleEvent) {
    const { state, effect } = settleStep(flowRef.current, event);
    flowRef.current = state;
    setFlow(state);
    if (effect === "open_upi" && link) (openLink ?? ((href: string) => window.location.assign(href)))(link);
    if (effect === "record") void record(state.method);
  }

  if (flow.step === "done") {
    return (
      <section className={cx(s.done)} role="status">
        <h2 className={cx(s.doneTitle)}>
          Recorded {amount} to {payee.name}
        </h2>
        <p className={cx(s.doneNote)}>{payee.name} gets a heads-up, and can mark it &ldquo;not received&rdquo; if it never arrived.</p>
        <button type="button" className={cx(s.button)} onClick={onDone}>
          Done
        </button>
      </section>
    );
  }

  return (
    <>
      <section aria-label="What you pay" className={cx(s.payHeader)}>
        <span className={cx(s.payWho)}>
          You pay {payee.name} · {groupName}
        </span>
        <b className={cx(s.payAmount, s.owe)} aria-live="polite">
          {amount}
        </b>
      </section>
      <PayMethods
        value={flow.method}
        upiOff={upiOff}
        locked={flow.step !== "pick"}
        onPick={(method) => dispatch({ type: "pick", method })}
        note={(m) => methodNote(m, { upiOff, amount, vpa: payee.upiVpa, note: noteText, payee: payee.name })}
      />
      <label className={cx(s.field)}>
        <span className={cx(s.label)}>{flow.method === "bank" ? "Reference (optional)" : "Note (optional)"}</span>
        <input
          className={cx(s.input)}
          maxLength={60}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder={flow.method === "bank" ? "UTR or IMPS reference" : groupName}
        />
      </label>
      <div className={cx(s.footer)}>
        {flow.step === "confirm" ? (
          <UpiConfirm payee={payee.name} amountText={amount} link={link} error={flow.error} onPaid={() => dispatch({ type: "paid" })} onDidnt={() => dispatch({ type: "didnt" })} />
        ) : (
          <>
            {flow.error ? (
              <p className={cx(s.error)} role="alert">
                {flow.error}
              </p>
            ) : null}
            <button
              type="button"
              className={cx(s.button)}
              disabled={flow.step === "saving" || (flow.method === "upi" && !link)}
              onClick={() => dispatch({ type: "go" })}
            >
              {flow.step === "saving" ? "Recording…" : flow.method === "upi" ? `Open UPI app · ${amount}` : `Record ${amount} paid to ${payee.name}`}
            </button>
          </>
        )}
      </div>
    </>
  );
}
