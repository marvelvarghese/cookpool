/**
 * Ask before use in the app (cookpool-pantry PN-9, design §8.1–§8.2, the
 * canvas's AskSetting and AskRequest), as pure view-models over PN-8's API:
 *
 *  - **Who can use it** (§8.1): who may set it (the item's answerer — its
 *    buyer, or an owner or admin once the buyer has left), the two choices,
 *    the "Never need to ask" chips, the three lines that explain it, and the
 *    PATCH (or Add item's create fields) a choice sends.
 *  - **Asking** (§8.2): "Ask Meera" for whoever must ask (`item.mustAsk`),
 *    the row's end (Ask Meera, or Cancel while it waits), the ask's state as
 *    the row says it ("Asked Meera · 1 pinch · waiting · lapses in 24 h",
 *    "Meera said yes · logged", "Meera said no", "Lapsed"), the request, and
 *    what a write shows at once (the caller's asks and the items' setting).
 *
 * The Home card is `ask-card.ts`; the cook session's line is in
 * `cook-session.ts`; history's words are `askMoveText` in `item-use.ts`.
 * Dependency-free (contracts, the engine and the pure kitchen modules), so
 * it is unit-testable.
 */

import { ASK_LAPSE_HOURS } from "@saas/contracts/kitchen";
import type {
  AskSource,
  AskToUseRequest,
  AsksResponse,
  KitchenAsk,
  KitchenItem,
  KitchenMeasure,
  UpdateGroupItemRequest,
} from "@saas/contracts/kitchen";
import { qk } from "@/lib/query-keys";
import type { CacheKey, CachePatch } from "@/lib/optimistic";
import { pendingId } from "@/lib/optimistic";
import { canManageGroup, type GroupRole } from "./groups";
import { memberName, sortMembers, type MemberNames } from "./members";
import { amountCost, consumersText, logRequest } from "./item-use";
import type { LadderStep } from "./pantry-set";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

// ── Names ─────────────────────────────────────────────────────────

/** A person's first name ("Meera" of "Meera Iyer"); null when the app has none. */
export function firstName(subjectId: string, names?: MemberNames | null): string | null {
  const name = memberName(subjectId, names);
  return name ? (name.split(/\s+/)[0] ?? name) : null;
}

/** First word of a name the server gave ("Meera Iyer" → "Meera"); null for none. */
export function firstOf(name: string | null | undefined): string | null {
  const n = name?.trim();
  return n ? (n.split(/\s+/)[0] ?? n) : null;
}

/** Who to ask, in words: the answerer's first name, "an admin" once the buyer has left, else "the buyer". */
export function answererWords(answerer: string | null | undefined, names?: MemberNames | null, fallbackName?: string | null): string {
  if (answerer === null) return "an admin";
  if (answerer === undefined) return "the buyer";
  return firstName(answerer, names) ?? firstOf(fallbackName) ?? "the buyer";
}

/**
 * PN-5's row seam: "Meera" when the caller must ask before using this item
 * (`item.mustAsk`), "an admin" when its buyer has left; null for everyone
 * who may just use it — the row is then as it always was.
 */
export function askName(item: Pick<KitchenItem, "mustAsk" | "answerer">, ctx: { names?: MemberNames | null }): string | null {
  if (!item.mustAsk) return null;
  return answererWords(item.answerer ?? null, ctx.names);
}

/** An item in a sentence: "saffron" — unless it starts with a capitalised pair ("MDH masala"), as the pushes say it (PN-8). */
export function itemWords(name: string): string {
  const n = name.trim();
  if (/^\p{Lu}\p{Lu}/u.test(n)) return n;
  return n ? n[0]!.toLowerCase() + n.slice(1) : n;
}

// ── Who can use it (design §8.1, the canvas's AskSetting) ─────────

export type AskMode = "anyone" | "ask";

/** What the setting is left at on screen: Anyone, or Ask me first with who never needs to. */
export interface AskDraft {
  mode: AskMode;
  allowed: string[];
}

/**
 * Who answers an item's asks and sets who may use it: what the server says
 * (`answerer`) on an ask-first item; otherwise its buyer, unless the group's
 * members are known and the buyer isn't one (then an owner or admin: null).
 */
