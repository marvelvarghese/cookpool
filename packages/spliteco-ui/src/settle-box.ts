// Money-native MY-6: the settle box, as pure logic. A payment to one person
// across several groups is several records (one per group touched); this file
// works out what each group takes (Kitchen clears first, then the rest), how
// the keypad's text becomes an amount, and records the lot while remembering
// which groups landed, so a retry sends only the rest. Nothing here fetches:
// the host injects `recordPayment`.

import type { SplitecoPersonBalance, SplitecoPersonPlanLine, SplitecoSettlementRequest } from "@saas/contracts/spliteco";
import { formatShort } from "./money.js";
import { kitchenGroupsFirst, groupLabel } from "./people.js";
import { kitchenFirst } from "./settle.js";

/** Which way the money goes in the box: you pay them, or they paid you (Got it). */
export type SettleDirection = "pay" | "got";
export type SettleMode = "all" | "kitchen" | "custom";
export type SettleMethod = "upi" | "cash";

/** One payment to record: `fromSubjectId` pays `toSubjectId` in one group. */
export interface PaymentRequest {
  groupId: string;
  fromSubjectId: string;
  toSubjectId: string;
  amountMinor: number;
  method: SettleMethod;
  /** For a group made in Cookpool: how much pays each balance, Kitchen first. */
  split?: { kitchen: number; other: number } | null;
  note?: string | null;
}

/**
 * What the host injects. A payment you made is Spliteco's own settlement call
 * (`spliteco.settle(groupId, body)`). Got it is the same record the other way
 * (`fromSubjectId` is them): the host decides how to write it.
 */
export interface SettleApi {
  recordPayment(request: PaymentRequest): Promise<unknown>;
}

/** The body of Spliteco's settlement call for a request that is the caller paying. */
export function settlementBody(r: PaymentRequest): SplitecoSettlementRequest {
  return { toSubjectId: r.toSubjectId, amountMinor: r.amountMinor, method: r.method, note: r.note ?? null, ...(r.split ? { split: r.split } : {}) };
}

/** What you owe (or are owed) in one group, in one currency. */
export interface SettleGroup {
  groupId: string;
  label: string;
  currency: string;
  kitchen: boolean;
  /** Positive: the amount that can be settled here in this direction. */
  owedMinor: number;
  /** Kitchen and Other, for a group made in Cookpool. */
  buckets: { kitchen: number; other: number } | null;
}

const amountIn = (direction: SettleDirection, minor: number) => (direction === "pay" ? -minor : minor);

/** Groups with something to settle in this direction and currency, the Kitchen first. */
export function settleGroups(person: Pick<SplitecoPersonBalance, "groups">, direction: SettleDirection, currency: string): SettleGroup[] {
  return kitchenGroupsFirst(person.groups)
    .filter((g) => g.currency === currency && amountIn(direction, g.amountMinor) > 0)
    .map((g) => ({
      groupId: g.groupId,
      label: groupLabel(g),
      currency: g.currency,
      kitchen: g.kind === "kitchen",
      owedMinor: amountIn(direction, g.amountMinor),
      buckets: g.buckets
        ? { kitchen: Math.max(0, amountIn(direction, g.buckets.kitchen)), other: Math.max(0, amountIn(direction, g.buckets.other)) }
        : null,
    }));
}

/** The currencies a person has something to settle in, for this direction, the largest first. */
export function settleCurrencies(person: Pick<SplitecoPersonBalance, "groups">, direction: SettleDirection): string[] {
  const totals = new Map<string, number>();
  for (const g of person.groups) {
    const v = amountIn(direction, g.amountMinor);
    if (v > 0) totals.set(g.currency, (totals.get(g.currency) ?? 0) + v);
  }
  return [...totals].sort((a, b) => b[1] - a[1]).map(([c]) => c);
}

export const sumOwed = (groups: readonly SettleGroup[]) => groups.reduce((s, g) => s + g.owedMinor, 0);

