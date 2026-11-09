/**
 * Say what you used (cookpool-ai AI-7, design §2, the canvas's AiSayIt), the
 * pure half: where it shows, the sentence with the parts it understood
 * marked (green for a line, amber for a word that matched nothing), each
 * proposed line as a row with PN-11's amount control, what it all costs,
 * the entries Log writes one after another (PN-5's Log several) and the
 * refusals in one line. Nothing here reads or writes; `say-it-data.ts` does.
 */

import type { AiStatus, AiUseProposal, AiUsesResponse, KitchenItem } from "@saas/contracts/kitchen";
import { AI_USES_TEXT_MAX } from "@saas/contracts/kitchen";
import { buildUse } from "@saas/kitchen-engine/ledger";
import { UNITS, isUnit } from "@saas/kitchen-engine/units";
import { formatMinor } from "@saas/kitchen-engine/money";
import { amountView, draftPick, pickAmount, pickRest, pickStart, type AmountPick, type PickHow } from "./amount-picker";
import { amountCost } from "./item-use";
import { eachText } from "./faces";
import { pantryLabel, worthText } from "./pantry";
import { memberName, type MemberNames } from "./members";
import type { TrayEntry } from "./now-strip";

// ── Where it shows ────────────────────────────────────────────────

/**
 * The Pantry's box and Home's ✨ show only in the new frame, once `GET /me/ai`
 * says AI is available and the server reads sentences, while this device's
 * "Say what you used" switch is on. Hidden while the status loads or fails.
 */
export function sayItShows(o: { isNewFrame: boolean; status: AiStatus | null | undefined; switchOn: boolean }): boolean {
  return o.isNewFrame && o.switchOn && o.status?.available === true && o.status.features?.sayIt === true;
}

/** The chips under an empty box: tap one to start from it. */
export const SAY_IT_EXAMPLES: readonly string[] = ["2 eggs for breakfast", "Anu and I had chai", "The rest of the paneer"];

export const SAY_IT_PLACEHOLDER = "Say it like you'd tell a flatmate…";

/** Under Log: what the read sends (design §2's first-name exception). */
export const SAY_IT_SENT = "Sent: item names and amounts, first names. Never money or groups.";

/** The sentence as sent: trimmed, at most AI_USES_TEXT_MAX characters; null when there is nothing to read. */
export function sentenceToSend(text: string): string | null {
  const t = text.trim().slice(0, AI_USES_TEXT_MAX).trim();
  return t === "" ? null : t;
}

// ── The sentence, marked ──────────────────────────────────────────

export type SaidTone = "plain" | "matched" | "unsure";

export interface SaidSpan {
  text: string;
  tone: SaidTone;
}

export interface SaidMarks {
  /** The whole sentence, in order: plain text between the marked parts. */
  spans: SaidSpan[];
  /** What each line was heard as ("2 glasses of milk"), by the line's index; null when it can't be found in the words. */
  heard: (string | null)[];
}

interface Word {
  text: string;
  lower: string;
  start: number;
  end: number;
}

