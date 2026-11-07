/**
 * The dish page's view-model (Cookpool CP-17): a dish's cost card, who had
 * how much, the leftovers, how the dish moves money and what nets inside each
 * group, and the words for claims, finalizing and their refusals.
 *
 * Money is the API's: a dish read carries its `amounts` (what each person owes
 * for it, a preview until finalized) and its `netting`. When the screen shows
 * shares the server has not seen yet — a claim being stepped, the cook setting
 * everyone's portions — the preview is the engine's (`buildDish`,
 * `splitByWeights`, `buildIngredientTake`, `pairLines`), called the way
 * kitchen-worker calls it (the cook's share first, then as listed), so the
 * numbers on screen are the numbers the write posts. Nothing here splits an
 * amount by hand. Pure and dependency-free, so it is unit-testable.
 */

import { isPendingId } from "@/lib/optimistic";
import type {
  DishAmount,
  DishNet,
  DishShareRequest,
  KitchenDish,
  KitchenDishIngredient,
  KitchenDishShare,
} from "@saas/contracts/kitchen";
import { buildDish, buildIngredientTake, pairLines, type DishShare, type Split, type Txn } from "@saas/kitchen-engine/ledger";
import { formatMinor, splitByWeights } from "@saas/kitchen-engine/money";
import { dimensionOf, formatQuantity, isUnit } from "@saas/kitchen-engine/units";
import { memberLabel, memberLabelInline, type MemberNames } from "./members";
import { capitalize, countWords, joinNames } from "./pantry";
import { dayAndTimeText, dayText } from "./when";

// ── The address ───────────────────────────────────────────────────

const DISH_ID_RE = /^dsh_[A-Za-z0-9]{1,64}$/;

/** The dish a `/dishes/[dishRef]` segment names (the plain `dsh_…` id, as emails link it), or null. */
export function parseDishRef(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let value: string;
  try {
    value = decodeURIComponent(raw).trim();
  } catch {
    return null;
  }
  return DISH_ID_RE.test(value) ? value : null;
}

/** The dish page: `/dishes/dsh_…` (the dish maker goes here after cooking). */
export function dishHref(dishId: string): string {
  return `/dishes/${encodeURIComponent(dishId)}`;
}

// ── Portions ──────────────────────────────────────────────────────

/** Half portions in words: 1 → "½", 2 → "1", 3 → "1½", 0 → "0". */
export function halfText(half: number): string {
  const whole = Math.floor(half / 2);
  if (half % 2 === 0) return String(whole);
  return whole === 0 ? "½" : `${whole}½`;
}

/** "½ portion", "1 portion", "1½ portions", "4 portions". */
export function portionsText(half: number): string {
  return `${halfText(half)} ${half <= 2 && half > 0 ? "portion" : "portions"}`;
}

/** The portion chips on Home's to-do (SM-10: 0 · ½ · 1 · 1½ · 2). */
export const CLAIM_CHOICES: readonly number[] = [0, 1, 2, 3, 4];

/**
 * What one portion costs: the total over the portions, to the paisa. Exact
 * when it divides evenly; otherwise a rounded rate (shown with "≈"), never an
 * amount anyone is charged — the split is the engine's.
 */
export function perPortion(dish: Pick<KitchenDish, "totalMinor" | "portionsHalf">): { minor: number; exact: boolean } {
  const twice = dish.totalMinor * 2;
  const halves = Math.max(1, dish.portionsHalf);
  return { minor: Math.round(twice / halves), exact: twice % halves === 0 };
}

/** "₹52.75", or "≈ ₹33.33" when the total does not divide evenly. */
export function perPortionText(dish: Pick<KitchenDish, "totalMinor" | "portionsHalf" | "currency">): string {
  const p = perPortion(dish);
  return `${p.exact ? "" : "≈ "}${formatMinor(p.minor, dish.currency)}`;
}

// ── State and header ──────────────────────────────────────────────

export type DishChipTone = "open" | "ready" | "done" | "muted";

export interface DishChip {
  label: string;
  tone: DishChipTone;
}

/** The dish's one status word (SM-10): Open · Draft · Finalized · Canceled. */
export function dishStateChip(dish: Pick<KitchenDish, "state">): DishChip {
  switch (dish.state) {
    case "open":
      return { label: "Open", tone: "open" };
    case "draft":
      return { label: "Draft", tone: "open" };
    case "finalized":
      return { label: "Finalized", tone: "ready" };
    case "canceled":
      return { label: "Canceled", tone: "muted" };
  }
}

/** The cook or an owner/admin may still change the split (assign, finalize). */
export function isSplitOpen(dish: Pick<KitchenDish, "state">): boolean {
  return dish.state === "open" || dish.state === "draft";
}

/** "today", "yesterday", "28 Oct", "28 Oct 2025" — in the viewer's calendar (the app's `dayText`, CP-23). */
export function dishDay(iso: string, now: Date): string {
  return dayText(iso, now);
}

/** "today, 8:10 pm", "yesterday, 1:05 pm", "28 Oct, 7:30 pm" (`dayAndTimeText`). */
export function dishWhen(iso: string, now: Date): string {
  return dayAndTimeText(iso, now);
}

export interface DishPeople {
  meId: string | null;
  /** Display names (CP-9); a person without one is "Member · 3f9a". */
  names?: MemberNames | null;
  /** The viewer's groups by `org_…` id, for "Flat 4B". */
  groupNames?: ReadonlyMap<string, string> | null;
}

