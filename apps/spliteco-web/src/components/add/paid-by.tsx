"use client";

import { Avatar, AddsUpBar } from "../ui";
import { formatMoney } from "../../lib/money";
import { nameOf } from "../../lib/people";
import { payersOf, payersStatus, totalOf } from "../../lib/split-form";
import type { FormCtx } from "./types";

/** Who paid: one person, or several with what each paid (it must add up to the total). */
export function PaidByView({ ctx, onDone }: { ctx: FormCtx; onDone: () => void }) {
  const { form, setForm, names, me, currency } = ctx;
  const total = totalOf(form) ?? 0;
  const status = payersStatus(form);
  const many = form.payerMode === "many";
  const payers = payersOf(form, total);
  const left = many
    ? payers.map((p) => `${nameOf(names, p.subjectId, me)} ${formatMoney(Math.max(0, p.amountMinor), currency)}`).join(" + ") || "Nobody yet"
    : `${nameOf(names, form.payer, me)} paid all of it`;
  const right = many
    ? status.ok
      ? `${formatMoney(status.paidMinor, currency)} of ${formatMoney(total, currency)} · adds up`
      : status.paidMinor < total
        ? `${formatMoney(total - status.paidMinor, currency)} left`
        : `${formatMoney(status.paidMinor - total, currency)} too much`
    : formatMoney(total, currency);

  return (
    <div className="page form" style={{ padding: 0 }}>
      <header className="hdr">
        <div className="stack" style={{ gap: 3 }}>
          <h1 className="h1" style={{ fontSize: 22 }}>Who paid?</h1>
          <span className="small dim" style={{ fontSize: 13 }}>
            {form.title || "This expense"} · {formatMoney(total, currency)}
          </span>
        </div>
        <button className="pillbtn" onClick={onDone} disabled={many && !status.ok} style={{ background: "var(--raised)", fontWeight: 500 }}>
          Done
        </button>
      </header>
      <div role="tablist" aria-label="Payers" className="seg inset">
        <button role="tab" aria-selected={!many} onClick={() => setForm((f) => ({ ...f, payerMode: "one" }))}>
          One person
        </button>
        <button role="tab" aria-selected={many} onClick={() => setForm((f) => ({ ...f, payerMode: "many" }))}>
          Several people
        </button>
      </div>
      <div className="stack s8">
        {form.members.map((id) => {
          const name = nameOf(names, id, me);
          if (!many) {
            const on = form.payer === id;
            return (
              <button
                key={id}
                aria-pressed={on}
                onClick={() => setForm((f) => ({ ...f, payer: id }))}
                className="prow"
                style={{ height: 62, minHeight: 62, background: on ? "rgba(37,99,235,0.16)" : "var(--raised)", borderColor: on ? "var(--cobalt)" : "var(--line)", color: "var(--text)", textAlign: "left" }}
              >
                <Avatar id={id} name={name} me={me} size={38} />
                <span style={{ flex: 1, fontSize: 15, fontWeight: 500 }}>{name}</span>
                <span className={`radio ${on ? "on" : ""}`} aria-hidden="true" />
              </button>
            );
          }
          const value = form.payerAmounts[id] ?? "";
          return (
            <label key={id} className="prow" style={{ background: "var(--raised)", minHeight: 62 }}>
              <Avatar id={id} name={name} me={me} size={38} />
              <span style={{ flex: 1, fontSize: 15, fontWeight: 500 }}>{name}</span>
              <span className="amount-box" style={{ borderColor: value ? "rgba(255,200,87,0.4)" : undefined }}>
                <span>{currency === "INR" ? "₹" : currency}</span>
                <input
                  inputMode="decimal"
                  aria-label={`${name} paid`}
                  placeholder="0.00"
                  value={value}
                  onChange={(e) => setForm((f) => ({ ...f, payerAmounts: { ...f.payerAmounts, [id]: e.target.value } }))}
                  style={{ color: value ? "var(--money)" : undefined }}
                />
              </span>
            </label>
          );
        })}
      </div>
      <div className="footer-fixed">
        <div>
          <AddsUpBar left={left} right={right} ok={status.ok} ratio={total ? status.paidMinor / total : 0} />
          <button className="btn big" onClick={onDone} disabled={many && !status.ok}>
            {many && !status.ok ? "Make it add up to continue" : "Done"}
          </button>
        </div>
      </div>
    </div>
  );
}
