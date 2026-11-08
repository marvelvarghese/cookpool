/**
 * The buyer's answer (cookpool-pantry PN-9, design §8.3, the canvas's
 * AskApprove), as pure view-models: Home's ask card at the top of To do —
 * "Dev asks for 1 pinch of saffron", "For Dev and Anu · asked 2 min ago ·
 * 1.4 g left", "If you approve · ₹12 back to you", Always let Dev use
 * saffron, Decline and Approve (or, when less is left, "Only 0.4 g left" and
 * Approve what's left) — the bodies its answers send, what the card says once
 * answered ("Approved · Dev and Anu owe you ₹12", "Declined · Dev was told"),
 * which Undo each takes, and `/home?ask=<askId>` (the push's address): the
 * card to scroll to and light up.
 *
 * Dependency-free (contracts, the engine and the pure kitchen modules), so
 * it is unit-testable.
 */

import type { ApproveAskRequest, ApproveAskResponse, AskInboxItem, KitchenAsk } from "@saas/contracts/kitchen";
import { dimensionOf, formatQuantity, isUnit } from "@saas/kitchen-engine/units";
import { agoText } from "./when";
import { shortMoney } from "./from-before";
import { memberLabelInline, type MemberNames } from "./members";
import { joinNames } from "./pantry";
import { firstName, firstOf, itemWords } from "./ask-before-use";

// ── Names on the card ─────────────────────────────────────────────

/** The asker's first name ("Dev"), from the names the app knows, else the server's. */
export function askerWords(ask: Pick<KitchenAsk, "asker" | "askerName">, names?: MemberNames | null): string {
  return firstName(ask.asker, names) ?? firstOf(ask.askerName) ?? "Someone";
}

/** Who it is for, inline: "Dev and Anu", "Dev and you". */
export function forWords(ask: Pick<KitchenAsk, "consumers" | "consumerNames">, ctx: { meId: string | null; names?: MemberNames | null }): string {
  const people = ask.consumers.map((id, i) => {
    if (ctx.meId && id === ctx.meId) return "you";
    return firstName(id, ctx.names) ?? firstOf(ask.consumerNames[i]) ?? memberLabelInline(id, ctx.meId, ctx.names);
  });
  return joinNames(people);
}

/** What is left, in the item's own unit: "1.4 g". */
export function askLeftText(item: Pick<KitchenAsk["item"], "qtyLeftMilli" | "qtyLeft" | "displayUnit">): string {
  if (isUnit(item.displayUnit)) return formatQuantity(item.qtyLeftMilli, dimensionOf(item.displayUnit), item.displayUnit);
  return `${item.qtyLeft} ${item.displayUnit}`;
}

// ── The card ──────────────────────────────────────────────────────

export interface AskCardView {
  id: string;
  orgId: string;
  /** The asker (the card's face). */
  askerId: string;
  /** "Dev asks for 1 pinch of saffron". */
  title: string;
  /** "For Dev and Anu · asked 2 min ago · 1.4 g left". */
  sub: string;
  /** "If you approve" · "₹12 back to you" (or "No money moves" when none comes back). */
  money: { label: string; value: string };
  /** "Always let Dev use saffron" (a switch). */
  always: string;
  /** Is what was asked all there? */
  enough: boolean;
  /** "Only 0.4 g left" when it isn't. */
  short: string | null;
  /** "Approve", or "Approve what's left". */
  approve: string;
}

/** One ask the caller answers, as its card says it. */
export function askCard(ask: KitchenAsk, ctx: { meId: string | null; names?: MemberNames | null; now: Date }): AskCardView {
  const asker = askerWords(ask, ctx.names);
  const what = itemWords(ask.item.name);
  const asked = agoText(ask.createdAt, ctx.now);
  const left = askLeftText(ask.item);
  const back = ask.backMinor > 0 ? `${shortMoney(ask.backMinor, ask.currency)} back to you` : "No money moves";
  return {
    id: ask.id,
    orgId: ask.orgId,
    askerId: ask.asker,
    title: `${asker} asks for ${ask.amount} of ${what}`,
    sub: [`For ${forWords(ask, ctx)}`, asked ? `asked ${asked[0]!.toLowerCase()}${asked.slice(1)}` : null, `${left} left`].filter(Boolean).join(" · "),
    money: { label: "If you approve", value: back },
    always: `Always let ${asker} use ${what}`,
    enough: ask.enough,
    short: ask.enough ? null : ask.item.qtyLeftMilli > 0 ? `Only ${left} left` : "None left",
    approve: ask.enough ? "Approve" : "Approve what's left",
  };
}