/** A group's name, or "another group" for one the viewer is not in. */
export function groupLabel(orgId: string, groupNames?: ReadonlyMap<string, string> | null): string {
  return groupNames?.get(orgId) ?? "another group";
}

/** "You cooked · shared with Flat 4B · today, 8:10 pm"; "Meera cooked · just for them · …". */
export function dishSubtitle(dish: Pick<KitchenDish, "cook" | "orgId" | "cookedAt">, p: DishPeople & { now: Date }): string {
  const shared = dish.orgId
    ? `shared with ${p.groupNames?.get(dish.orgId) ?? "a group"}`
    : dish.cook === p.meId
      ? "just for you"
      : "just for them";
  return [`${memberLabel(dish.cook, p.meId, p.names)} cooked`, shared, dishWhen(dish.cookedAt, p.now)].filter(Boolean).join(" · ");
}

// ── The cost card ─────────────────────────────────────────────────

/** "6 ingredients from 3 pantries + ₹15.00 extras" (the cook's own pantry counts as one). */
export function ingredientsSummary(dish: Pick<KitchenDish, "ingredients" | "extrasMinor" | "currency">): string {
  const pantries = new Set(dish.ingredients.map((i) => i.orgId ?? "mine")).size;
  const base = `${countWords(dish.ingredients.length, "ingredient")} from ${countWords(pantries, "pantry", "pantries")}`;
  return dish.extrasMinor > 0 ? `${base} + ${formatMinor(dish.extrasMinor, dish.currency)} extras` : base;
}

/** How much went in, in a friendly unit: "200 g", "500 g" of a kilo bag, "2 pcs". */
export function ingredientQty(i: Pick<KitchenDishIngredient, "qtyMilli" | "quantity" | "unit">): string {
  return isUnit(i.unit) ? formatQuantity(i.qtyMilli, dimensionOf(i.unit), i.unit) : `${i.quantity} ${i.unit}`;
}

export interface IngredientLine {
  key: string;
  name: string;
  qty: string;
  /** "your pantry", "Rahul's pantry", "Flat 4B, Anu paid". */
  where: string;
  amountMinor: number;
}

/** Each ingredient with its pantry and buyer, in the order the cook listed them. */
export function ingredientLines(dish: Pick<KitchenDish, "cook" | "ingredients">, p: DishPeople): IngredientLine[] {
  const cookIsMe = p.meId !== null && p.meId === dish.cook;
  return dish.ingredients.map((i, idx) => ({
    key: `${i.itemId}:${idx}`,
    name: i.name,
    qty: ingredientQty(i),
    where:
      i.orgId === null
        ? cookIsMe
          ? "your pantry"
          : `${memberLabel(dish.cook, p.meId, p.names)}'s pantry`
        : `${groupLabel(i.orgId, p.groupNames)}, ${memberLabelInline(i.paidBy, p.meId, p.names)} paid`,
    amountMinor: i.costMinor,
  }));
}

// ── Shares and the split ──────────────────────────────────────────

/** One eater as the screen holds them: half portions, or an exact amount. */
export interface ShareDraft {
  readonly subjectId: string;
  readonly portionsHalf: number | null;
  readonly exactMinor: number | null;
}

/** The dish's shares as the API lists them (the cook's first, then as claimed or set). */
export function sharesOf(dish: Pick<KitchenDish, "shares">): ShareDraft[] {
  return dish.shares.map((s) => ({ subjectId: s.subjectId, portionsHalf: s.portionsHalf, exactMinor: s.exactMinor }));
}

/** Someone's half portions in `shares` (0 when they have none or an exact amount). */
export function halfOf(shares: readonly ShareDraft[], subjectId: string | null): number {
  if (!subjectId) return 0;
  return shares.find((s) => s.subjectId === subjectId)?.portionsHalf ?? 0;
}

/**
 * `shares` with one person's half portions set: in their place when they
 * already have a share, added after everyone else when new (as a claim is),
 * left out at zero (as a claim of 0 takes it back).
 */
export function withHalf(shares: readonly ShareDraft[], subjectId: string, half: number): ShareDraft[] {
  const at = shares.findIndex((s) => s.subjectId === subjectId);
  if (half <= 0) return shares.filter((_, i) => i !== at);
  const next: ShareDraft = { subjectId, portionsHalf: half, exactMinor: null };
  return at < 0 ? [...shares, next] : shares.map((s, i) => (i === at ? next : s));
}

/** What `…/shares` and `…/correct` send: everyone with something, as listed. */
export function shareRequests(shares: readonly ShareDraft[]): DishShareRequest[] {
  const out: DishShareRequest[] = [];
  for (const s of shares) {
    if (s.exactMinor !== null) out.push({ subjectId: s.subjectId, exactMinor: s.exactMinor });
    else if ((s.portionsHalf ?? 0) > 0) out.push({ subjectId: s.subjectId, portionsHalf: s.portionsHalf! });
  }
  return out;
}

/** The same people with the same shares, whatever the order. */
export function sameShares(a: readonly ShareDraft[], b: readonly ShareDraft[]): boolean {
  const key = (list: readonly ShareDraft[]) =>
    shareRequests(list)
      .map((s) => `${s.subjectId}:${s.portionsHalf ?? ""}:${s.exactMinor ?? ""}`)
      .sort()
      .join("|");
  return key(a) === key(b);
}

