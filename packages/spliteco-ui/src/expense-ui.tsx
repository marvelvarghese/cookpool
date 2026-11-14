"use client";

// Money-native MY-7: the expense box. `ExpenseButton` is the floating "+ Expense"
// of the Groups page (an ExpandButton of kind `expense`); `ExpenseBox` is what
// is inside it. Fields: amount, description, group, paid by, an Equal | Exact
// switch, each person's share, and Save. The API is a prop (`createExpense`,
// the shape of Spliteco's own client call), so Cookpool and the Spliteco app
// both mount it. Colours are tokens only; the theme comes from the prop.

import { BOARD_FONT } from "./board.js";
import * as React from "react";
import type { SplitecoExpenseRequest, SplitecoWriteResponse } from "@saas/contracts/spliteco";
import { ExpandButton } from "./expand-button.js";
import { look, LookScope, type LookTheme } from "./look.js";
import { currencySymbol, formatShort } from "./money.js";
import {
  exactGap, expenseRequest, newExpense, shareRows, toggleSharer, withGroup,
  type ExpenseDraft, type ExpenseGroup, type ExpenseSplitMethod,
} from "./expense.js";

export interface ExpenseApi {
  /** Spliteco's create-expense call: POST /v1/spliteco/groups/{group}/expenses. */
  createExpense: (groupId: string, body: SplitecoExpenseRequest) => Promise<SplitecoWriteResponse | unknown>;
}

export interface ExpenseBoxProps extends ExpenseApi {
  theme: LookTheme;
  groups: readonly ExpenseGroup[];
  /** The caller's subject id; they start as the one who paid. */
  me: string;
  /** The group it opens on; the first group otherwise. */
  defaultGroupId?: string;
  /** Called after a save, with the group it was added to and the answer. */
  onSaved?: (groupId: string, response: SplitecoWriteResponse | unknown) => void;
  /** Close the box (from the ExpandButton's `close`). Called after a save. */
  onClose?: () => void;
}

const FONT = BOARD_FONT;
// The ExpandButton board's markup, number for number: a 40px amount over a 14px note, two 52px tiles,
// a 40px Equal | Exact switch, a 14px-radius card of 44px rows with 28px avatars, a 13px note, a 52px Save.
const bare: React.CSSProperties = { border: 0, background: "transparent", color: "inherit", font: "inherit", padding: 0, margin: 0, outlineOffset: 2 };
const tile: React.CSSProperties = {
  position: "relative", flex: 1, minWidth: 0, height: 52, borderRadius: 12, background: look.bg, display: "flex", flexDirection: "column",
  justifyContent: "center", gap: 1, padding: "0 12px", boxSizing: "border-box",
};
const tileSelect: React.CSSProperties = { position: "absolute", inset: 0, width: "100%", height: "100%", opacity: 0, cursor: "pointer", font: "inherit" };

const nameOf = (m: { name: string | null }) => m.name ?? "Someone";
const initialOf = (name: string) => (name.trim()[0] ?? "?").toUpperCase();