export function answererOf(item: Pick<KitchenItem, "pantry" | "paidBy" | "askFirst" | "answerer">, roster: readonly string[] | null): string | null {
  if (item.askFirst && item.answerer !== undefined) return item.answerer;
  if (roster && !roster.includes(item.paidBy)) return null;
  return item.paidBy;
}

/** Who can use it shows to the item's answerer only: its buyer, or an owner or admin once the buyer has left; never on your own pantry's item. */
export function canSetAsk(
  item: Pick<KitchenItem, "pantry" | "paidBy" | "askFirst" | "answerer" | "state">,
  ctx: { meId: string | null; role: GroupRole | null; roster: readonly string[] | null },
): boolean {
  if (item.pantry.kind !== "group" || !ctx.meId || item.state !== "active") return false;
  const answerer = answererOf(item, ctx.roster);
  return answerer === null ? canManageGroup(ctx.role) : answerer === ctx.meId;
}

/** The item's setting as it stands. */
export function askDraftOf(item: Pick<KitchenItem, "askFirst" | "allowed">): AskDraft {
  return { mode: item.askFirst ? "ask" : "anyone", allowed: [...new Set(item.allowed ?? [])] };
}

/** A new item's: anyone, nobody named. */
export const NEW_ASK_DRAFT: AskDraft = Object.freeze({ mode: "anyone", allowed: [] }) as AskDraft;

export interface AskModeView {
  id: AskMode;
  /** "Anyone in Flat 4B", "Ask me first". */
  title: string;
  /** "Use it like everything else", "You approve each use". */
  sub: string;
  on: boolean;
}

/** The two choices, as radios. */
export function askModes(groupName: string, mode: AskMode): AskModeView[] {
  return [
    { id: "anyone", title: `Anyone in ${groupName}`, sub: "Use it like everything else", on: mode === "anyone" },
    { id: "ask", title: "Ask me first", sub: "You approve each use", on: mode === "ask" },
  ];
}

export function setAskMode(draft: AskDraft, mode: AskMode): AskDraft {
  return mode === draft.mode ? draft : { ...draft, mode };
}

/** Let someone skip asking (+ Anu). */
export function allowPerson(draft: AskDraft, subjectId: string): AskDraft {
  return draft.allowed.includes(subjectId) ? draft : { ...draft, allowed: [...draft.allowed, subjectId] };
}

/** Take them off again (×). */
export function disallowPerson(draft: AskDraft, subjectId: string): AskDraft {
  return draft.allowed.includes(subjectId) ? { ...draft, allowed: draft.allowed.filter((id) => id !== subjectId) } : draft;
}

export interface AllowChip {
  id: string;
  /** "Anu" */
  name: string;
  /** × "Remove Anu", or + "Let Anu use it without asking". */
  label: string;
}

/**
 * "Never need to ask": who is on the list (each with ×), then everyone else
 * in the group as "+ Name" (first names) — never the answerer, nor you, who
 * never ask. Someone who left the group drops off the list. In faces order.
 * `roster` is the members who can use the group's items (no viewers).
 */
export function allowedChips(
  draft: AskDraft,
  ctx: { roster: readonly string[] | null; answerer: string | null; meId: string | null; names?: MemberNames | null },
): { allowed: AllowChip[]; others: AllowChip[] } {
  const skip = new Set([ctx.answerer, ctx.meId].filter((x): x is string => !!x));
  const inGroup = (id: string) => ctx.roster === null || ctx.roster.includes(id);
  const nameOf = (id: string) => firstName(id, ctx.names) ?? "Someone";
  const allowed = sortMembers(draft.allowed.filter((id) => inGroup(id) && !skip.has(id)), null, ctx.names).map((id) => ({
    id,
    name: nameOf(id),
    label: `Remove ${nameOf(id)}`,
  }));
  const others = sortMembers((ctx.roster ?? []).filter((id) => !skip.has(id) && !draft.allowed.includes(id)), null, ctx.names).map((id) => ({
    id,
    name: nameOf(id),
    label: `Let ${nameOf(id)} use it without asking`,
  }));
  return { allowed, others };
}

/** The three lines under the chips (the canvas's): what the others see, that nothing moves, the push and the 24 h. */
export function askExplainer(myFirstName: string | null): string[] {
  return [
    myFirstName ? `Others see Ask ${myFirstName} instead of Use.` : "Others ask you instead of using it.",
    "Nothing comes off and no money moves until you approve.",
    "You get a push. An ask lapses after 24 h.",
  ];
}