/** Approve's body: Always let, and — when less is left than was asked — what's left. */
export function approveRequest(ask: Pick<KitchenAsk, "enough">, choice: { always: boolean }): ApproveAskRequest {
  return { ...(choice.always ? { alwaysAllow: true } : {}), ...(ask.enough ? {} : { takeWhatsLeft: true }) };
}

/**
 * The ask as Approve takes it, for the card's words at once: as asked, or —
 * less left than asked — what is left, in the item's own unit (as the server
 * approves it with `takeWhatsLeft`), for the same money: the ask's cost is
 * already the rest of the price.
 */
export function approvingAsk(ask: KitchenAsk): KitchenAsk {
  if (ask.enough) return ask;
  // The money stays: a use of more than is left already costs exactly the rest of the price (`costOfUse`).
  return { ...ask, qtyMilli: ask.item.qtyLeftMilli, quantity: ask.item.qtyLeft, unit: ask.item.displayUnit, label: null, amount: askLeftText(ask.item) };
}

/** Approve can be pressed: something is left to approve. */
export function canApprove(ask: Pick<KitchenAsk, "enough" | "item">): boolean {
  return ask.enough || ask.item.qtyLeftMilli > 0;
}

// ── Answered ──────────────────────────────────────────────────────

export interface AnsweredText {
  /** "Approved · Dev and Anu owe you ₹12", "Declined · Dev was told". */
  title: string;
  /** "1 pinch of saffron logged for them", "Dev won't need to ask for saffron again", "Nothing was logged". */
  sub: string;
}

/**
 * The card once approved: who owes the buyer and how much (`backMinor`, the
 * server's once it answers) — "Approved · Dev and Anu owe you ₹12", "Dev owes
 * you ₹6" — and what was logged, or that the asker won't need to ask again.
 */
export function approvedText(ask: KitchenAsk, ctx: { meId: string | null; names?: MemberNames | null; always: boolean }): AnsweredText {
  const asker = askerWords(ask, ctx.names);
  const what = itemWords(ask.item.name);
  const owing = ask.consumers.filter((id) => id !== ask.paidBy);
  const people = owing.map((id) => {
    const i = ask.consumers.indexOf(id);
    return firstName(id, ctx.names) ?? firstOf(ask.consumerNames[i]) ?? memberLabelInline(id, ctx.meId, ctx.names);
  });
  const toYou = ask.paidBy === ctx.meId;
  const title =
    ask.backMinor > 0 && people.length > 0
      ? `Approved · ${joinNames(people)} ${people.length === 1 ? "owes" : "owe"} ${toYou ? "you" : "the buyer"} ${shortMoney(ask.backMinor, ask.currency)}`
      : `Approved · ${ask.amount} logged`;
  const sub = ctx.always ? `${asker} won't need to ask for ${what} again` : `${ask.amount} of ${what} logged for ${forWords(ask, ctx)}`;
  return { title, sub };
}

/** The card once declined. */
export function declinedText(ask: KitchenAsk, ctx: { names?: MemberNames | null }): AnsweredText {
  return { title: `Declined · ${askerWords(ask, ctx.names)} was told`, sub: "Nothing was logged" };
}

/** The Undo an answer takes: reverse the approved use's transaction, undo its move when it posted none, or reopen a declined ask. */
export type AskUndo =
  | { kind: "txn"; orgId: string; txnId: string }
  | { kind: "move"; orgId: string; moveId: string }
  | { kind: "reopen"; orgId: string; askId: string };