/** What the screen shows about a split: the API's, or the engine's preview of shares not yet sent. */
export interface SplitView {
  claimedHalf: number;
  unclaimedHalf: number;
  /** More half portions are set than were cooked (only while the cook edits). */
  over: boolean;
  /** What each person owes for the dish, the cook's first (theirs includes the unclaimed portions). */
  amounts: DishAmount[];
  /** What the unclaimed portions are worth: the leftovers' price. */
  unclaimedMinor: number;
  /** Inside the dish's group: each person against the cook, net. */
  netting: DishNet[];
}

/** The split as the API answered it. */
export function splitOfDish(
  dish: Pick<KitchenDish, "claimedHalf" | "unclaimedHalf" | "amounts" | "unclaimedMinor" | "netting">,
): SplitView {
  return {
    claimedHalf: dish.claimedHalf,
    unclaimedHalf: dish.unclaimedHalf,
    over: false,
    amounts: dish.amounts,
    unclaimedMinor: dish.unclaimedMinor,
    netting: dish.netting,
  };
}

type SplitDish = Pick<KitchenDish, "cook" | "orgId" | "name" | "totalMinor" | "portionsHalf" | "ingredients">;

function hasSomething(s: ShareDraft): boolean {
  return s.exactMinor !== null || (s.portionsHalf ?? 0) > 0;
}

/**
 * The engine's split of `shares`, as kitchen-worker makes it: the cook's
 * share first, then in the order given; exact amounts off the top, the rest
 * by half portions with the unclaimed ones to the cook (`buildDish`); the
 * unclaimed portions' worth is their part of the cook's portion amount
 * (`splitByWeights`); and the netting against what the cook took from the
 * group's pantry (`buildIngredientTake` + `pairLines`).
 */
export function previewSplit(dish: SplitDish, shares: readonly ShareDraft[]): SplitView {
  const listed = shares.filter(hasSomething);
  const ordered = [...listed.filter((s) => s.subjectId === dish.cook), ...listed.filter((s) => s.subjectId !== dish.cook)];
  const claimedHalf = ordered.reduce((sum, s) => sum + (s.exactMinor === null ? (s.portionsHalf ?? 0) : 0), 0);
  const empty = { claimedHalf, unclaimedHalf: Math.max(0, dish.portionsHalf - claimedHalf), amounts: [], unclaimedMinor: 0, netting: [] };
  if (claimedHalf > dish.portionsHalf) return { ...empty, over: true };

  const engineShares: DishShare[] = ordered.map((s) =>
    s.exactMinor !== null ? { subjectId: s.subjectId, exactMinor: s.exactMinor } : { subjectId: s.subjectId, portionsHalf: s.portionsHalf ?? 0 },
  );
  let built: ReturnType<typeof buildDish>;
  try {
    built = buildDish({ cookId: dish.cook, totalMinor: dish.totalMinor, portionsHalf: dish.portionsHalf, shares: engineShares });
  } catch {
    // Fixed amounts over the total: nothing on screen sets them, and the server refuses them.
    return { ...empty, over: false };
  }
  const cookShare = ordered.find((s) => s.subjectId === dish.cook);
  const cookOwed = built.owedBy.get(dish.cook) ?? 0;
  const cookPortionsMinor = cookOwed - (cookShare?.exactMinor ?? 0);
  const unclaimedMinor =
    built.unclaimedHalf > 0 && cookPortionsMinor > 0
      ? splitByWeights(cookPortionsMinor, [cookShare?.portionsHalf ?? 0, built.unclaimedHalf])[1]!
      : 0;
  const amounts: DishAmount[] = [
    {
      subjectId: dish.cook,
      portionsHalf: cookShare ? cookShare.portionsHalf : 0,
      exactMinor: cookShare ? cookShare.exactMinor : null,
      owedMinor: cookOwed,
    },
    ...ordered
      .filter((s) => s.subjectId !== dish.cook)
      .map((s) => ({ subjectId: s.subjectId, portionsHalf: s.portionsHalf, exactMinor: s.exactMinor, owedMinor: built.owedBy.get(s.subjectId) ?? 0 })),
  ];
  return {
    claimedHalf,
    unclaimedHalf: built.unclaimedHalf,
    over: false,
    amounts,
    unclaimedMinor,
    netting: nettingPreview(dish, built.splits, amounts),
  };
}

function nettingPreview(dish: SplitDish, splits: readonly Split[], amounts: readonly DishAmount[]): DishNet[] {
  if (!dish.orgId) return [];
  const lines = dish.ingredients
    .filter((i) => i.orgId === dish.orgId && i.useTxnId !== null)
    .map((i) => ({ buyerId: i.paidBy, costMinor: i.costMinor }));
  const txns: Txn[] = [{ id: "dish", kind: "dish", title: dish.name, totalMinor: dish.totalMinor, splits }];
  if (lines.length > 0) {
    const take = buildIngredientTake({ cookId: dish.cook, lines });
    txns.push({ id: "take", kind: "use", title: dish.name, totalMinor: take.totalMinor, splits: take.splits });
  }
  const order: string[] = [];
  const nets = new Map<string, { owesCookMinor: number; cookOwesMinor: number }>();
  const entry = (subjectId: string) => {
    let net = nets.get(subjectId);
    if (!net) {
      net = { owesCookMinor: 0, cookOwesMinor: 0 };
      nets.set(subjectId, net);
      order.push(subjectId);
    }
    return net;
  };
  for (const a of amounts) if (a.subjectId !== dish.cook) entry(a.subjectId);
  for (const line of pairLines(txns)) {
    if (line.creditorId === dish.cook) entry(line.debtorId).owesCookMinor += line.amountMinor;
    else if (line.debtorId === dish.cook) entry(line.creditorId).cookOwesMinor += line.amountMinor;
  }
  return order.map((subjectId) => {
    const net = nets.get(subjectId)!;
    return { subjectId, ...net, netMinor: net.owesCookMinor - net.cookOwesMinor };
  });
}