/** What "Kitchen only" settles: the Kitchen balance of every group made in Cookpool, else the Kitchen group's whole balance. */
export function kitchenOwed(group: SettleGroup): number {
  if (!group.kitchen) return 0;
  return group.buckets ? Math.min(group.owedMinor, group.buckets.kitchen) : group.owedMinor;
}

export interface SettleLine {
  groupId: string;
  label: string;
  currency: string;
  kitchen: boolean;
  owedMinor: number;
  paidMinor: number;
  split: { kitchen: number; other: number } | null;
}

/**
 * How an amount is spread over the groups: the Kitchen clears first, then the
 * others in order, each up to what is owed there. A group made in Cookpool is
 * paid Kitchen first inside it too. Groups that take nothing are left out.
 */
export function allocate(groups: readonly SettleGroup[], mode: SettleMode, customMinor = 0): SettleLine[] {
  const total = sumOwed(groups);
  let left = mode === "all" ? total : mode === "kitchen" ? groups.reduce((s, g) => s + kitchenOwed(g), 0) : Math.max(0, Math.min(customMinor, total));
  const lines: SettleLine[] = [];
  for (const g of groups) {
    if (left <= 0) break;
    const cap = mode === "kitchen" ? kitchenOwed(g) : g.owedMinor;
    const paid = Math.min(left, cap);
    if (paid <= 0) continue;
    left -= paid;
    const split = g.buckets ? (mode === "kitchen" ? { kitchen: paid, other: 0 } : kitchenFirst(paid, g.buckets)) : null;
    lines.push({ groupId: g.groupId, label: g.label, currency: g.currency, kitchen: g.kitchen, owedMinor: g.owedMinor, paidMinor: paid, split });
  }
  return lines;
}

export const linesTotal = (lines: readonly SettleLine[]) => lines.reduce((s, l) => s + l.paidMinor, 0);

/** The words of the Settle_Custom rows: "₹300 cleared" when a group is paid in full, "₹400 of ₹1,200" when in part. */
export function lineText(line: Pick<SettleLine, "paidMinor" | "owedMinor" | "currency">): string {
  return line.paidMinor >= line.owedMinor
    ? `${formatShort(line.paidMinor, line.currency)} cleared`
    : `${formatShort(line.paidMinor, line.currency)} of ${formatShort(line.owedMinor, line.currency)}`;
}

/** The payment records a set of lines makes: one per group touched. */
export function requestsOf(
  lines: readonly SettleLine[],
  who: { fromSubjectId: string; toSubjectId: string },
  method: SettleMethod,
): PaymentRequest[] {
  return lines.map((l) => ({
    groupId: l.groupId,
    fromSubjectId: who.fromSubjectId,
    toSubjectId: who.toSubjectId,
    amountMinor: l.paidMinor,
    method,
    ...(l.split ? { split: l.split } : {}),
  }));
}

// ── The keypad ────────────────────────────────────────────

export type KeypadKey = "0" | "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "." | "back";

/** Text typed on the keypad → minor units; "" is 0. At most two decimals. */
export function keypadMinor(text: string): number {
  if (text === "" || text === ".") return 0;
  const [whole = "0", frac = ""] = text.split(".");
  return Number(whole || "0") * 100 + Number((frac + "00").slice(0, 2));
}

/**
 * One key press. A digit that would take the amount past `maxMinor` (what is
 * owed) is ignored, so the box can never hold an amount that cannot be paid.
 */
export function keypadPress(text: string, key: KeypadKey, maxMinor: number): string {
  if (key === "back") return text.slice(0, -1);
  if (key === ".") return text.includes(".") ? text : text === "" ? "0." : `${text}.`;
  const [, frac] = text.split(".");
  if (frac !== undefined && frac.length >= 2) return text;
  const next = text === "0" ? key : text + key;
  return keypadMinor(next) > maxMinor ? text : next;
}