export function approvalUndo(orgId: string, answer: Pick<ApproveAskResponse, "move" | "txn">): AskUndo {
  if (answer.txn) return { kind: "txn", orgId, txnId: answer.txn.id };
  return { kind: "move", orgId, moveId: answer.move.id };
}

export function declineUndo(ask: Pick<KitchenAsk, "id" | "orgId">): AskUndo {
  return { kind: "reopen", orgId: ask.orgId, askId: ask.id };
}

/** Why an answer was refused, in one line — and, for too little left, what is left now (the card then offers what's left). */
export function answerRefusal(
  error: { reason?: string | undefined; message: string; details?: Record<string, unknown> | undefined },
  ask: KitchenAsk,
): { text: string; qtyLeftMilli: number | null } {
  switch (error.reason) {
    case "insufficient_stock": {
      const left = typeof error.details?.["qtyLeftMilli"] === "number" ? (error.details["qtyLeftMilli"] as number) : null;
      return { text: left !== null && left > 0 ? "Less is left than was asked." : "None left now.", qtyLeftMilli: left };
    }
    case "lapsed":
      return { text: `This ask lapsed. ${askerWords(ask)} can ask again.`, qtyLeftMilli: null };
    case "not_pending":
      return { text: "Already answered.", qtyLeftMilli: null };
    case "not_buyer":
      return { text: "Only whoever bought it answers.", qtyLeftMilli: null };
    case "not_in_group":
      return { text: "Someone it's for left the group.", qtyLeftMilli: null };
    default:
      return { text: error.message, qtyLeftMilli: null };
  }
}

/** The ask with what is left now (a refusal said so): `enough` follows, so the card offers Approve what's left. */
export function withLeft(ask: KitchenAsk, qtyLeftMilli: number): KitchenAsk {
  const ratio = ask.item.qtyLeftMilli > 0 ? ask.item.qtyLeft / ask.item.qtyLeftMilli : 0;
  return { ...ask, enough: qtyLeftMilli >= ask.qtyMilli, item: { ...ask.item, qtyLeftMilli, qtyLeft: ratio > 0 ? qtyLeftMilli * ratio : qtyLeftMilli / 1000 } };
}

// ── The list, and the push's address ──────────────────────────────

/** An answer given on this page: shown in the card's place (with Undo) after the inbox has moved on. */
export interface AnsweredAsk {
  ask: KitchenAsk;
  answer: "approved" | "declined";
  always: boolean;
  /** Its Undo, once the server has answered. */
  undo: AskUndo | null;
}

/**
 * The cards, oldest ask first (as the server lists them): the asks waiting
 * for you, and those you answered here (in their own place, until Undo puts
 * them back) — each once.
 */
export function askCardsShown(
  waiting: readonly AskInboxItem[] | null | undefined,
  answered: ReadonlyMap<string, AnsweredAsk>,
): { ask: KitchenAsk; answered: AnsweredAsk | null }[] {
  const out = new Map<string, { ask: KitchenAsk; answered: AnsweredAsk | null }>();
  for (const row of waiting ?? []) out.set(row.ask.id, { ask: row.ask, answered: answered.get(row.ask.id) ?? null });
  for (const [id, a] of answered) if (!out.has(id)) out.set(id, { ask: a.ask, answered: a });
  return [...out.values()].sort((a, b) => a.ask.createdAt.localeCompare(b.ask.createdAt) || a.ask.id.localeCompare(b.ask.id));
}

/** `?ask=ask_…` (the push's address): the ask to show; null for anything else. */
export function parseAskParam(raw: string | null | undefined): string | null {
  const v = raw?.trim() ?? "";
  return /^ask_[A-Za-z0-9]{1,64}$/.test(v) ? v : null;
}

/**
 * Where `?ask=` lands once To do has read: on its card (to scroll to and
 * light up), or — answered elsewhere, or lapsed — gone; null while the asks
 * are still being read or there is no `?ask=`.
 */
export function askArrival(target: string | null, shownIds: readonly string[] | null): "card" | "gone" | null {
  if (!target || shownIds === null) return null;
  return shownIds.includes(target) ? "card" : "gone";
}