/**
 * Whether the API's split (`amounts`) is of the dish's shares as they are: a
 * portion shown before the server answers (Cookpool SM-5) changes the shares
 * and leaves the amounts as they were, and an open dish is then previewed.
 */
export function amountsFitShares(dish: Pick<KitchenDish, "cook" | "state" | "shares" | "amounts">): boolean {
  if (dish.state !== "open" && dish.state !== "draft") return true;
  // A claim the server has not answered yet is a new share with a pending id.
  if (dish.shares.some((s) => isPendingId(s.id))) return false;
  const bySubject = new Map(dish.shares.map((s) => [s.subjectId, s] as const));
  for (const a of dish.amounts) {
    const share = bySubject.get(a.subjectId);
    if (!share) {
      if (a.subjectId !== dish.cook || (a.portionsHalf ?? 0) !== 0 || a.exactMinor !== null) return false;
      continue;
    }
    if ((a.portionsHalf ?? null) !== (share.portionsHalf ?? null) || (a.exactMinor ?? null) !== (share.exactMinor ?? null)) return false;
  }
  return true;
}

/**
 * The split the screen shows: the API's while the shares on screen are the
 * dish's own (and it is of them), else the engine's preview of them.
 */
export function splitFor(dish: KitchenDish, shares: readonly ShareDraft[]): SplitView {
  return sameShares(shares, sharesOf(dish)) && amountsFitShares(dish) ? splitOfDish(dish) : previewSplit(dish, shares);
}

/** The most half portions the viewer may claim: what nobody has, plus their own. */
export function claimableHalf(dish: Pick<KitchenDish, "unclaimedHalf" | "myClaimHalf">): number {
  return dish.unclaimedHalf + dish.myClaimHalf;
}

/**
 * The most half portions anyone may give `subjectId` now (Cookpool SM-7):
 * what they have plus what nobody has — the server's guard (SM-6), so a step
 * past it is off rather than refused.
 */
export function portionLimit(dish: Pick<KitchenDish, "shares" | "unclaimedHalf">, subjectId: string): number {
  return (dish.shares.find((s) => s.subjectId === subjectId)?.portionsHalf ?? 0) + dish.unclaimedHalf;
}

/** Someone's half portions as the dish has them (0 for none, or an exact amount). */
export function portionOf(dish: Pick<KitchenDish, "shares">, subjectId: string): number {
  return dish.shares.find((s) => s.subjectId === subjectId)?.portionsHalf ?? 0;
}

/**
 * Who set a share, as its row says it (SM-7, design rule 5): "by Anu" when
 * someone else set it, "by you" when you set someone else's; nothing when
 * the person set their own, or it was set before anyone could (`setBy` null
 * or missing).
 */
export function setByText(
  share: Pick<KitchenDishShare, "subjectId"> & { setBy?: string | null | undefined },
  meId: string | null,
  names?: MemberNames | null,
): string | null {
  const by = share.setBy ?? null;
  if (!by || by === share.subjectId) return null;
  return `by ${memberLabelInline(by, meId, names)}`;
}

/** Whose portion and how much, in a button or a toast: "Anu · 1 portion", "You · ½ portion". */
export function portionLabel(subjectId: string, half: number, meId: string | null, names?: MemberNames | null): string {
  return `${memberLabel(subjectId, meId, names)} · ${portionsText(Math.max(0, half))}`;
}

// ── Who had some ──────────────────────────────────────────────────

export interface WhoRow {
  subjectId: string;
  label: string;
  isMe: boolean;
  isCook: boolean;
  /** Half portions on screen. */
  half: number;
  /** A fixed amount instead of portions (kept as it is when the cook edits). */
  exactMinor: number | null;
  /** What they owe for what they had (the cook's own part, without the leftovers); null when nothing. */
  amountMinor: number | null;
  /** "by Anu", "by you" (`setByText`); null when they set their own, or nobody is known to have. */
  by: string | null;
  /** The numbers: "₹52.75", "₹50.00 fixed", "Not saved yet · ₹26.37" (the cook's edit); "" for nothing. */
  note: string;
}

export interface WhoInput extends DishPeople {
  dish: Pick<KitchenDish, "cook" | "state" | "splitMode" | "currency" | "shares">;
  /** The shares on screen (the dish's own, or the cook's edit). */
  shares: readonly ShareDraft[];
  split: SplitView;
  /**
   * The group's members, in the order to list them (you first, then by
   * name). While the dish is being split (or corrected) everyone is listed,
   * each in their place — the cook, then these, then anyone else with a
   * share — so no row moves when someone's portion is set. Once it is
   * finalized only who had some is listed, as shared.
   */
  others?: readonly string[] | null;
  /** The cook is editing: rows changed from the dish's own shares say so. */
  editing?: boolean;
}