const WORD_RE = /[\p{L}\p{N}½¼¾]+(?:['’.\/][\p{L}\p{N}]+)*/gu;

function wordsOf(text: string): Word[] {
  return [...text.matchAll(WORD_RE)].map((m) => ({ text: m[0], lower: m[0].toLowerCase(), start: m.index ?? 0, end: (m.index ?? 0) + m[0].length }));
}

/** A word and its plain singulars ("glasses" → glass, "berries" → berry, "anu's" → anu). */
function forms(w: string): string[] {
  const b = w.replace(/['’]s$/, "");
  const out = [b];
  if (b.endsWith("ies") && b.length > 4) out.push(`${b.slice(0, -3)}y`);
  if (b.endsWith("es") && b.length > 3) out.push(b.slice(0, -2));
  if (b.endsWith("s") && b.length > 2) out.push(b.slice(0, -1));
  return out;
}

function sameWord(a: string, b: string): boolean {
  const fb = forms(b);
  return forms(a).some((f) => fb.includes(f));
}

const NAME_SKIP = new Set(["of", "the", "a", "an", "and", "&", "with", "in"]);

/** Words that say how much, before the thing: "2 glasses of", "half the", "the rest of", "a little". */
const AMOUNT_WORDS = new Set([
  "of", "the", "a", "an", "my", "our", "some", "half", "quarter", "rest", "all", "little", "bit", "few", "couple", "whole",
  "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "dozen",
  "cup", "glass", "bowl", "spoon", "spoonful", "tbsp", "tsp", "g", "gm", "kg", "ml", "l", "litre", "liter", "gram", "kilo",
  "packet", "pack", "piece", "pc", "pcs", "slice", "handful", "pinch", "loaf", "plate", "katori", "mug", "tin", "can",
]);

const NUMBER_RE = /^(\d+([.,/]\d+)?[\p{L}]*|[½¼¾]|\d+[½¼¾])$/u;

function amountish(w: string, extra: readonly string[]): boolean {
  if (NUMBER_RE.test(w)) return true;
  return forms(w).some((f) => AMOUNT_WORDS.has(f) || extra.includes(f));
}

/** "Anu and I": the people words a line's consumers are named by. */
const ME_WORDS = new Set(["i", "me", "we", "us", "myself"]);

/**
 * The sentence with what was understood marked: each line's item named in
 * the words, with the amount said before it ("2 glasses of milk", "half the
 * bread"), the people named for a shared line ("Anu and I") in green, and
 * each unsure word in amber. Lines are found in the order given, each in
 * words no earlier line took.
 */
export function markSentence(text: string, res: Pick<AiUsesResponse, "lines" | "unsure">, ctx: { meId: string | null; names?: MemberNames | null }): SaidMarks {
  const words = wordsOf(text);
  const group: (string | null)[] = words.map(() => null);
  const tone: SaidTone[] = words.map(() => "plain");
  const heard: (string | null)[] = [];

  res.lines.forEach((line, li) => {
    const nameWords = line.name.toLowerCase().split(/\s+/).filter((w) => w.length >= 2 && !NAME_SKIP.has(w));
    const extra = [line.label, line.measure ?? "", line.unit ?? ""].join(" ").toLowerCase().split(/\s+/).flatMap(forms);
    const isName = (w: string) => nameWords.some((n) => sameWord(w, n));
    const at = words.findIndex((w, i) => group[i] === null && isName(w.lower));
    if (at < 0) {
      heard.push(null);
      return;
    }
    let from = at;
    let to = at;
    while (to + 1 < words.length && group[to + 1] === null && isName(words[to + 1]!.lower)) to++;
    while (from - 1 >= 0 && group[from - 1] === null && (isName(words[from - 1]!.lower) || amountish(words[from - 1]!.lower, extra))) from--;
    // A lone leading "of" / "the" / "a" says no amount: leave it out.
    while (from < at && ["of", "the", "a", "an"].includes(words[from]!.lower) && !amountish(words[from + 1]?.lower ?? "", []) ) from++;
    for (let i = from; i <= to; i++) {
      group[i] = `l${li}`;
      tone[i] = "matched";
    }
    heard.push(text.slice(words[from]!.start, words[to]!.end));
  });

  // The people named on a shared line: their first names, and "I" / "me" for you.
  const shared = res.lines.filter((l) => l.pantry.kind === "group" && l.consumers.length > 1);
  const people = new Set<string>();
  for (const l of shared) {
    for (const id of l.consumers) {
      if (id === ctx.meId) continue;
      const first = memberName(id, ctx.names)?.trim().split(/\s+/)[0]?.toLowerCase();
      if (first) people.add(first);
    }
  }
  if (people.size > 0) {
    words.forEach((w, i) => {
      if (group[i] !== null) return;
      if (people.has(w.lower.replace(/['’]s$/, "")) || ME_WORDS.has(w.lower)) {
        group[i] = "p";
        tone[i] = "matched";
      }
    });
    // "Anu and I", "Anu, Dev and me": one mark across the "and" between them.
    for (let i = 1; i + 1 < words.length; i++) {
      if (group[i] === null && (words[i]!.lower === "and" || words[i]!.lower === "&") && group[i - 1] === "p" && group[i + 1] === "p") {
        group[i] = "p";
        tone[i] = "matched";
      }
    }
  }

  res.unsure.forEach((said, ui) => {
    const want = said.toLowerCase().split(/\s+/).filter(Boolean);
    if (want.length === 0) return;
    for (let i = 0; i + want.length <= words.length; i++) {
      const fits = want.every((w, k) => group[i + k] === null && sameWord(words[i + k]!.lower, w));
      if (!fits) continue;
      for (let k = 0; k < want.length; k++) {
        group[i + k] = `u${ui}`;
        tone[i + k] = "unsure";
      }
      return;
    }
  });

  const spans: SaidSpan[] = [];
  const push = (t: string, tn: SaidTone) => {
    if (t === "") return;
    const last = spans[spans.length - 1];
    if (last && last.tone === tn && tn === "plain") last.text += t;
    else spans.push({ text: t, tone: tn });
  };
  let cursor = 0;
  let i = 0;
  while (i < words.length) {
    const g = group[i];
    if (g === null) {
      i++;
      continue;
    }
    let j = i;
    // Runs of one mark, across what is between them (", ", " "), stay one mark.
    while (j + 1 < words.length && group[j + 1] === g && /^[\s,]*$/.test(text.slice(words[j]!.end, words[j + 1]!.start))) j++;
    push(text.slice(cursor, words[i]!.start), "plain");
    push(text.slice(words[i]!.start, words[j]!.end), tone[i]!);
    cursor = words[j]!.end;
    i = j + 1;
  }
  push(text.slice(cursor), "plain");
  return { spans, heard };
}

// ── The rows ──────────────────────────────────────────────────────

type Line = Pick<AiUseProposal, "quantity" | "unit" | "measure" | "flags">;
type RowItem = Pick<KitchenItem, "dimension" | "qtyLeftMilli" | "qtyBoughtMilli" | "displayUnit" | "name" | "measures">;

const BASE_UNIT = { volume: "ml", mass: "g", count: "pcs", pack: "pack" } as const;

/** A pick as kept, made to fit the item now; a count under the unit's least step is kept as typed. */
function fit(item: RowItem, unit: string, count: number): AmountPick | null {
  const how: PickHow = "suggested";
  return draftPick(item, { unit, count, rest: false, how }) ?? draftPick(item, { unit, count, rest: false, how: "typed" });
}

/**
 * Where a line's amount control starts: the measure it was said in ("2
 * glasses" → 2 of the item's glass), else its unit when the item offers that
 * chip, else the same amount in the item's base unit; "the rest" (or as much
 * as is left) as The rest. Null when nothing is left.
 */
export function proposalPick(item: RowItem, line: Line): AmountPick | null {
  if (item.qtyLeftMilli <= 0) return null;
  let pick: AmountPick | null = null;
  if (line.measure) pick = fit(item, `m:${line.measure.toLowerCase()}`, line.quantity);
  else if (line.unit && isUnit(line.unit)) {
    pick = fit(item, `u:${line.unit}`, line.quantity);
    if (!pick) {
      const milli = line.quantity * UNITS[line.unit].factor * 1000;
      const base = BASE_UNIT[item.dimension];
      pick = fit(item, `u:${base}`, Math.round(milli / (UNITS[base].factor * 1000)));
    }
  }
  pick ??= pickStart(item, null);
  if (!pick) return null;
  return line.flags.includes("the_rest") ? { ...pickRest(pick), how: "suggested" } : pick;
}

export interface SaidRowView {
  name: string;
  /** In the control: "2 glasses", "½ loaf", "500 ml"; The rest says what is left. */
  amount: string;
  canLess: boolean;
  canMore: boolean;
  /** "Flat 4B · ₹17 · ₹8.50 each"; "Mine · ₹12" for your own pantry. */
  sub: string;
  costMinor: number;
  currency: string;
  /** Who had it, you first (a personal item: just you). */
  consumers: readonly string[];
  /** "Left someone out · not in this group" when the server took a name off. */
  note: string | null;
}

/** One line's row: the item's name, the amount picked, its pantry, what it costs and what each pays. */
export function saidRowView(
  line: AiUseProposal,
  item: RowItem & Pick<KitchenItem, "priceMinor" | "worthMinor" | "currency" | "paidBy">,
  pick: AmountPick,
): SaidRowView {
  const view = amountView(item, pick, null, null);
  const costMinor = amountCost(item, view.qtyMilli);
  const group = line.pantry.kind === "group";
  const consumers = group ? line.consumers : [];
  const each = group && consumers.length > 1 ? eachText(buildUse({ costMinor, buyerId: item.paidBy, consumers }).map((s) => s.owedMinor), item.currency) : null;
  const sub = [pantryLabel(line.pantry), formatMinor(costMinor, item.currency), each].filter(Boolean).join(" · ");
  return {
    name: item.name || line.name,
    amount: view.words,
    canLess: view.canLess,
    canMore: view.canMore,
    sub,
    costMinor,
    currency: item.currency,
    consumers: group ? consumers : [],
    note: line.flags.includes("people_removed") ? "Left someone out · not in this group" : null,
  };
}

/** Log's label: "Log 2 · ₹42.50" (across currencies, "Log 2 · ₹42.50 and $3.00"). */
export function logSaidLabel(rows: readonly Pick<SaidRowView, "costMinor" | "currency">[]): string {
  return `Log ${rows.length} · ${worthText(rows.map((r) => ({ currency: r.currency, worthMinor: r.costMinor })))}`;
}

/** A row ready to log: its line, the item read now, and the amount picked. */
export interface SaidLogRow {
  line: AiUseProposal;
  item: KitchenItem;
  pick: AmountPick;
}

/** The entries Log writes, one after another, each with who had it (a personal item's: nobody is sent). */
export function saidEntries(rows: readonly SaidLogRow[]): TrayEntry[] {
  return rows.map(({ line, item, pick }) => {
    const amount = pickAmount(item, pick);
    const view = amountView(item, pick, null, null);
    return {
      itemId: item.id,
      ref: line.itemRef,
      item,
      name: item.name || line.name,
      step: { key: pick.rest ? "rest" : `${pick.unit}:${pick.count}`, amount, qtyMilli: amount.qtyMilli, words: amount.kind === "measure" ? amount.label : view.words, rest: pick.rest },
      consumers: line.pantry.kind === "group" ? [...line.consumers] : [],
    };
  });
}

function costOf(entries: readonly TrayEntry[]): string {
  return worthText(entries.map((e) => ({ currency: e.item.currency, worthMinor: amountCost(e.item, e.step.qtyMilli) })));
}

/** The toast once logged: "Logged 2 · ₹42.50"; "Logged 1 of 2" and who was refused when some were. */
export function saidToast(entries: readonly TrayEntry[], refused: readonly TrayEntry[] = []): { title: string; description?: string } {
  const done = entries.filter((e) => !refused.some((r) => r.itemId === e.itemId));
  if (refused.length === 0) return { title: `Logged ${entries.length} · ${costOf(entries)}` };
  return {
    title: `Logged ${done.length} of ${entries.length}`,
    description: `Couldn't log ${refused.map((r) => r.name).join(", ")}. ${done.length > 0 ? costOf(done) : ""}`.trim(),
  };
}

/** Where an unsure name's Add it goes: the add form, its name filled in. */
export function addItHref(said: string): string {
  return `/pantry/new?name=${encodeURIComponent(said.trim())}`;
}

/** The longest name `?name=` fills in. */
export const ADD_NAME_MAX = 60;

/** The add form's name from `?name=` (Add it), in the new frame only: trimmed, first letter capitalised; null for none. */
export function addFormName(param: string | null | undefined, isNewFrame: boolean): string | null {
  if (!isNewFrame || !param) return null;
  const t = param.replace(/\s+/g, " ").trim().slice(0, ADD_NAME_MAX).trim();
  return t === "" ? null : `${t.charAt(0).toUpperCase()}${t.slice(1)}`;
}

// ── Refusals ──────────────────────────────────────────────────────

export type SayItErrorKind = "unavailable" | "budget" | "limit" | "failed";

export interface SayItError {
  kind: SayItErrorKind;
  title: string;
}

/**
 * A refusal of the read, by its `details.reason`: no key hides the box; the
 * month's budget rests AI until the 1st (AI-13); today's limit says
 * tomorrow; anything else — the model failed, the network, nothing read —
 * offers Try again or logging by hand.
 */
export function sayItError(error: { code?: string; reason?: string | undefined; details?: Record<string, unknown> | undefined } | null, status = 0): SayItError {
  const reason = error?.reason ?? (typeof error?.details?.["reason"] === "string" ? (error.details["reason"] as string) : undefined);
  if (reason === "budget") return { kind: "budget", title: "Cookpool AI is resting until the 1st" };
  if (reason === "ai_unavailable" || (status === 503 && reason === undefined)) return { kind: "unavailable", title: "AI isn't set up yet · log by hand" };
  if (reason === "ai_daily_limit" || error?.code === "rate_limited") return { kind: "limit", title: "You've used today's AI · try tomorrow" };
  return { kind: "failed", title: "Couldn't read that · try again or log by hand" };
}