function sameSet(a: readonly string[], b: readonly string[]): boolean {
  const sa = new Set(a);
  const sb = new Set(b);
  return sa.size === sb.size && [...sa].every((x) => sb.has(x));
}

/** Who stays on the list when it's sent: members of the group only (the server refuses anyone else), each once. */
function sentAllowed(draft: AskDraft, roster: readonly string[] | null, skip: readonly (string | null)[]): string[] {
  return [...new Set(draft.allowed)].filter((id) => (roster === null || roster.includes(id)) && !skip.includes(id));
}

/** Save's PATCH: always says which, and the list with Ask me first. */
export type AskSettingBody = Required<Pick<UpdateGroupItemRequest, "askFirst">> & Pick<UpdateGroupItemRequest, "allowed">;

/**
 * Save's PATCH (`updateGroupItem`): `{ askFirst: true, allowed }` for Ask me
 * first, `{ askFirst: false }` for Anyone (the server keeps the list for
 * next time); null when nothing changed, so Save has nothing to send.
 */
export function askSettingBody(
  draft: AskDraft,
  item: Pick<KitchenItem, "askFirst" | "allowed" | "paidBy" | "answerer" | "pantry">,
  ctx: { roster: readonly string[] | null; meId: string | null },
): AskSettingBody | null {
  if (draft.mode === "anyone") return item.askFirst ? { askFirst: false } : null;
  const allowed = sentAllowed(draft, ctx.roster, [answererOf(item, ctx.roster), ctx.meId]);
  if (item.askFirst && sameSet(allowed, item.allowed ?? [])) return null;
  return { askFirst: true, allowed };
}

/** Add item's part of the create (§8.1): only for a group item you pay for, and only Ask me first. */
export function addItemAskFields(
  draft: AskDraft,
  ctx: { group: boolean; paidBy: string | null; meId: string | null; roster: readonly string[] | null },
): { askFirst?: true; allowed?: string[] } {
  if (!showsAddItemAsk(ctx) || draft.mode !== "ask") return {};
  return { askFirst: true, allowed: sentAllowed(draft, ctx.roster, [ctx.meId]) };
}

/** Add item asks Who can use it for a group item the caller pays for. */
export function showsAddItemAsk(ctx: { group: boolean; paidBy: string | null; meId: string | null }): boolean {
  return ctx.group && ctx.meId !== null && ctx.paidBy === ctx.meId;
}

/** Save's toast. */
export function askSavedText(draft: Pick<AskDraft, "mode">): string {
  return draft.mode === "ask" ? "Saved · others ask you first" : "Saved · anyone can use it";
}

/** Why Save was refused, in one line. */
export function askSettingRefusal(error: { code: string; message: string; reason?: string | undefined }): string {
  if (error.reason === "not_buyer") return "Only whoever bought it can change who uses it.";
  if (error.reason === "not_in_group") return "Someone on the list left the group. Check the list and save again.";
  if (error.code === "not_found") return "You can't change this item any more.";
  return error.message;
}

// ── An ask as the row says it (design §8.2) ───────────────────────

export type AskPhase = "waiting" | "approved" | "declined" | "lapsed";

/** How long an answered ask still shows on its row. */
export const ASK_ANSWER_SHOWN_MS = 2 * HOUR;

/** "24 h", "40 min": how long until it lapses. */
export function lapsesIn(expiresAt: string, now: Date): string {
  const ms = Date.parse(expiresAt) - now.getTime();
  if (!(ms > 0)) return "0 min";
  // Never more than an ask's 24 h (a clock read a minute ago would round up past it).
  if (ms >= HOUR) return `${Math.min(ASK_LAPSE_HOURS, Math.ceil(ms / HOUR - 1e-9))} h`;
  return `${Math.max(1, Math.ceil(ms / MINUTE))} min`;
}

/** Who answers an ask, in words: "Meera", "an admin". */
export function askAnswererWords(ask: Pick<KitchenAsk, "answerer" | "answererName">, names?: MemberNames | null): string {
  return answererWords(ask.answerer, names, ask.answererName);
}

/** Who answered it: the answerer's name when it was them, else whoever did ("Kiran"). */
function answeredByWords(ask: Pick<KitchenAsk, "answerer" | "answererName" | "answeredBy">, names?: MemberNames | null): string {
  if (ask.answeredBy && ask.answeredBy !== ask.answerer) return firstName(ask.answeredBy, names) ?? "An admin";
  return capitalFirst(askAnswererWords(ask, names));
}