/**
 * One row per person: the cook first; while it is still being split (or the
 * cook is correcting it) then everyone in the group in `others`' order, and
 * anyone else with a share; once it is finalized, everyone with a share as
 * listed. Each says who set the share, if it was someone else (SM-7), and
 * what it costs them.
 */
export function whoHadSome(input: WhoInput): WhoRow[] {
  const { dish, shares, split, meId, names } = input;
  const settled = dish.state === "finalized" || dish.state === "canceled";
  const ids: string[] = [dish.cook];
  const push = (id: string) => {
    if (!ids.includes(id)) ids.push(id);
  };
  // A correction can count in someone who had none, so the whole group is listed while editing too.
  if (!settled || input.editing) for (const id of input.others ?? []) push(id);
  for (const s of shares) push(s.subjectId);

  const saved = new Map(dish.shares.map((s) => [s.subjectId, s]));
  const amounts = new Map(split.amounts.map((a) => [a.subjectId, a.owedMinor]));

  return ids.map((id) => {
    const isMe = meId !== null && id === meId;
    const isCook = id === dish.cook;
    const share = shares.find((s) => s.subjectId === id) ?? null;
    const half = share?.portionsHalf ?? 0;
    const exactMinor = share?.exactMinor ?? null;
    const has = share !== null && hasSomething(share);
    const owed = amounts.get(id) ?? 0;
    // The cook's amount holds the unclaimed portions too; the leftovers note explains those.
    const own = isCook ? owed - split.unclaimedMinor : owed;
    // A canceled dish moves no money: who had claimed shows, without amounts.
    const amountMinor = has && !split.over && dish.state !== "canceled" ? Math.max(0, own) : null;

    const parts: string[] = [];
    const before = saved.get(id) ?? null;
    const changed = !before ? has : before.portionsHalf !== share?.portionsHalf || before.exactMinor !== share?.exactMinor;
    const unsaved = input.editing === true && changed;
    if (unsaved) parts.push("Not saved yet");
    if (exactMinor !== null) parts.push(`${formatMinor(exactMinor, dish.currency)} fixed`);
    else if (amountMinor !== null) parts.push(formatMinor(amountMinor, dish.currency));
    const by = !unsaved && has && before ? setByText(before, meId, names) : null;

    return { subjectId: id, label: memberLabel(id, meId, names), isMe, isCook, half, exactMinor, amountMinor, by, note: parts.join(" · ") };
  });
}

export type CountTone = "exact" | "over" | "under";

/**
 * "3½ of 4 had" (a draft, a finalized dish, the cook's edit) — green when
 * every portion is had, red when more are set than were cooked. Plain words
 * (SM-10, rule 3): "had", whether people said it or the cook did.
 */
export function claimCount(
  dish: Pick<KitchenDish, "portionsHalf">,
  split: Pick<SplitView, "claimedHalf" | "over">,
): { text: string; tone: CountTone } {
  const tone: CountTone = split.over || split.claimedHalf > dish.portionsHalf ? "over" : split.claimedHalf === dish.portionsHalf ? "exact" : "under";
  return { text: `${halfText(split.claimedHalf)} of ${halfText(dish.portionsHalf)} had`, tone };
}

/**
 * "3 of 6 left" — what anyone may still be given of an open dish (SM-7),
 * shown once, over everyone's rows: green when every portion is had.
 */
export function portionsLeft(
  dish: Pick<KitchenDish, "portionsHalf">,
  split: Pick<SplitView, "unclaimedHalf" | "over">,
): { text: string; tone: CountTone } {
  const tone: CountTone = split.over ? "over" : split.unclaimedHalf === 0 ? "exact" : "under";
  return { text: `${halfText(split.unclaimedHalf)} of ${halfText(dish.portionsHalf)} left`, tone };
}

/** The alert when more portions are set than were cooked. */
export const OVER_CLAIMED = "More portions set than cooked";

/**
 * What happens to the portions nobody had, in numbers (SM-10): they become
 * the cook's Leftovers — "2 portions left over · to your pantry · ₹105.50" —
 * for a dish shared with a group only (one just for its cook makes none).
 */
export function leftoverNote(
  input: DishPeople & { dish: Pick<KitchenDish, "cook" | "orgId" | "state" | "totalMinor" | "portionsHalf" | "currency">; split: SplitView },
): string | null {
  const { dish, split, meId, names } = input;
  if (!dish.orgId || dish.state === "canceled" || split.over || split.unclaimedHalf <= 0) return null;
  const portions = capitalize(portionsText(split.unclaimedHalf));
  const worth = formatMinor(split.unclaimedMinor, dish.currency);
  const finalized = dish.state === "finalized";
  if (meId !== null && dish.cook === meId) {
    return finalized ? `${portions} in your pantry as Leftovers · ${worth}` : `${portions} left over · to your pantry · ${worth}`;
  }
  const cook = memberLabel(dish.cook, meId, names);
  return finalized ? `${cook} kept ${portionsText(split.unclaimedHalf)}` : `${portions} left over · to ${cook}`;
}

// ── Claims ────────────────────────────────────────────────────────

/** What the viewer owes for `half` half portions: the API's amount when it is their claim already, else the engine's preview. */
export function claimOwedMinor(dish: KitchenDish, meId: string, half: number): number {
  if (half === dish.myClaimHalf) {
    const mine = dish.amounts.find((a) => a.subjectId === meId);
    if (mine) return meId === dish.cook ? mine.owedMinor - dish.unclaimedMinor : mine.owedMinor;
  }
  const split = previewSplit(dish, withHalf(sharesOf(dish), meId, half));
  const owed = split.amounts.find((a) => a.subjectId === meId)?.owedMinor ?? 0;
  return meId === dish.cook ? owed - split.unclaimedMinor : owed;
}

