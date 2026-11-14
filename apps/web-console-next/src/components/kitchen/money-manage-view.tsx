"use client";

import * as React from "react";
import type { KitchenSettings, WastePolicy } from "@saas/contracts/kitchen";
import type { SplitecoGroupResponse } from "@saas/contracts/spliteco";
import { LookScope, look } from "@saas/spliteco-ui/look";
import { signedShort } from "@saas/spliteco-ui/money-tab";
import { GROUP_CURRENCIES, WASTE_RULES } from "./groups";
import {
  WASTE_ROW_WORDS,
  isKitchenGroup,
  managePeople,
  manageRights,
  type ManagePerson,
  type ManageRights,
} from "./money-manage";

const FONT = "'Plus Jakarta Sans', system-ui, sans-serif";
/** Flat corners: 12px for cards and sheets, 10px for small buttons. */
const CARD = { background: look.surface, borderRadius: 12, overflow: "hidden" } as const;
const ROW = { display: "flex", alignItems: "center", gap: 12, minHeight: 50, padding: "0 16px", width: "100%", border: 0, background: "transparent", color: look.ink, font: "inherit", fontSize: 15, fontWeight: 500, textAlign: "left" } as const;
const LABEL = { flex: 1, minWidth: 0 } as const;
const VALUE = { fontSize: 14, fontWeight: 400, color: look.muted } as const;
const SECTION = { margin: 0, padding: "0 2px", fontSize: 13, fontWeight: 500, color: look.muted } as const;
const divider = (i: number) => (i === 0 ? {} : { borderTop: `1px solid ${look.line}` });

const Chevron = ({ down = false }: { down?: boolean }) => (
  <svg aria-hidden width={16} height={16} viewBox="0 0 24 24" fill="none" stroke={look.muted} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
    <path d={down ? "M6 9l6 6 6-6" : "M9 5l7 7-7 7"} />
  </svg>
);

const BackIcon = () => (
  <svg aria-hidden width={20} height={20} viewBox="0 0 24 24" fill="none" stroke={look.muted} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <path d="M15 5l-7 7 7 7" />
  </svg>
);

/** Everything the page shows and every change it can make; the container fills it from the API. */
export interface ManageGroupViewProps {
  detail: SplitecoGroupResponse;
  meId: string | null;
  /** Null while it is unread, or when this person may not see it. */
  settings: KitchenSettings | null;
  joinLink: string | null;
  rights?: ManageRights;
  onBack: () => void;
  onSimplify: (on: boolean) => void;
  onCurrency: (code: string) => void;
  onWaste: (rule: WastePolicy) => void;
  onCopyLink: () => void;
  onLeave: () => void;
  /** A warning to show under Currency (the change rule). */
  currencyWarning?: string | null;
  /** The food-rule sheet is open. */
  wasteOpen?: boolean;
  onWasteOpen?: (open: boolean) => void;
}