function capitalFirst(s: string): string {
  return s ? s[0]!.toUpperCase() + s.slice(1) : s;
}

export interface AskStatus {
  ask: KitchenAsk;
  phase: AskPhase;
  /** "Asked Meera · 1 pinch", "Meera said yes · logged", "Meera said no", "Lapsed". */
  title: string;
  /** "Waiting · lapses in 24 h" while it waits; else null. */
  sub: string | null;
  /** The two in one line: "Asked Meera · 1 pinch · waiting · lapses in 24 h". */
  text: string;
  /** Cancel shows while it waits (and isn't still on its way). */
  cancel: boolean;
}

/** One ask's state, as its row says it. */
export function askStatusOf(ask: KitchenAsk, ctx: { now: Date; names?: MemberNames | null }): AskStatus | null {
  const who = askAnswererWords(ask, ctx.names);
  const asked = `Asked ${who} · ${ask.amount}`;
  switch (ask.state) {
    case "pending": {
      const sub = `Waiting · lapses in ${lapsesIn(ask.expiresAt, ctx.now)}`;
      return { ask, phase: "waiting", title: asked, sub, text: `${asked} · ${sub[0]!.toLowerCase()}${sub.slice(1)}`, cancel: !ask.id.startsWith("pending_") };
    }
    case "approved": {
      const title = `${answeredByWords(ask, ctx.names)} said yes · logged`;
      return { ask, phase: "approved", title, sub: null, text: title, cancel: false };
    }
    case "declined": {
      const title = `${answeredByWords(ask, ctx.names)} said no`;
      return { ask, phase: "declined", title, sub: null, text: title, cancel: false };
    }
    case "lapsed":
      return { ask, phase: "lapsed", title: "Lapsed", sub: null, text: "Lapsed", cancel: false };
    default:
      return null;
  }
}

/** Is an answered ask still shown on its row? For ASK_ANSWER_SHOWN_MS after its answer (a lapse: after its time, or while `mine` holds it). */
function stillShown(ask: KitchenAsk, now: Date): boolean {
  if (ask.state === "pending") return true;
  if (ask.state === "canceled") return false;
  const at = ask.answeredAt ?? (Date.parse(ask.expiresAt) < now.getTime() ? ask.expiresAt : null);
  if (at === null) return true;
  return now.getTime() - Date.parse(at) < ASK_ANSWER_SHOWN_MS;
}

/**
 * The caller's latest ask for an item (from `asks().mine`, newest first), as
 * its row shows it: waiting while it waits, then the answer briefly. A
 * cancelled ask shows nothing; null with none.
 */
export function askStatus(itemId: string, mine: readonly KitchenAsk[] | null | undefined, ctx: { now: Date; names?: MemberNames | null }): AskStatus | null {
  const asks = (mine ?? []).filter((a) => a.item.id === itemId && a.state !== "canceled" && a.source !== "cook");
  if (asks.length === 0) return null;
  // A waiting ask comes first; else the newest answer.
  const sorted = [...asks].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const ask = sorted.find((a) => a.state === "pending") ?? sorted[0]!;
  return stillShown(ask, ctx.now) ? askStatusOf(ask, ctx) : null;
}

// ── The row's end (design §8.2, the canvas's AskRequest) ─────────

export type AskRowEnd =
  | {
      kind: "ask";
      /** "Ask Meera" — the chip says it. */
      words: string;
      /** "Ask Meera for 1 pinch of Saffron for you and Anu" — the chip's name. */
      label: string;
      step: LadderStep;
      /** Who it is for: the people from last time, else you. */
      consumers: string[];
    }
  | { kind: "cancel"; label: string; ask: KitchenAsk };

/**
 * What the end of a row that must ask holds: Cancel while its ask waits;
 * else "Ask Meera", which asks for the suggestion for the people from last
 * time (as the log chip logs it). Null for a row that just uses (PN-5's chip).
 */