/** What is inside the Expense box. Mount it in an ExpandButton, or anywhere in a theme. */
export function ExpenseBox({ theme, groups, me, defaultGroupId, createExpense, onSaved, onClose }: ExpenseBoxProps) {
  const first = groups.find((g) => g.id === defaultGroupId) ?? groups[0];
  const [draft, setDraft] = React.useState<ExpenseDraft>(() => newExpense(first, me));
  const [saving, setSaving] = React.useState(false);
  const [failed, setFailed] = React.useState(false);
  const group = groups.find((g) => g.id === draft.groupId);
  const check = expenseRequest(draft, groups);
  const rows = shareRows(draft, group);
  const gap = draft.method === "exact" ? exactGap(draft, group) : 0;
  const currency = group?.currency ?? "INR";
  const set = (patch: Partial<ExpenseDraft>) => { setFailed(false); setDraft((d) => ({ ...d, ...patch })); };

  const save = async () => {
    if (!check.ok || saving) return;
    setSaving(true);
    setFailed(false);
    try {
      const res = await createExpense(draft.groupId, check.request);
      onSaved?.(draft.groupId, res);
      onClose?.();
    } catch {
      setFailed(true);
    } finally {
      setSaving(false);
    }
  };

  const gapText = gap === null || gap === 0 ? null : gap > 0 ? `${formatShort(gap, currency)} left` : `${formatShort(-gap, currency)} over`;
  const members = group?.members ?? [];
  const who = (m: { subjectId: string; name: string | null }) => (m.subjectId === me ? "You" : nameOf(m));
  const payer = members.find((m) => m.subjectId === draft.payerId);

  return (
    <LookScope theme={theme} style={{ background: "transparent", fontFamily: FONT, fontVariantNumeric: "tabular-nums", display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
      <form
        data-expense-box=""
        onSubmit={(e) => { e.preventDefault(); void save(); }}
        style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", gap: 12 }}
      >
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
          <span style={{ display: "flex", alignItems: "baseline", justifyContent: "center", fontSize: 40, fontWeight: 500, letterSpacing: "-0.02em" }}>
            <span aria-hidden="true">{currencySymbol(currency)}</span>
            <input
              name="amount" aria-label="Amount" inputMode="decimal" autoComplete="off" placeholder="0" value={draft.amount}
              onChange={(e) => set({ amount: e.target.value })}
              style={{ ...bare, fontSize: 40, fontWeight: 500, letterSpacing: "-0.02em", fontVariantNumeric: "tabular-nums", width: `${Math.max(1, draft.amount.length)}ch`, minWidth: "1ch", maxWidth: 280 }}
            />
          </span>
          <input
            name="description" aria-label="What for" autoComplete="off" placeholder="What for" value={draft.description}
            onChange={(e) => set({ description: e.target.value })}
            style={{ ...bare, width: "100%", textAlign: "center", fontSize: 14, color: look.muted }}
          />
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <label style={tile}>
            <span style={{ fontSize: 12, color: look.muted }}>Group</span>
            <span aria-hidden="true" style={{ fontSize: 15, fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{`${group?.name ?? ""} ▾`}</span>
            <select name="group" aria-label="Group" value={draft.groupId} onChange={(e) => { const g = groups.find((x) => x.id === e.target.value); if (g) { setFailed(false); setDraft((d) => withGroup(d, g, me)); } }} style={tileSelect}>
              {groups.map((g) => (<option key={g.id} value={g.id}>{`${g.name} · ${g.currency}`}</option>))}
            </select>
          </label>
          <label style={tile}>
            <span style={{ fontSize: 12, color: look.muted }}>Paid by</span>
            <span aria-hidden="true" style={{ fontSize: 15, fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{`${payer ? who(payer) : ""} ▾`}</span>
            <select name="payer" aria-label="Paid by" value={draft.payerId} onChange={(e) => set({ payerId: e.target.value })} style={tileSelect}>
              {members.map((m) => (<option key={m.subjectId} value={m.subjectId}>{who(m)}</option>))}
            </select>
          </label>
        </div>
        <div role="radiogroup" aria-label="Split" data-switch="split" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4, padding: 4, borderRadius: 12, background: look.bg }}>
          {(["equal", "exact"] as ExpenseSplitMethod[]).map((m) => {
            const on = draft.method === m;
            return (
              <button
                key={m} type="button" role="radio" aria-checked={on} data-method={m}
                onClick={() => set({ method: m })}
                style={{ height: 40, border: 0, borderRadius: 9, font: "inherit", fontSize: 14, fontWeight: 500, cursor: "pointer", background: on ? look.primary : "transparent", color: on ? look.onPrimary : look.ink }}
              >
                {m === "equal" ? "Equal" : "Exact"}
              </button>
            );
          })}
        </div>
        <ul data-shares="" style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", background: look.bg, borderRadius: 14, overflow: "hidden" }}>
          {members.map((m, i) => {
            const row = rows[i]!;
            const label = who(m);
            const sharing = draft.between.includes(m.subjectId);
            const rowStyle: React.CSSProperties = { display: "flex", alignItems: "center", gap: 10, height: 44, padding: "0 14px", boxSizing: "border-box", borderTop: `1px solid ${i === 0 ? "transparent" : look.line}` };
            const avatar = (
              <span aria-hidden="true" style={{ width: 28, height: 28, borderRadius: "50%", background: look.soft, color: look.softInk, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 500, flex: "none" }}>
                {initialOf(label)}
              </span>
            );
            const nameText = <span style={{ flex: 1, minWidth: 0, fontSize: 15, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</span>;
            return (
              <li key={m.subjectId} data-person={m.subjectId} style={{ margin: 0 }}>
                {draft.method === "equal" ? (
                  <label style={{ ...rowStyle, cursor: "pointer", opacity: sharing ? 1 : 0.45 }}>
                    <input type="checkbox" aria-label={label} checked={sharing} onChange={() => setDraft((d) => toggleSharer(d, m.subjectId))} style={{ position: "absolute", opacity: 0, width: 1, height: 1, margin: 0 }} />
                    {avatar}
                    {nameText}
                    <span data-share="" style={{ fontSize: 15, fontWeight: 500 }}>
                      {sharing && row.shareMinor !== null && parseTotal(draft.amount) ? formatShort(row.shareMinor, currency) : "—"}
                    </span>
                  </label>
                ) : (
                  <div style={rowStyle}>
                    {avatar}
                    {nameText}
                    <input
                      aria-label={`${label} share`} inputMode="decimal" autoComplete="off" placeholder="0"
                      value={draft.exact[m.subjectId] ?? ""}
                      onChange={(e) => set({ exact: { ...draft.exact, [m.subjectId]: e.target.value } })}
                      style={{ ...bare, width: 96, textAlign: "right", fontSize: 15, fontWeight: 500, fontVariantNumeric: "tabular-nums" }}
                    />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
        {draft.method === "exact" && gapText ? (
          <span role="status" data-gap="" style={{ textAlign: "center", fontSize: 13, fontWeight: 500, color: look.owe }}>{gapText}</span>
        ) : (
          <span style={{ textAlign: "center", fontSize: 13, color: look.muted }} />
        )}
        {failed ? <div role="alert" style={{ fontSize: 13, color: look.owe, textAlign: "center" }}>Could not save. Try again.</div> : null}
        <span style={{ flex: 1 }} />
        <button
          type="submit" data-action="save" disabled={!check.ok || saving}
          style={{ height: 52, flex: "none", border: 0, borderRadius: 12, font: "inherit", fontSize: 15, fontWeight: 500, background: look.primary, color: look.onPrimary, cursor: check.ok && !saving ? "pointer" : "default", opacity: check.ok && !saving ? 1 : 0.4 }}
        >
          Save
        </button>
      </form>
    </LookScope>
  );
}

function parseTotal(amount: string): boolean {
  return amount.trim() !== "" && /[1-9]/.test(amount);
}

export interface ExpenseButtonProps extends ExpenseBoxProps {
  /** The button's text. Default "Expense". */
  label?: string;
  bottomOffset?: number;
  contained?: boolean;
  reduceMotion?: boolean;
  defaultOpen?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

/** The Groups page's floating "+ Expense": pass it as `floatingButton`. */
export function ExpenseButton({ label = "Expense", bottomOffset, contained, reduceMotion, defaultOpen, open, onOpenChange, ...box }: ExpenseButtonProps) {
  return (
    <ExpandButton
      kind="expense" label={label} theme={box.theme}
      {...(bottomOffset !== undefined ? { bottomOffset } : {})}
      {...(contained !== undefined ? { contained } : {})}
      {...(reduceMotion !== undefined ? { reduceMotion } : {})}
      {...(defaultOpen !== undefined ? { defaultOpen } : {})}
      {...(open !== undefined ? { open } : {})}
      {...(onOpenChange !== undefined ? { onOpenChange } : {})}
    >
      {({ close }) => <ExpenseBox {...box} onClose={() => { box.onClose?.(); close(); }} />}
    </ExpandButton>
  );
}
