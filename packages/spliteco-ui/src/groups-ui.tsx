"use client";

// Money-native MY-4: the Money page shell and its Groups side (boards
// Settle_Money and Money_Ocean). The shell is the title with one 11px
// "Powered by Spliteco" line and the Groups | People switch; People takes it as
// its `header` slot (see people-ui). Colours are tokens only (`look.*`, set by a
// LookScope from the `theme` prop). The floating Expense button (MY-3, MY-7)
// mounts into the `floatingButton` slot.

import * as React from "react";
import type { SplitecoGroupSummary } from "@saas/contracts/spliteco";
import { LookScope, look, type LookTheme } from "./look.js";
import { formatShort } from "./money.js";
import { moneyTabGroups, moneyTotals, signedShort, toneOf } from "./money-tab.js";

const FONT = "'Plus Jakarta Sans', system-ui, sans-serif";
const TONE = { get: look.get, owe: look.owe, even: look.muted } as const;

export type MoneySide = "groups" | "people";

export interface MoneyHeaderProps {
  /** The side that is open. */
  side: MoneySide;
  onSide: (side: MoneySide) => void;
  /** Shown only on Groups; opens Add group. */
  onAddGroup?: () => void;
}

function Icon({ side }: { side: MoneySide }) {
  const p = { "aria-hidden": true, width: 18, height: 18, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" } as const;
  return side === "groups" ? (
    <svg {...p}>
      <rect x="3" y="4" width="18" height="16" rx="3" />
      <path d="M3 10h18" />
    </svg>
  ) : (
    <svg {...p}>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 20c1-4 4-6 8-6s7 2 8 6" />
    </svg>
  );
}

const SIDES: { side: MoneySide; label: string }[] = [
  { side: "groups", label: "Groups" },
  { side: "people", label: "People" },
];

/** The Groups | People switch: the open side is a tinted block with icon and label, the other folds to its icon. */
export function MoneySwitch({ side, onSide }: Pick<MoneyHeaderProps, "side" | "onSide">) {
  return (
    <div role="tablist" aria-label="Money" data-switch="" style={{ display: "flex", gap: 4, padding: 4, borderRadius: 12, background: look.surface }}>
      {SIDES.map((s) => {
        const open = s.side === side;
        return (
          <button
            key={s.side}
            type="button"
            role="tab"
            aria-selected={open}
            aria-label={s.label}
            data-side={s.side}
            data-open={open ? "true" : "false"}
            onClick={() => onSide(s.side)}
            style={{
              height: 40,
              minWidth: 40,
              padding: open ? "0 14px" : 0,
              borderRadius: 10,
              border: 0,
              background: open ? look.soft : "transparent",
              color: open ? look.softInk : look.muted,
              fontSize: 14,
              fontWeight: 500,
              fontFamily: "inherit",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
            }}
          >
            <Icon side={s.side} />
            {open ? <span>{s.label}</span> : null}
          </button>
        );
      })}
    </div>
  );
}

/** The title with its one Powered by Spliteco line, the switch, and + Group (Groups only). */
export function MoneyHeader({ side, onSide, onAddGroup }: MoneyHeaderProps) {
  return (
    <header data-header="" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h1 style={{ margin: 0, fontSize: 28, fontWeight: 500, letterSpacing: "-0.02em", color: look.ink }}>Money</h1>
          <div data-powered-by="" style={{ marginTop: 2, fontSize: 11, color: look.muted }}>Powered by Spliteco</div>
        </div>
        {side === "groups" && onAddGroup ? (
          <button type="button" data-action="add-group-top" onClick={onAddGroup} style={{ height: 40, padding: "0 14px", borderRadius: 10, border: 0, background: look.soft, color: look.softInk, fontSize: 14, fontWeight: 500, fontFamily: "inherit", cursor: "pointer", flex: "none" }}>
            + Group
          </button>
        ) : null}
      </div>
      <MoneySwitch side={side} onSide={onSide} />
    </header>
  );
}

export interface GroupsPageProps {
  theme: LookTheme;
  groups: readonly SplitecoGroupSummary[];
  /** The switch. People is its own page: render it with `<MoneyHeader side="people" …/>` as its `header`. */
  onSide: (side: MoneySide) => void;
  onOpenGroup: (groupId: string) => void;
  /** + Group at the top and the Add group row at the end. */
  onAddGroup: () => void;
  /** MY-3 / MY-7's floating Expense button. */
  floatingButton?: React.ReactNode;
}

function Net({ groups }: { groups: readonly SplitecoGroupSummary[] }) {
  const totals = moneyTotals(groups);
  return (
    <section data-net="" style={{ display: "flex", flexDirection: "column", gap: 10, padding: "0 4px" }}>
      {totals.map((t) => (
        <div key={t.currency} data-currency={t.currency} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={{ fontSize: 34, fontWeight: 500, letterSpacing: "-0.02em", color: TONE[toneOf(t.minor)] }}>
            {t.minor === 0 ? "Settled" : formatShort(Math.abs(t.minor), t.currency)}
          </span>
          <span style={{ fontSize: 14, color: look.muted }}>{t.words}</span>
        </div>
      ))}
    </section>
  );
}

const row: React.CSSProperties = { display: "flex", alignItems: "center", gap: 12, minHeight: 60, padding: "0 16px", width: "100%", border: 0, background: "transparent", fontFamily: "inherit", textAlign: "left", cursor: "pointer", boxSizing: "border-box" };

/** The slot MY-3's floating Expense button mounts into. Empty until then. */
function FloatingSlot({ children }: { children?: React.ReactNode }) {
  return (
    <div data-slot="floating-button" style={{ position: "absolute", inset: 0, pointerEvents: "none", zIndex: 10 }}>
      <div style={{ pointerEvents: "auto" }}>{children}</div>
    </div>
  );
}

/** Money, Groups side: the net, a row per group (name and one balance, Settled when even), and Add group last. */
export function GroupsPage({ theme, groups, onSide, onOpenGroup, onAddGroup, floatingButton }: GroupsPageProps) {
  const ordered = moneyTabGroups(groups);
  return (
    <LookScope theme={theme} style={{ position: "relative", minHeight: "100%", fontFamily: FONT, fontVariantNumeric: "tabular-nums" }}>
      <div data-page="groups" style={{ padding: "20px 20px 120px", display: "flex", flexDirection: "column", gap: 16 }}>
        <MoneyHeader side="groups" onSide={onSide} onAddGroup={onAddGroup} />
        {groups.length > 0 ? <Net groups={groups} /> : null}
        <div data-groups="" style={{ background: look.surface, borderRadius: 22, overflow: "hidden" }}>
          {ordered.map((g, i) => (
            <button key={g.id} type="button" data-group={g.id} onClick={() => onOpenGroup(g.id)} style={{ ...row, color: look.ink, borderTop: i === 0 ? undefined : `1px solid ${look.line}` }}>
              <span style={{ flex: 1, minWidth: 0, fontSize: 15, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{g.name}</span>
              <span data-balance="" style={{ fontSize: 15, fontWeight: 500, color: TONE[toneOf(g.myBalanceMinor)] }}>
                {g.myBalanceMinor === 0 ? "Settled" : signedShort(g.myBalanceMinor, g.currency)}
              </span>
            </button>
          ))}
          <button type="button" data-action="add-group-row" onClick={onAddGroup} style={{ ...row, color: look.softInk, fontSize: 15, fontWeight: 500, borderTop: ordered.length === 0 ? undefined : `1px solid ${look.line}` }}>
            <span aria-hidden style={{ fontSize: 18, lineHeight: 1 }}>+</span>
            <span>Add group</span>
          </button>
        </div>
      </div>
      <FloatingSlot>{floatingButton}</FloatingSlot>
    </LookScope>
  );
}