export function askRowEnd(
  row: { variant: "use" | "ask"; canUse: boolean; name: string; ladder: { suggestion: { step: LadderStep; consumerIds?: readonly string[] | null } | null; steps: readonly LadderStep[] } },
  status: AskStatus | null,
  ctx: { askName: string | null; meId: string | null; names?: MemberNames | null },
): AskRowEnd | null {
  if (status?.phase === "waiting") return status.cancel ? { kind: "cancel", label: `Cancel the ask for ${row.name}`, ask: status.ask } : null;
  if (row.variant !== "ask" || !row.canUse || !ctx.askName) return null;
  const s = row.ladder.suggestion;
  const step = s?.step ?? row.ladder.steps[0];
  if (!step) return null;
  const consumers = s?.consumerIds && s.consumerIds.length > 0 ? [...new Set(s.consumerIds)] : ctx.meId ? [ctx.meId] : [];
  const who = consumersText(consumers, ctx.meId, ctx.names);
  return { kind: "ask", words: `Ask ${ctx.askName}`, label: `Ask ${ctx.askName} for ${step.words} of ${row.name}${who ? ` for ${who}` : ""}`, step, consumers };
}

/** The set row's and the sheet's main button: "Ask Meera". */
export function askButtonText(askNameText: string): string {
  return `Ask ${askNameText}`;
}

// ── The request (PN-8's POST …/items/{itm}/asks) ──────────────────

/**
 * An ask's body: the amount as a use sends it — `{ quantity: "250", unit:
 * "ml" }`, or a measure's count and word — and who will have it, with
 * `source: "cook"` from a cook session (the Pantry's is the default).
 */
export function askRequest(
  item: Pick<KitchenItem, "dimension" | "pantry">,
  qtyMilli: number,
  consumers: readonly string[],
  counted: { measure: Pick<KitchenMeasure, "one">; quantity: number } | null = null,
  source: AskSource = "pantry",
): AskToUseRequest {
  const body = logRequest(item, qtyMilli, consumers, counted) as AskToUseRequest;
  return source === "pantry" ? body : { ...body, source };
}

/** Asked: the toast's words. */
export function askedText(input: { who: string; what: string }): { title: string; description: string } {
  return { title: `Asked ${input.who} · ${input.what}`, description: "Nothing comes off until they say yes." };
}

/** Why an ask was refused, in one line (`no_need` never shows: the use is logged instead). */
export function askRefusal(error: { reason?: string | undefined; message: string; details?: Record<string, unknown> | undefined }, ctx: { what: (milli: number) => string; qtyLeftMilli: number }): string {
  if (error.reason === "insufficient_stock") {
    const left = typeof error.details?.["qtyLeftMilli"] === "number" ? (error.details["qtyLeftMilli"] as number) : ctx.qtyLeftMilli;
    return left > 0 ? `Only ${ctx.what(left)} left now.` : "None left now.";
  }
  if (error.reason === "not_in_group") return "Someone you picked left the group. Check who it's for.";
  return error.message;
}

// ── What a write shows at once (SM-5) ─────────────────────────────

/** The ask being sent, in the caller's `mine` at once (its id says it is on its way: no Cancel yet). */
export function pendingAsk(input: {
  item: Pick<KitchenItem, "id" | "name" | "pantry" | "displayUnit" | "qtyLeftMilli" | "qtyLeft" | "state" | "paidBy" | "currency" | "answerer" | "priceMinor" | "worthMinor" | "qtyBoughtMilli" | "dimension">;
  qtyMilli: number;
  quantity: number;
  unit: string;
  label: string | null;
  amount: string;
  consumers: readonly string[];
  meId: string;
  answererName: string | null;
  source: AskSource;
  at: Date;
}): KitchenAsk {
  const { item } = input;
  const orgId = item.pantry.kind === "group" ? item.pantry.orgId : "";
  const costMinor = amountCost(item, input.qtyMilli);
  const backMinor = input.consumers.includes(item.paidBy) && input.consumers.length > 0 ? Math.round((costMinor * (input.consumers.length - 1)) / input.consumers.length) : costMinor;
  return {
    id: pendingId("ask"),
    orgId,
    item: { id: item.id, ref: `org:${orgId}:${item.id}`, name: item.name, pantry: item.pantry, displayUnit: item.displayUnit, qtyLeftMilli: item.qtyLeftMilli, qtyLeft: item.qtyLeft, state: item.state },
    asker: input.meId,
    askerName: null,
    qtyMilli: input.qtyMilli,
    quantity: input.quantity,
    unit: input.unit,
    label: input.label,
    amount: input.amount,
    consumers: [...input.consumers],
    consumerNames: input.consumers.map(() => null),
    weights: null,
    source: input.source,
    state: "pending",
    createdAt: input.at.toISOString(),
    expiresAt: new Date(input.at.getTime() + 24 * HOUR).toISOString(),
    answeredAt: null,
    answeredBy: null,
    answerer: item.answerer ?? null,
    answererName: input.answererName,
    paidBy: item.paidBy,
    costMinor,
    backMinor,
    currency: item.currency,
    enough: true,
    moveId: null,
    txnId: null,
  };
}