/**
 * The toast after setting your own portion, in one line (SM-10): "You · 1
 * portion · ₹31.20" (what it costs you), "You · none".
 */
export function claimedToast(input: { dish: KitchenDish; meId: string; names?: MemberNames | null; half: number }): { title: string; description?: string } {
  const { dish, meId, half } = input;
  if (half <= 0) return { title: "You · none" };
  return { title: `You · ${portionsText(half)} · ${formatMinor(claimOwedMinor(dish, meId, half), dish.currency)}` };
}

/**
 * The toast after setting a portion: your own claim's (`claimedToast`), or —
 * someone else's (SM-7) — who and how much, in one line: "Anu · 1 portion".
 */
export function portionToast(input: {
  dish: KitchenDish;
  subjectId: string;
  meId: string;
  names?: MemberNames | null;
  half: number;
}): { title: string; description?: string } {
  if (input.subjectId === input.meId) return claimedToast(input);
  return { title: portionLabel(input.subjectId, input.half, input.meId, input.names) };
}

interface Refusal {
  code: string;
  message: string;
  reason?: string | undefined;
  details?: Record<string, unknown> | undefined;
}

function notOpenText(state: unknown, cook: string): string {
  switch (state) {
    case "finalized":
      return `${cook} already finalized it.`;
    case "canceled":
      return "This dish was canceled.";
    case "draft":
      return `${cook} is setting everyone's share for this one.`;
    default:
      return "This dish can't take claims now.";
  }
}

/**
 * What to say when a claim is refused — your own, or (SM-7) the portion you
 * set for `subjectId`: "Only 1 portion is left for Anu now."
 */
export function claimRefusal(
  error: Refusal,
  input: { dish: Pick<KitchenDish, "cook">; meId: string | null; names?: MemberNames | null; subjectId?: string | null },
): string {
  const cook = memberLabel(input.dish.cook, input.meId, input.names);
  const other = input.subjectId && input.subjectId !== input.meId ? memberLabel(input.subjectId, input.meId, input.names) : null;
  switch (error.reason) {
    case "claims_exceed_portions": {
      const left = typeof error.details?.availableHalf === "number" ? error.details.availableHalf : null;
      if (left === null) return "That's more than is left now.";
      if (left === 0) return other ? "Every portion is taken now." : `Every portion is claimed now. Ask ${cook} if there's more.`;
      return `Only ${portionsText(left)} ${left <= 2 ? "is" : "are"} left for ${other ?? "you"} now.`;
    }
    case "dish_not_open":
      return notOpenText(error.details?.state, cook);
    case "not_in_group":
      return other ? `${other} isn't in the group any more.` : error.message;
    case "stale":
      return "The dish changed as you claimed. Try again.";
  }
  if (error.code === "not_found") {
    return other ? "You only view this group, so you can't set portions." : `You only view this group, so you can't claim. Ask ${cook} to count you in.`;
  }
  return error.message;
}

/** The toast's title when a portion is refused: "Couldn't claim Egg fried rice", "Couldn't change Anu's portion". */
export function portionRefusedTitle(input: { dish: Pick<KitchenDish, "name">; subjectId: string; meId: string; names?: MemberNames | null; half: number }): string {
  if (input.subjectId === input.meId) return input.half === 0 ? "Couldn't take your claim back" : `Couldn't claim ${input.dish.name}`;
  return `Couldn't change ${memberLabel(input.subjectId, input.meId, input.names)}'s portion`;
}

/** What to say when the cook's assignment, finalize, correction or cancel is refused. */
export function splitRefusal(error: Refusal, input: DishPeople & { dish: Pick<KitchenDish, "cook" | "portionsHalf"> }): string {
  switch (error.reason) {
    case "not_creator":
      return "Only whoever cooked it, or an owner or admin of the group, can do that.";
    case "dish_not_open":
      return error.details?.state === "finalized"
        ? "It's already finalized. Correct it instead."
        : error.details?.state === "canceled"
          ? "This dish was canceled."
          : error.message;
    case "claims_exceed_portions":
      return `More portions are set than were cooked (${halfText(input.dish.portionsHalf)}). Lower someone's share.`;
    case "not_in_group": {
      const ids = Array.isArray(error.details?.subjectIds) ? (error.details.subjectIds as unknown[]).filter((x): x is string => typeof x === "string") : [];
      const who = ids.map((id) => memberLabel(id, input.meId, input.names));
      return who.length > 0
        ? `${joinNames(who)} ${who.length === 1 ? "isn't" : "aren't"} in the group any more. Take them off and try again.`
        : "Someone you counted in isn't in the group any more. Take them off and try again.";
    }
    case "stale":
      return "The dish changed while you saved (someone claimed). Look again and retry.";
  }
  return error.message;
}

// ── How the dish moves money ──────────────────────────────────────

/** owed: the viewer gets it (blue); owe: the viewer pays it (orange); neutral: between others. */
export type FlowTone = "owed" | "owe" | "neutral";

export interface FlowLine {
  key: string;
  text: string;
  amountMinor: number;
  tone: FlowTone;
}

