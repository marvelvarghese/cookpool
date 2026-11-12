"use client";

// How the shared money screens are drawn (cookpool-spliteco SE3): the parts in
// ./components.tsx carry no colours, sizes or fonts of their own. Every class
// they put on an element comes from the theme an app provides — Cookpool's
// revamp tokens (Tailwind) in the console, Deep ocean's classes in the Spliteco
// app — and so does the money formatter, so each app prints amounts its way.

import * as React from "react";

export type MoneyFormat = (minor: number, currency: string, opts?: { sign?: boolean }) => string;

/** The class names each part of the shared screens takes. Empty means none. */
export interface SplitecoUiSlots {
  // The balance card
  card: string;
  cardHead: string;
  cardTitle: string;
  cardBadge: string;
  balanceRows: string;
  balanceRow: string;
  balanceText: string;
  /** The amount, coloured by the tone slots below. */
  amount: string;
  owe: string;
  owed: string;
  settled: string;
  cardAction: string;
  // The "why" list
  why: string;
  whyTitle: string;
  whySection: string;
  whySectionTitle: string;
  whyRows: string;
  whyRow: string;
  whyMain: string;
  whyRowTitle: string;
  whyRowDetail: string;
  whyMore: string;
  empty: string;
  // Forms
  form: string;
  field: string;
  label: string;
  input: string;
  select: string;
  chips: string;
  chip: string;
  hint: string;
  error: string;
  // Buttons
  button: string;
  buttonQuiet: string;
  // Settle up
  payHeader: string;
  payWho: string;
  payAmount: string;
  methods: string;
  method: string;
  methodOn: string;
  badge: string;
  methodMain: string;
  methodTitle: string;
  methodNote: string;
  radio: string;
  radioOn: string;
  confirm: string;
  confirmTitle: string;
  confirmNote: string;
  confirmActions: string;
  confirmButton: string;
  confirmQuiet: string;
  link: string;
  done: string;
  doneTitle: string;
  doneNote: string;
  footer: string;
  // Kitchen · Other
  buckets: string;
  bucketGet: string;
  bucketOwe: string;
  bucketEven: string;
}

export interface SplitecoUiTheme {
  slots: SplitecoUiSlots;
  money: MoneyFormat;
}

/** Every slot empty: a part drawn without a theme is plain, unstyled HTML. */
export const BARE_SLOTS: SplitecoUiSlots = Object.freeze(
  Object.fromEntries(
    [
      "card", "cardHead", "cardTitle", "cardBadge", "balanceRows", "balanceRow", "balanceText", "amount", "owe", "owed", "settled", "cardAction",
      "why", "whyTitle", "whySection", "whySectionTitle", "whyRows", "whyRow", "whyMain", "whyRowTitle", "whyRowDetail", "whyMore", "empty",
      "form", "field", "label", "input", "select", "chips", "chip", "hint", "error", "button", "buttonQuiet",
      "payHeader", "payWho", "payAmount", "methods", "method", "methodOn", "badge", "methodMain", "methodTitle", "methodNote", "radio", "radioOn",
      "confirm", "confirmTitle", "confirmNote", "confirmActions", "confirmButton", "confirmQuiet", "link", "done", "doneTitle", "doneNote", "footer",
      "buckets", "bucketGet", "bucketOwe", "bucketEven",
    ].map((k) => [k, ""]),
  ) as unknown as SplitecoUiSlots,
);

/** Plain amounts ("₹860.00"), for a part drawn without a theme. */
export const plainMoney: MoneyFormat = (minor, currency, opts) => {
  const abs = Math.abs(Math.trunc(minor));
  const body = `${currency === "INR" ? "₹" : `${currency} `}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
  return minor < 0 ? `−${body}` : opts?.sign && minor > 0 ? `+${body}` : body;
};

const Ctx = React.createContext<SplitecoUiTheme>({ slots: BARE_SLOTS, money: plainMoney });

export function SplitecoUiProvider({ theme, children }: { theme: SplitecoUiTheme; children: React.ReactNode }) {
  return <Ctx.Provider value={theme}>{children}</Ctx.Provider>;
}

export function useSplitecoUi(): SplitecoUiTheme {
  return React.useContext(Ctx);
}

/** Join class names, leaving out the empty ones. */
export function cx(...names: Array<string | false | null | undefined>): string | undefined {
  const joined = names.filter(Boolean).join(" ");
  return joined || undefined;
}

/** A theme with some slots changed (an app's variant of another's). */
export function withSlots(theme: SplitecoUiTheme, slots: Partial<SplitecoUiSlots>): SplitecoUiTheme {
  return { ...theme, slots: { ...theme.slots, ...slots } };
}