/** The caller's asks with one more (newest first), or one put in another's place (the server's for the one on its way). */
export function withMineAsk(res: AsksResponse, ask: KitchenAsk, replacing?: string): AsksResponse {
  const rest = res.mine.filter((a) => a.id !== ask.id && a.id !== replacing);
  return { ...res, mine: [ask, ...rest] };
}

/** The caller's asks with one changed (a cancel, at once). */
export function withAskChanged(res: AsksResponse, askId: string, patch: Partial<KitchenAsk>): AsksResponse {
  if (!res.mine.some((a) => a.id === askId) && !res.toAnswer.some((a) => a.id === askId)) return res;
  const change = (a: KitchenAsk) => (a.id === askId ? { ...a, ...patch } : a);
  return { ...res, mine: res.mine.map(change), toAnswer: res.toAnswer.map(change) };
}

/** A patch of the asks read (`qk.kitchenAsks()`). */
export function asksPatch(update: (res: AsksResponse) => AsksResponse): CachePatch {
  return {
    prefix: qk.kitchenAsks(),
    update: (data: unknown) => {
      if (!data || typeof data !== "object" || !Array.isArray((data as AsksResponse).mine)) return data;
      return update(data as AsksResponse);
    },
  };
}

/** What an item's setting write changes on it. */
export type AskItemFields = Partial<Pick<KitchenItem, "askFirst" | "allowed" | "mustAsk" | "answerer" | "version" | "updatedAt">>;

function withFields<T extends Pick<KitchenItem, "id">>(item: T, itemId: string, fields: AskItemFields): T {
  return item.id === itemId ? { ...item, ...fields } : item;
}

function listWith<T extends Pick<KitchenItem, "id">>(list: readonly T[], itemId: string, fields: AskItemFields): readonly T[] {
  return list.some((i) => i.id === itemId) ? list.map((i) => withFields(i, itemId, fields)) : list;
}

/**
 * Every cached read that shows the item — its page, every pantry list,
 * Home's use-soon strip, search, and the usable and cookable lists — with
 * its setting changed in place: Save's at once, or `mustAsk` when a use was
 * refused with `ask_first` (the row then reads Ask Meera).
 */
export function askItemPatches(itemId: string, fields: AskItemFields): CachePatch[] {
  return [
    {
      prefix: qk.kitchenPantry(),
      update: (data: unknown, key: CacheKey) => {
        if (data === null || typeof data !== "object") return data;
        switch (key[1]) {
          case "item":
            return withFields(data as KitchenItem, itemId, fields);
          case "items": {
            const d = data as { items: KitchenItem[] };
            if (!Array.isArray(d.items)) return data;
            const items = listWith(d.items, itemId, fields);
            return items === d.items ? d : { ...d, items };
          }
          case "useSoon": {
            const d = data as { soon: KitchenItem[]; expired: KitchenItem[] };
            if (!Array.isArray(d.soon) || !Array.isArray(d.expired)) return data;
            const soon = listWith(d.soon, itemId, fields);
            const expired = listWith(d.expired, itemId, fields);
            return soon === d.soon && expired === d.expired ? d : { soon, expired };
          }
          case "search":
          case "usable":
          case "cookable":
            return Array.isArray(data) ? listWith(data as KitchenItem[], itemId, fields) : data;
          default:
            return data;
        }
      },
    },
  ];
}

/**
 * A use refused because the caller must ask (403 `ask_first`, with
 * `details.answerer`): the fields that turn its row into the ask row.
 */
export function askFirstRefusalFields(error: { reason?: string | undefined; details?: Record<string, unknown> | undefined }): AskItemFields | null {
  if (error.reason !== "ask_first") return null;
  const answerer = error.details?.["answerer"];
  return { askFirst: true, mustAsk: true, answerer: typeof answerer === "string" ? answerer : null };
}