export interface MoneyFlow {
  /** "They owe you for what they ate" */
  eatenTitle: string;
  eaten: FlowLine[];
  /** Said instead of lines when nobody else owes for it. */
  eatenEmpty: string | null;
  /** "You owe for items you took (posted when you cooked)" */
  tookTitle: string;
  took: FlowLine[];
  tookEmpty: string | null;
  /** "Anu → you · Flat 4B", "You → Kiran · Lunch club". */
  netted: FlowLine[];
  /** The dish's own transaction has posted (finalized); before that, its lines are a preview. */
  posted: boolean;
}

function tone(from: string, to: string, meId: string | null): FlowTone {
  if (meId !== null && to === meId) return "owed";
  if (meId !== null && from === meId) return "owe";
  return "neutral";
}

/**
 * The dish's money in three parts, as the canvas draws it: what the eaters
 * owe the cook for the dish (the split), what the cook owes buyers for what
 * they took from group pantries (posted at cook time, `owes`), and the two
 * netted inside each group (the dish's group from `netting`; any other group
 * keeps its own charge).
 */
export function moneyFlow(
  input: DishPeople & { dish: Pick<KitchenDish, "cook" | "orgId" | "state" | "owes" | "ingredients" | "currency">; split: SplitView },
): MoneyFlow {
  const { dish, split, meId, names, groupNames } = input;
  const cookIsMe = meId !== null && dish.cook === meId;
  const cook = memberLabel(dish.cook, meId, names);
  const label = (id: string) => memberLabel(id, meId, names);
  const inline = (id: string) => memberLabelInline(id, meId, names);
  const finalized = dish.state === "finalized";

  const eaten: FlowLine[] = split.amounts
    .filter((a) => a.subjectId !== dish.cook && a.owedMinor > 0)
    .map((a) => ({ key: `eat:${a.subjectId}`, text: label(a.subjectId), amountMinor: a.owedMinor, tone: tone(a.subjectId, dish.cook, meId) }));
  const eatenEmpty =
    eaten.length > 0
      ? null
      : split.over
        ? OVER_CLAIMED
        : !dish.orgId
          ? cookIsMe
            ? "Just for you"
            : `Just for ${cook}`
          : finalized
            ? "Nobody else had any"
            : "Nobody yet";

  const took: FlowLine[] = dish.owes.map((o) => {
    const items = [
      ...new Set(dish.ingredients.filter((i) => i.orgId === o.orgId && i.paidBy === o.buyerId && i.useTxnId !== null).map((i) => i.name)),
    ];
    const text = [label(o.buyerId), items.length > 0 ? joinNames(items) : null, groupLabel(o.orgId, groupNames)].filter(Boolean).join(" · ");
    return { key: `took:${o.orgId}:${o.buyerId}`, text, amountMinor: o.amountMinor, tone: tone(dish.cook, o.buyerId, meId) };
  });

  const net = (from: string, to: string, orgId: string, amountMinor: number, key: string): FlowLine => ({
    key,
    text: `${label(from)} → ${inline(to)} · ${groupLabel(orgId, groupNames)}`,
    amountMinor,
    tone: tone(from, to, meId),
  });
  const netted: FlowLine[] = [];
  if (dish.orgId) {
    for (const n of split.netting) {
      const key = `net:${n.subjectId}`;
      if (n.netMinor > 0) netted.push(net(n.subjectId, dish.cook, dish.orgId, n.netMinor, key));
      else if (n.netMinor < 0) netted.push(net(dish.cook, n.subjectId, dish.orgId, -n.netMinor, key));
      else netted.push({ key, text: `${label(n.subjectId)} and ${inline(dish.cook)} are even · ${groupLabel(dish.orgId, groupNames)}`, amountMinor: 0, tone: "neutral" });
    }
  }
  for (const o of dish.owes) {
    if (o.orgId !== dish.orgId) netted.push(net(dish.cook, o.buyerId, o.orgId, o.amountMinor, `other:${o.orgId}:${o.buyerId}`));
  }

  return {
    eatenTitle: cookIsMe ? "They owe you" : `They owe ${cook}`,
    eaten,
    eatenEmpty,
    tookTitle: cookIsMe ? "You owe, for ingredients" : `${cook} owes, for ingredients`,
    took,
    tookEmpty: took.length > 0 ? null : cookIsMe ? "All yours already" : `All ${cook}'s already`,
    netted,
    posted: finalized,
  };
}

/**
 * Who owes the cook for what they ate, in one line: "Anu and Dev owe Meera
 * ₹93.60", "You owe Meera ₹31.20", "Anu owes you ₹52.75"; null when nobody
 * else had any.
 */
export function eatersOweText(
  input: DishPeople & { dish: Pick<KitchenDish, "cook" | "currency">; amounts: readonly Pick<DishAmount, "subjectId" | "owedMinor">[] },
): string | null {
  const { dish, meId, names } = input;
  const eaters = input.amounts.filter((a) => a.subjectId !== dish.cook && a.owedMinor > 0);
  if (eaters.length === 0) return null;
  const sum = eaters.reduce((t, a) => t + a.owedMinor, 0);
  const who = joinNames(eaters.map((a) => memberLabelInline(a.subjectId, meId, names)));
  const verb = eaters.length === 1 && eaters[0]!.subjectId !== meId ? "owes" : "owe";
  return `${capitalize(who)} ${verb} ${memberLabelInline(dish.cook, meId, names)} ${formatMinor(sum, dish.currency)}`;
}

