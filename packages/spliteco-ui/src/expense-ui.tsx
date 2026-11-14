"use client";

// Money-native MY-7: the expense box. `ExpenseButton` is the floating "+ Expense"
// of the Groups page (an ExpandButton of kind `expense`); `ExpenseBox` is what
// is inside it. Fields: amount, description, group, paid by, an Equal | Exact
// switch, each person's share, and Save. The API is a prop (`createExpense`,
// the shape of Spliteco's own client call), so Cookpool and the Spliteco app
// both mount it. Colours are tokens only; the theme comes from the prop.

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

const FONT = "'Plus Jakarta Sans', system-ui, sans-serif";
const field: React.CSSProperties = {
  height: 44, borderRadius: 10, border: `1px solid ${look.line}`, background: look.surface, color: look.ink,
  padding: "0 12px", font: "inherit", fontSize: 15, boxSizing: "border-box", minWidth: 0,
};
const labelStyle: React.CSSProperties = { display: "flex", flexDirection: "column", gap: 4, fontSize: 12, color: look.muted };

const nameOf = (m: { name: string | null }) => m.name ?? "Someone";

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

  return (
    <LookScope theme={theme} style={{ background: "transparent", fontFamily: FONT, display: "flex", flexDirection: "column", gap: 12, minHeight: 0 }}>
      <form
        data-expense-box=""
        onSubmit={(e) => { e.preventDefault(); void save(); }}
        style={{ display: "flex", flexDirection: "column", gap: 12 }}
      >
        <label style={labelStyle}>
          Amount
          <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span aria-hidden="true" style={{ fontSize: 22, color: look.muted }}>{currencySymbol(currency)}</span>
            <input
              name="amount" inputMode="decimal" autoComplete="off" placeholder="0" value={draft.amount}
              onChange={(e) => set({ amount: e.target.value })}
              style={{ ...field, flex: 1, fontSize: 22, fontWeight: 500, height: 52 }}
            />
          </span>
        </label>
        <label style={labelStyle}>
          What for
          <input name="description" autoComplete="off" value={draft.description} onChange={(e) => set({ description: e.target.value })} style={field} />
        </label>
        <div style={{ display: "flex", gap: 8 }}>
          <label style={{ ...labelStyle, flex: 1 }}>
            Group
            <select name="group" value={draft.groupId} onChange={(e) => { const g = groups.find((x) => x.id === e.target.value); if (g) { setFailed(false); setDraft((d) => withGroup(d, g, me)); } }} style={field}>
              {groups.map((g) => (<option key={g.id} value={g.id}>{`${g.name} · ${g.currency}`}</option>))}
            </select>
          </label>
          <label style={{ ...labelStyle, flex: 1 }}>
            Paid by
            <select name="payer" value={draft.payerId} onChange={(e) => set({ payerId: e.target.value })} style={field}>
              {(group?.members ?? []).map((m) => (<option key={m.subjectId} value={m.subjectId}>{m.subjectId === me ? "You" : nameOf(m)}</option>))}
            </select>
          </label>
        </div>
        <div role="radiogroup" aria-label="Split" data-switch="split" style={{ display: "flex", gap: 4, padding: 4, borderRadius: 12, background: look.bg }}>
          {(["equal", "exact"] as ExpenseSplitMethod[]).map((m) => {
            const on = draft.method === m;
            return (
              <button
                key={m} type="button" role="radio" aria-checked={on} data-method={m}
                onClick={() => set({ method: m })}
                style={{ flex: 1, height: 36, border: 0, borderRadius: 9, font: "inherit", fontSize: 14, fontWeight: 500, cursor: "pointer", background: on ? look.soft : "transparent", color: on ? look.softInk : look.muted }}
              >
                {m === "equal" ? "Equal" : "Exact"}
              </button>
            );
          })}
        </div>
        <ul data-shares="" style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column" }}>
          {(group?.members ?? []).map((m, i) => {
            const row = rows[i]!;
            return (
              <li key={m.subjectId} data-person={m.subjectId} style={{ display: "flex", alignItems: "center", gap: 10, minHeight: 48, borderTop: i === 0 ? undefined : `1px solid ${look.line}` }}>
                {draft.method === "equal" ? (
                  <label style={{ display: "flex", alignItems: "center", gap: 10, flex: 1, minWidth: 0, fontSize: 15 }}>
                    <input type="checkbox" checked={draft.between.includes(m.subjectId)} onChange={() => setDraft((d) => toggleSharer(d, m.subjectId))} style={{ accentColor: look.primary, width: 18, height: 18 }} />
                    <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.subjectId === me ? "You" : nameOf(m)}</span>
                  </label>
                ) : (
                  <span style={{ flex: 1, minWidth: 0, fontSize: 15, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.subjectId === me ? "You" : nameOf(m)}</span>
                )}
                {draft.method === "equal" ? (
                  <span data-share="" style={{ fontSize: 15, fontWeight: 500, color: draft.between.includes(m.subjectId) ? look.ink : look.muted }}>
                    {draft.between.includes(m.subjectId) && row.shareMinor !== null && parseTotal(draft.amount) ? formatShort(row.shareMinor, currency) : "—"}
                  </span>
                ) : (
                  <input
                    aria-label={`${m.subjectId === me ? "You" : nameOf(m)} share`} inputMode="decimal" autoComplete="off" placeholder="0"
                    value={draft.exact[m.subjectId] ?? ""}
                    onChange={(e) => set({ exact: { ...draft.exact, [m.subjectId]: e.target.value } })}
                    style={{ ...field, width: 110, height: 38, textAlign: "right" }}
                  />
                )}
              </li>
            );
          })}
        </ul>
        {draft.method === "exact" && gapText ? (
          <div role="status" data-gap="" style={{ fontSize: 13, fontWeight: 500, color: look.owe }}>{gapText}</div>
        ) : null}
        {failed ? <div role="alert" style={{ fontSize: 13, color: look.owe }}>Could not save. Try again.</div> : null}
        <button
          type="submit" data-action="save" disabled={!check.ok || saving}
          style={{ height: 48, border: 0, borderRadius: 12, font: "inherit", fontSize: 15, fontWeight: 500, background: look.primary, color: look.onPrimary, cursor: check.ok && !saving ? "pointer" : "default", opacity: check.ok && !saving ? 1 : 0.4 }}
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
      kind="expense" label={label} theme={box.theme} boxHeight={620}
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