/** The page: header, People, the Group card, and Leave group (boards Group_Manage and Group_Waste). */
export function ManageGroupView(props: ManageGroupViewProps) {
  const { detail, meId, settings, joinLink, onBack, onSimplify, onCurrency, onCopyLink, onLeave } = props;
  const rights = props.rights ?? manageRights(detail);
  const kitchen = isKitchenGroup(detail.group);
  const currency = settings?.currency ?? detail.group.currency;
  const people = managePeople(detail, meId);
  const simplify = detail.settings.simplifyDebts;

  return (
    <LookScope theme="cookpool" style={{ position: "relative", minHeight: "100%", fontFamily: FONT, fontVariantNumeric: "tabular-nums" }}>
      <div data-page="manage" style={{ padding: "20px 20px 120px", display: "flex", flexDirection: "column", gap: 14 }}>
        <header style={{ display: "flex", alignItems: "center", gap: 8, minHeight: 56 }}>
          <button type="button" aria-label="Back" onClick={onBack} style={{ width: 44, height: 44, marginLeft: -10, border: 0, background: "transparent", display: "flex", alignItems: "center", justifyContent: "center", flex: "none", cursor: "pointer" }}>
            <BackIcon />
          </button>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h1 style={{ margin: 0, fontSize: 24, fontWeight: 500, letterSpacing: "-0.02em", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{detail.group.name}</h1>
            {kitchen ? <span data-linked="kitchen" style={{ fontSize: 12, color: look.muted }}>Linked to Kitchen</span> : null}
          </div>
        </header>

        <section aria-label="People" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <h2 style={SECTION}>People</h2>
          <div data-people="" style={CARD}>
            {people.map((p, i) => (
              <PersonRow key={p.subjectId} person={p} currency={detail.group.currency} first={i === 0} />
            ))}
            {rights.rules && joinLink ? (
              <button type="button" data-action="add-person" onClick={onCopyLink} style={{ ...ROW, ...divider(1), minHeight: 52, color: look.softInk }}>
                <span aria-hidden style={{ fontSize: 18, lineHeight: 1 }}>+</span>
                <span style={LABEL}>Add person</span>
              </button>
            ) : null}
          </div>
        </section>

        <section aria-label="Group" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <h2 style={SECTION}>Group</h2>
          <div data-group-card="" style={CARD}>
            <div style={{ ...ROW, cursor: "default" }}>
              <span id="simplify-label" style={LABEL}>Simplify debts</span>
              <Switch labelledBy="simplify-label" on={simplify} disabled={!rights.simplify} onChange={onSimplify} />
            </div>
            <div data-row="split" style={{ ...ROW, ...divider(1), cursor: "default" }}>
              <span style={LABEL}>Split by default</span>
              <span style={VALUE}>Equal</span>
            </div>
            {kitchen && settings ? (
              rights.rules ? (
                <button type="button" data-row="waste" onClick={() => props.onWasteOpen?.(true)} style={{ ...ROW, ...divider(1), cursor: "pointer" }}>
                  <span style={LABEL}>Food that goes off</span>
                  <span style={VALUE}>{WASTE_ROW_WORDS[settings.wastePolicy]}</span>
                  <Chevron />
                </button>
              ) : (
                <div data-row="waste" style={{ ...ROW, ...divider(1), cursor: "default" }}>
                  <span style={LABEL}>Food that goes off</span>
                  <span style={VALUE}>{WASTE_ROW_WORDS[settings.wastePolicy]}</span>
                </div>
              )
            ) : null}
            <label data-row="currency" style={{ ...ROW, ...divider(1), position: "relative", cursor: rights.rules ? "pointer" : "default" }}>
              <span style={LABEL}>Currency</span>
              {rights.rules && settings ? (
                <>
                  <select
                    aria-label="Currency"
                    value={currency}
                    onChange={(e) => onCurrency(e.target.value)}
                    style={{ appearance: "none", border: 0, background: "transparent", color: look.muted, font: "inherit", fontSize: 14, textAlign: "right", cursor: "pointer", padding: "0 4px" }}
                  >
                    {withCurrency(currency).map((c) => (
                      <option key={c.code} value={c.code}>
                        {c.code}
                      </option>
                    ))}
                  </select>
                  <Chevron down />
                </>
              ) : (
                <span style={VALUE}>{currency}</span>
              )}
            </label>
            {props.currencyWarning ? (
              <p role="alert" data-currency-warning="" style={{ margin: 0, padding: "10px 16px", fontSize: 13, color: look.owe, borderTop: `1px solid ${look.line}` }}>
                {props.currencyWarning}
              </p>
            ) : null}
            {rights.rules && joinLink ? (
              <div data-row="join-link" style={{ ...ROW, ...divider(1), cursor: "default" }}>
                <span style={LABEL}>Join link</span>
                <button type="button" onClick={onCopyLink} style={{ height: 36, padding: "0 14px", borderRadius: 10, border: 0, background: look.soft, color: look.softInk, font: "inherit", fontSize: 14, fontWeight: 500, cursor: "pointer" }}>
                  Copy
                </button>
              </div>
            ) : null}
          </div>
        </section>

        <div style={CARD}>
          <button type="button" data-action="leave" onClick={onLeave} style={{ ...ROW, minHeight: 52, color: look.owe, cursor: "pointer" }}>
            Leave group
          </button>
        </div>
      </div>

      {props.wasteOpen && settings ? <WasteSheet current={settings.wastePolicy} onClose={() => props.onWasteOpen?.(false)} onSave={props.onWaste} /> : null}
    </LookScope>
  );
}

/** The listed currencies, plus the group's own when it is not one of them. */
function withCurrency(code: string) {
  return GROUP_CURRENCIES.some((c) => c.code === code) ? GROUP_CURRENCIES : [{ code, label: code }, ...GROUP_CURRENCIES];
}

function PersonRow({ person, currency, first }: { person: ManagePerson; currency: string; first: boolean }) {
  const tone = person.balanceMinor > 0 ? look.get : person.balanceMinor < 0 ? look.owe : look.muted;
  return (
    <div data-person={person.subjectId} style={{ ...ROW, ...divider(first ? 0 : 1), minHeight: 56, cursor: "default" }}>
      <span aria-hidden style={{ width: 34, height: 34, borderRadius: "50%", background: look.soft, color: look.softInk, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 500, flex: "none" }}>
        {person.name.slice(0, 1).toUpperCase()}
      </span>
      <span style={LABEL}>
        {person.name} {person.you ? <span style={{ fontSize: 12, color: look.muted, fontWeight: 400 }}>you</span> : null}
      </span>
      <span data-balance="" style={{ fontSize: 15, fontWeight: 500, color: tone }}>
        {person.balanceMinor === 0 ? "Settled" : signedShort(person.balanceMinor, currency)}
      </span>
    </div>
  );
}

function Switch({ on, disabled, onChange, labelledBy }: { on: boolean; disabled: boolean; onChange: (on: boolean) => void; labelledBy: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-labelledby={labelledBy}
      disabled={disabled}
      onClick={() => onChange(!on)}
      style={{ width: 46, height: 28, borderRadius: 14, border: 0, padding: 0, position: "relative", flex: "none", background: on ? look.primary : look.grab, opacity: disabled ? 0.6 : 1, cursor: disabled ? "default" : "pointer" }}
    >
      <span aria-hidden style={{ position: "absolute", top: 3, left: on ? 21 : 3, width: 22, height: 22, borderRadius: "50%", background: look.surface, boxShadow: "0 1px 3px rgba(0,0,0,.25)" }} />
    </button>
  );
}

/** Food that goes off: its own sheet with the two rules and Save (board Group_Waste). */
export function WasteSheet({ current, onClose, onSave }: { current: WastePolicy; onClose: () => void; onSave: (rule: WastePolicy) => void }) {
  const [rule, setRule] = React.useState<WastePolicy>(current);
  return (
    <div data-sheet="waste" style={{ position: "fixed", inset: 0, zIndex: 40 }}>
      <div aria-hidden onClick={onClose} style={{ position: "absolute", inset: 0, background: "rgba(27,36,32,.42)" }} />
      <section role="dialog" aria-modal="true" aria-label="Food that goes off" style={{ position: "absolute", left: 0, right: 0, bottom: 0, background: look.bg, color: look.ink, borderRadius: "12px 12px 0 0", padding: "10px 20px 32px", display: "flex", flexDirection: "column", gap: 16, fontFamily: FONT, maxWidth: 560, margin: "0 auto" }}>
        <span aria-hidden style={{ alignSelf: "center", width: 40, height: 4, borderRadius: 2, background: look.grab }} />
        <div style={{ display: "flex", alignItems: "center", gap: 8, height: 36 }}>
          <button type="button" aria-label="Back" onClick={onClose} style={{ width: 44, height: 44, marginLeft: -10, border: 0, background: "transparent", display: "flex", alignItems: "center", justifyContent: "center", flex: "none", cursor: "pointer" }}>
            <BackIcon />
          </button>
          <h2 style={{ margin: 0, fontSize: 22, fontWeight: 500, letterSpacing: "-0.01em", flex: 1 }}>Food that goes off</h2>
        </div>
        <div role="radiogroup" aria-label="Food that goes off" style={CARD}>
          {WASTE_RULES.map((r, i) => {
            const on = r.id === rule;
            return (
              <button key={r.id} type="button" role="radio" aria-checked={on} onClick={() => setRule(r.id)} style={{ ...ROW, ...divider(i), minHeight: 56, background: on ? look.soft : "transparent", cursor: "pointer" }}>
                <span aria-hidden style={{ width: 22, height: 22, borderRadius: "50%", boxSizing: "border-box", flex: "none", background: look.surface, border: on ? `6px solid ${look.primary}` : `2px solid ${look.grab}` }} />
                <span style={LABEL}>{r.label}</span>
              </button>
            );
          })}
        </div>
        <button type="button" data-action="save-waste" onClick={() => onSave(rule)} style={{ height: 52, borderRadius: 12, border: 0, background: look.primary, color: look.onPrimary, font: "inherit", fontSize: 15, fontWeight: 500, cursor: "pointer" }}>
          Save
        </button>
      </section>
    </div>
  );
}