/**
 * The toast after finalizing, in one line (SM-10): "Finalized · Anu and Dev
 * owe you ₹105.50". No "posted": the dish says Finalized, and its page has
 * the leftovers.
 */
export function finalizedToast(input: DishPeople & { dish: KitchenDish; groupName: string | null }): { title: string } {
  const { dish } = input;
  if (!dish.orgId) return { title: "Finalized" };
  return { title: `Finalized · ${eatersOweText({ ...input, amounts: dish.amounts }) ?? "nobody owes for it"}` };
}

/** "Meera · ₹31.20 a portion", "You · ≈ ₹33.33 a portion" — under the dish's name (SM-10, the canvas). */
export function dishByline(dish: Pick<KitchenDish, "cook" | "totalMinor" | "portionsHalf" | "currency">, p: DishPeople): string {
  return `${memberLabel(dish.cook, p.meId, p.names)} · ${perPortionText(dish)} a portion`;
}

/** One line of a dish's money summary, coloured from the viewer's side. */
export interface MoneySummaryLine {
  key: string;
  text: string;
  tone: FlowTone;
}

/**
 * How a dish moves money in at most two short lines (SM-10, design §4 rule
 * 2), instead of "How this moves money": who owes the cook for what they ate,
 * and where it is settled — "Anu and Dev owe Meera ₹93.60 · in Flat 4B" — and,
 * when the cook took from others' pantries, what the cook owes for them
 * ("You owe ₹43.00 for ingredients"; your part, "Meera owes you ₹12.00 for
 * ingredients", when it is yours). The lines behind it (each person, each buyer, the net per
 * person) are the Details disclosure's, from `moneyFlow`.
 */
export function dishMoneySummary(
  input: DishPeople & { dish: Pick<KitchenDish, "cook" | "orgId" | "state" | "owes" | "currency">; split: SplitView },
): MoneySummaryLine[] {
  const { dish, split, meId, names, groupNames } = input;
  const cookIsMe = meId !== null && dish.cook === meId;
  const cook = memberLabelInline(dish.cook, meId, names);
  if (dish.state === "canceled") return [{ key: "canceled", text: "Canceled · nothing is owed", tone: "neutral" }];
  if (!dish.orgId) return [{ key: "solo", text: cookIsMe ? "Just for you" : `Just for ${cook}`, tone: "neutral" }];
  if (split.over) return [{ key: "over", text: OVER_CLAIMED, tone: "neutral" }];

  const eaters = split.amounts.filter((a) => a.subjectId !== dish.cook && a.owedMinor > 0);
  const owe = eatersOweText({ dish, amounts: split.amounts, meId, names: names ?? null });
  const where = `in ${groupLabel(dish.orgId, groupNames)}`;
  const lines: MoneySummaryLine[] = [
    owe
      ? {
          key: "eaten",
          text: `${owe} · ${where}`,
          tone: cookIsMe ? "owed" : eaters.some((a) => a.subjectId === meId) ? "owe" : "neutral",
        }
      : { key: "eaten", text: `Nobody owes ${cook}${dish.state === "finalized" ? "" : " yet"}`, tone: "neutral" },
  ];
  if (dish.owes.length > 0) {
    // Your part when it is owed to you; otherwise the whole, without the names (Details has them).
    const mine = meId !== null && !cookIsMe ? dish.owes.filter((o) => o.buyerId === meId) : [];
    const owed = (mine.length > 0 ? mine : dish.owes).reduce((t, o) => t + o.amountMinor, 0);
    const amount = formatMinor(owed, dish.currency);
    lines.push(
      cookIsMe
        ? { key: "took", text: `You owe ${amount} for ingredients`, tone: "owe" }
        : mine.length > 0
          ? { key: "took", text: `${capitalize(cook)} owes you ${amount} for ingredients`, tone: "owed" }
          : { key: "took", text: `${capitalize(cook)} owes ${amount} for ingredients`, tone: "neutral" },
    );
  }
  return lines;
}

// ── A group's dishes (its page, SM-11) ────────────────────────────

export interface DishRowView {
  id: string;
  href: string;
  name: string;
  /** "Meera · 1 of 5 had · ₹156.00", "Dev · 28 Oct · you had 1 · ₹274.00" */
  sub: string;
  /** Its one status word (`dishStateChip`): Open · Draft · Finalized · Canceled. */
  chip: DishChip;
}

/**
 * One dish in a group's list: who cooked it, how much is had while it is
 * open (or when it was cooked, and your part, once final), its total, and
 * its status word — the dish page's — not an action-looking chip.
 */
export function dishRow(dish: KitchenDish, p: DishPeople & { now: Date }): DishRowView {
  const mine = p.meId !== null && dish.cook === p.meId;
  const parts = [memberLabel(dish.cook, p.meId, p.names)];
  if (dish.state === "open") parts.push(`${halfText(dish.claimedHalf)} of ${halfText(dish.portionsHalf)} had`);
  if (dish.state === "finalized") {
    parts.push(dishDay(dish.cookedAt, p.now));
    if (!mine && dish.myClaimHalf > 0) parts.push(`you had ${halfText(dish.myClaimHalf)}`);
  }
  parts.push(formatMinor(dish.totalMinor, dish.currency));
  return { id: dish.id, href: dishHref(dish.id), name: dish.name, sub: parts.join(" · "), chip: dishStateChip(dish) };
}