/** The amount as the keypad shows it: "700", "12.5", with grouping left to the formatter. */
export function keypadDisplay(text: string, currency: string): string {
  if (text === "") return formatShort(0, currency);
  const [whole = "0", frac] = text.split(".");
  const shown = formatShort(Number(whole) * 100, currency);
  return frac === undefined ? shown : `${shown}.${frac}`;
}

// ── Recording across groups ───────────────────────────────

/** A request's identity across rows: the same group can appear under two people. */
export const requestKey = (r: Pick<PaymentRequest, "groupId" | "fromSubjectId" | "toSubjectId">) => `${r.groupId}:${r.fromSubjectId}:${r.toSubjectId}`;

export interface RecordOutcome {
  /** Request keys recorded now, plus those recorded before. */
  recorded: string[];
  failed: { key: string; groupId: string; message: string }[];
}

/**
 * Records each request in turn, skipping requests already `recorded` (by `requestKey`). A failure
 * does not stop the rest: the box then knows which landed and which did not,
 * and a second call with the same `recorded` sends only what is left.
 */
export async function recordPayments(
  api: SettleApi,
  requests: readonly PaymentRequest[],
  recorded: ReadonlySet<string> = new Set(),
): Promise<RecordOutcome> {
  const done = new Set(recorded);
  const failed: RecordOutcome["failed"] = [];
  for (const r of requests) {
    const key = requestKey(r);
    if (done.has(key)) continue;
    try {
      await api.recordPayment(r);
      done.add(key);
    } catch (e) {
      failed.push({ key, groupId: r.groupId, message: e instanceof Error ? e.message : "Couldn't record this" });
    }
  }
  return { recorded: [...done], failed };
}

// ── Got it, straight from a People row ────────────────────

/** Everything they owe you, one record per group, in a currency (all of it): what Got it on a People row records. */
export function gotItRequests(person: Pick<SplitecoPersonBalance, "subjectId" | "groups">, meId: string, currency: string, method: SettleMethod = "upi"): PaymentRequest[] {
  return requestsOf(allocate(settleGroups(person, "got", currency), "all"), { fromSubjectId: person.subjectId, toSubjectId: meId }, method);
}

// ── Settle up (People's button) ───────────────────────────

export interface PlanRow {
  key: string;
  /** The other person. */
  subjectId: string;
  name: string;
  initial: string;
  currency: string;
  /** You pay them (Paid) or they pay you (Got it). */
  direction: SettleDirection;
  amountMinor: number;
  /** One record per group touched. */
  requests: PaymentRequest[];
}

/**
 * The simplified payments of every group's plan, one row per person and
 * direction: what each plan line between you and them adds up to.
 */
export function planRows(people: readonly SplitecoPersonBalance[], meId: string, method: SettleMethod = "upi"): PlanRow[] {
  const rows: PlanRow[] = [];
  for (const p of people) {
    const name = p.name?.trim() || "Someone";
    const byKey = new Map<string, { direction: SettleDirection; currency: string; lines: SplitecoPersonPlanLine[] }>();
    for (const l of p.plans) {
      if (l.amountMinor <= 0) continue;
      const direction: SettleDirection = l.fromSubjectId === meId ? "pay" : "got";
      const k = `${direction}:${l.currency}`;
      const entry = byKey.get(k) ?? { direction, currency: l.currency, lines: [] };
      entry.lines.push(l);
      byKey.set(k, entry);
    }
    for (const [k, e] of byKey) {
      rows.push({
        key: `${p.subjectId}:${k}`,
        subjectId: p.subjectId,
        name,
        initial: name.slice(0, 1).toUpperCase(),
        currency: e.currency,
        direction: e.direction,
        amountMinor: e.lines.reduce((s, l) => s + l.amountMinor, 0),
        requests: e.lines.map((l) => ({ groupId: l.groupId, fromSubjectId: l.fromSubjectId, toSubjectId: l.toSubjectId, amountMinor: l.amountMinor, method })),
      });
    }
  }
  return rows;
}

