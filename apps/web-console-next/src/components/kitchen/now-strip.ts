/**
 * The Pantry's Now strip and Log several (cookpool-pantry PN-5, design §1.3,
 * §3) as pure view-models. The strip is built in the console from the
 * usuals and the items: first the items whose usual is in the strip for
 * this part of the day (`strip: true`, most uses first, at most four), then
 * the use-soon items with something left (soonest first, Home's
 * `soonStrip`), six in all. Each chip is the row's own suggestion — "Milk ·
 * 1 glass · Morning usual". Log several gathers one-tap logs into a tray —
 * "Log 3 for you" — written one after another with one Undo.
 * Dependency-free, so it is unit-testable.
 */

import type { KitchenItem, KitchenUsual } from "@saas/contracts/kitchen";
import { USUAL_BUCKET_LABELS, usualBucketAt, usualBucketOfHour, type UsualBucket } from "@saas/contracts/kitchen-usuals";
import { qk } from "@/lib/query-keys";
import { soonStrip, worthText, type ItemRef } from "./pantry";
import { amountCost } from "./item-use";
import type { LadderStep } from "./pantry-set";
import type { PantryRow } from "./pantry-list";

// ── The usuals read (design §2.1) ─────────────────────────────────

/** How many usuals today's frame reads: quick use's strip, Home's chips and + Add's Do it again (one cache entry). */
export const USUALS_LIMIT = 10;
/** The new frame reads one per row the Pantry can show (the server's most, PN-2). */
export const PANTRY_USUALS_LIMIT = 100;

/** This device's offset, in minutes east of UTC, as the server takes it: `-getTimezoneOffset()`. */
export function tzOffsetOf(at: Date): number {
  return -at.getTimezoneOffset();
}

/**
 * The usuals read for a frame. Today's: `{ limit: 10 }` under
 * `qk.kitchenUsuals()`, exactly as before. The new frame's: every row's
 * usual with this device's offset, keyed by the part of the day, so a read
 * from 10:55 isn't still "morning" at 11:05 — the key moves on and the read
 * runs again (under the same prefix, so a stock write still refreshes it).
 */
export function usualsRead(
  isNewFrame: boolean,
  at: Date,
): { key: readonly unknown[]; query: { limit: number; tzOffset?: number }; bucket: UsualBucket | null } {
  if (!isNewFrame) return { key: qk.kitchenUsuals(), query: { limit: USUALS_LIMIT }, bucket: null };
  const tzOffset = tzOffsetOf(at);
  const bucket = usualBucketAt(at, tzOffset);
  return { key: qk.kitchenUsualsAt(bucket), query: { limit: PANTRY_USUALS_LIMIT, tzOffset }, bucket };
}

/** How long until the next part of the day starts, at `tzOffset` (≥ 1 s): when to look at the bucket again. */
export function msToNextBucket(at: Date, tzOffset: number): number {
  const local = new Date(at.getTime() + tzOffset * 60_000);
  const bucket = usualBucketOfHour(local.getUTCHours());
  const hourStart = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate(), local.getUTCHours());
  let h = 1;
  while (h <= 24 && usualBucketOfHour(local.getUTCHours() + h) === bucket) h++;
  return Math.max(1_000, hourStart + h * 3_600_000 - local.getTime());
}

// ── The strip (design §3) ─────────────────────────────────────────

/** Usuals the strip shows at most, before the use-soon items. */
export const NOW_STRIP_USUALS = 4;
/** Chips in all. */
export const NOW_STRIP_MAX = 6;

/** "NOW · MORNING". */
export function nowHeading(bucket: UsualBucket): string {
  return `NOW · ${USUAL_BUCKET_LABELS[bucket].toUpperCase()}`;
}

export interface NowChip {
  /** The item's `itm_…`. */
  id: string;
  name: string;
  /** "1 glass" */
  words: string;
  /** "Morning usual", "The rest", "Use soon"; the strip's own reason when the suggestion has none. */
  why: string;
  /** "Milk · 1 glass · Morning usual" — the chip's name. */
  label: string;
  /** Where it came from: a usual of this part of the day, or something to use soon. */
  from: "usual" | "soon";
}

type StripRow = Pick<PantryRow, "id" | "name" | "canUse" | "chip" | "ladder" | "variant"> & { item: KitchenItem };

/**
 * The strip: usuals with `strip` for items listed and usable (most uses in
 * the bucket first, then most uses), at most NOW_STRIP_USUALS; then items to
 * use soon with something left, soonest first; NOW_STRIP_MAX in all, each
 * item once. Only rows whose chip logs in one tap. Empty: the strip isn't drawn.
 */
export function nowStrip(rows: readonly StripRow[], usuals: readonly KitchenUsual[] | null | undefined): NowChip[] {
  const loggable = rows.filter((r) => r.canUse && r.variant === "use" && r.chip?.kind === "log" && r.ladder.suggestion);
  const byId = new Map(loggable.map((r) => [r.id, r] as const));
  const strip = (usuals ?? [])
    .filter((u) => u.strip === true && byId.has(u.itemId))
    .sort((a, b) => (b.now?.count ?? 0) - (a.now?.count ?? 0) || b.usedCount - a.usedCount);
  const out: NowChip[] = [];
  const seen = new Set<string>();
  for (const u of strip) {
    if (out.length >= NOW_STRIP_USUALS) break;
    const r = byId.get(u.itemId)!;
    seen.add(r.id);
    out.push(chipOf(r, "usual"));
  }
  const soon = soonStrip(
    loggable.map((r) => r.item).filter((i) => i.qtyLeftMilli > 0),
    [],
    NOW_STRIP_MAX - out.length,
    seen,
  );
  for (const item of soon) out.push(chipOf(byId.get(item.id)!, "soon"));
  return out;
}

function chipOf(r: StripRow, from: NowChip["from"]): NowChip {
  const s = r.ladder.suggestion!;
  const why = s.why ?? (from === "soon" ? "Use soon" : "Your usual");
  return { id: r.id, name: r.name, words: s.step.words, why, label: `${r.name} · ${s.step.words} · ${why}`, from };
}

// ── Log several (design §1.3) ─────────────────────────────────────

/** One thing in the tray: an item and the amount its chip offered. */
export interface TrayEntry {
  itemId: string;
  ref: ItemRef;
  item: KitchenItem;
  name: string;
  step: LadderStep;
  /**
   * Who had it, in the order sent (Say what you used, cookpool-ai AI-7). Left
   * out, a group item is logged for you alone, as Log several does.
   */
  consumers?: readonly string[];
}

/** Tap a chip under Log several: in the tray if out, out if in (one entry per item). Never mutates `tray`. */
export function toggleTray(tray: readonly TrayEntry[], entry: TrayEntry): TrayEntry[] {
  return tray.some((e) => e.itemId === entry.itemId) ? tray.filter((e) => e.itemId !== entry.itemId) : [...tray, entry];
}

export function inTray(tray: readonly TrayEntry[], itemId: string): boolean {
  return tray.some((e) => e.itemId === itemId);
}

/** An amount of something, briefly: "2 eggs" when the words name it already, "eggs × 2" for pieces, else "1 glass milk". */
export function trayWords(entry: Pick<TrayEntry, "name" | "step">): string {
  const words = entry.step.words;
  const name = entry.name.trim().toLowerCase();
  const pieces = /^(\d+½?|½) pcs?$/.exec(words);
  if (pieces) return `${name} × ${pieces[1]}`;
  const head = name.split(/\s+/)[0] ?? "";
  const last = words.toLowerCase().split(/\s+/).pop() ?? "";
  if (head.length >= 3 && last.slice(0, 3) === head.slice(0, 3)) return words;
  return `${words} ${name}`;
}

/** The tray's line: "1 glass milk · 2 eggs · 100 g atta". */
export function trayLine(tray: readonly TrayEntry[]): string {
  return tray.map(trayWords).join(" · ");
}

/** The tray's button: "Log 3 for you" (everything in it is logged for you alone). */
export function trayButton(tray: readonly TrayEntry[]): string {
  return `Log ${tray.length} for you`;
}

/** What it all costs now, per currency: "₹42.50", "₹12.00 and $3.00". */
export function trayCost(tray: readonly TrayEntry[]): string {
  return worthText(tray.map((e) => ({ currency: e.item.currency, worthMinor: amountCost(e.item, e.step.qtyMilli) })));
}

/** The toast once the tray is written: "Logged 3 for you · ₹42.50"; "Logged 2 of 3 for you" when some were refused. */
export function trayToast(tray: readonly TrayEntry[], refused: readonly TrayEntry[] = []): { title: string; description?: string } {
  const done = tray.filter((e) => !refused.some((r) => r.itemId === e.itemId));
  if (refused.length === 0) return { title: `Logged ${tray.length} for you · ${trayCost(tray)}` };
  return {
    title: `Logged ${done.length} of ${tray.length} for you`,
    description: `Couldn't log ${refused.map((r) => r.name).join(", ")}. ${done.length > 0 ? trayCost(done) : ""}`.trim(),
  };
}
