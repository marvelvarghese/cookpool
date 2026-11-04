/**
 * What each write changes on screen before the server answers (Cookpool
 * SM-5): one set of cache patches per write — a use or waste takes stock off
 * an item wherever it is listed, a portion changes a dish's counts, finalize
 * closes a dish, "Paid" takes the payment off the plan and Home, an added
 * item or an expense shows as a row. Each is a `CachePatch` over the
 * `qk.*` keys (src/lib/query-keys.ts), so one write patches every read that
 * shows the thing.
 *
 * Only the obvious local numbers change (risk SM-D): what is left (and what
 * the rest is worth, by the engine's cost of use — the price on the button),
 * a portion count, a row added or taken off. Balances, plans' amounts and a
 * dish's money stay the server's: every read a write touched is read again
 * once it answers.
 *
 * Pure and dependency-free (contract types, the engine), so unit-testable.
 */

import type {
  ActivityPage,
  CreateExpenseRequest,
  InboxDish,
  InboxItem,
  InboxResponse,
  KitchenDish,
  KitchenDishShare,
  KitchenItem,
  KitchenStockMove,
  KitchenTxn,
  KitchenUsual,
  PantryRef,
  ReachableItem,
  SettlePayment,
  SettlePlan,
  SettlementMethod,
} from "@saas/contracts/kitchen";
import { dimensionOf, fromMilli, isUnit, toMilli } from "@saas/kitchen-engine/units";
import { pendingId, type CacheKey, type CachePatch } from "@/lib/optimistic";
import { qk } from "@/lib/query-keys";

// ── Stock: a use or waste ──────────────────────────────────────────

/** Stock taken off one item: a use or waste of `qtyMilli`, which cost `costMinor`. */
export interface StockChange {
  itemId: string;
  kind: "use" | "waste";
  qtyMilli: number;
  costMinor: number;
}

type StockFields = Pick<KitchenItem, "id" | "qtyLeftMilli" | "qtyLeft" | "qtyBought" | "qtyBoughtMilli" | "worthMinor" | "state">;

/** What is left in the item's own unit (three decimals), from thousandths. */
function leftInUnit(item: Pick<KitchenItem, "qtyBought" | "qtyBoughtMilli">, leftMilli: number): number {
  if (item.qtyBoughtMilli <= 0) return 0;
  return Math.round((item.qtyBought * leftMilli * 1000) / item.qtyBoughtMilli) / 1000;
}

/**
 * The item after `change`: less left, worth less, and used up (or wasted)
 * when nothing is left — as kitchen-worker writes it. Any other item comes
 * back as it was (the same object).
 */
export function withStockTaken<T extends StockFields>(item: T, change: StockChange): T {
  if (item.id !== change.itemId) return item;
  const left = Math.max(0, item.qtyLeftMilli - change.qtyMilli);
  const worth = left === 0 ? 0 : Math.max(0, item.worthMinor - change.costMinor);
  const state = left === 0 ? (change.kind === "waste" ? "wasted" : "used_up") : item.state;
  return { ...item, qtyLeftMilli: left, qtyLeft: leftInUnit(item, left), worthMinor: worth, state };
}

/** The item with `change` put back (Undo once the server has it): more left, worth more, active again. */
export function withStockReturned<T extends StockFields>(item: T, change: StockChange): T {
  if (item.id !== change.itemId) return item;
  const left = Math.min(item.qtyBoughtMilli, item.qtyLeftMilli + change.qtyMilli);
  const state = item.state === "used_up" || item.state === "wasted" ? "active" : item.state;
  return { ...item, qtyLeftMilli: left, qtyLeft: leftInUnit(item, left), worthMinor: item.worthMinor + change.costMinor, state };
}

/** A list of items with `change` applied: an item with nothing left leaves the list (lists hold what is left). */
function takeFromList<T extends StockFields>(list: readonly T[], change: StockChange): readonly T[] {
  const at = list.findIndex((i) => i.id === change.itemId);
  if (at < 0) return list;
  const next = withStockTaken(list[at]!, change);
  return next.qtyLeftMilli > 0 ? list.map((x, i) => (i === at ? next : x)) : list.filter((_, i) => i !== at);
}

function returnToList<T extends StockFields>(list: readonly T[], change: StockChange): readonly T[] {
  return list.some((i) => i.id === change.itemId) ? list.map((x) => withStockReturned(x, change)) : list;
}

function usualsWith(list: readonly KitchenUsual[], change: StockChange, back: boolean): readonly KitchenUsual[] {
  const at = list.findIndex((u) => u.itemId === change.itemId);
  if (at < 0) return list;
  const u = list[at]!;
  const left = back ? u.qtyLeftMilli + change.qtyMilli : Math.max(0, u.qtyLeftMilli - change.qtyMilli);
  // Usuals are items with something left.
  if (left === 0) return list.filter((_, i) => i !== at);
  return list.map((x, i) => (i === at ? { ...u, qtyLeftMilli: left } : x));
}

function inboxStockWith(inbox: InboxResponse, change: StockChange, back: boolean): InboxResponse {
  let hit = false;
  const items: InboxItem[] = [];
  for (const entry of inbox.items) {
    if (entry.kind !== "use_soon" || entry.item.id !== change.itemId) {
      items.push(entry);
      continue;
    }
    hit = true;
    const before = entry.item.qtyLeftMilli;
    const left = back ? before + change.qtyMilli : Math.max(0, before - change.qtyMilli);
    // Home lists only items with something left.
    if (left === 0) continue;
    const quantity = before > 0 ? Math.round((entry.item.quantity * left * 1000) / before) / 1000 : entry.item.quantity;
    items.push({ ...entry, item: { ...entry.item, qtyLeftMilli: left, quantity } });
  }
  return hit ? withCounts(inbox, items) : inbox;
}

/** The inbox with `items`, its counts recounted. */
function withCounts(inbox: InboxResponse, items: InboxItem[]): InboxResponse {
  const counts = { ...inbox.counts, total: items.length };
  for (const k of Object.keys(inbox.counts) as (keyof InboxResponse["counts"])[]) {
    if (k !== "total") counts[k] = items.filter((i) => i.kind === k).length;
  }
  return { ...inbox, items, counts };
}

function isArray(data: unknown): data is readonly unknown[] {
  return Array.isArray(data);
}

/** `change` on every pantry read that lists the item, by its key's shape (`qk.kitchenPantry()…`). */
function stockUpdate(change: StockChange, back: boolean) {
  const item = <T extends StockFields>(i: T): T => (back ? withStockReturned(i, change) : withStockTaken(i, change));
  const list = <T extends StockFields>(l: readonly T[]): readonly T[] => (back ? returnToList(l, change) : takeFromList(l, change));
  return (data: unknown, key: CacheKey): unknown => {
    switch (key[1]) {
      case "item":
        return item(data as KitchenItem);
      case "items": {
        const d = data as { items: ReachableItem[]; truncated: boolean };
        const items = list(d.items);
        return items === d.items ? d : { ...d, items };
      }
      case "useSoon": {
        const d = data as { soon: ReachableItem[]; expired: ReachableItem[] };
        const soon = list(d.soon);
        const expired = list(d.expired);
        return soon === d.soon && expired === d.expired ? d : { soon, expired };
      }
      case "search":
      case "usable":
      case "cookable":
        return isArray(data) ? list(data as ReachableItem[]) : data;
      case "usuals":
        return isArray(data) ? usualsWith(data as KitchenUsual[], change, back) : data;
      default:
        // `pantries` (totals: the server's), `moves` (its own patch).
        return data;
    }
  };
}

/** A use or waste as the item's history shows it until the server's move arrives. */
export function pendingMove(input: {
  change: StockChange;
  quantity: number;
  unit: string;
  actor: string;
  consumers: readonly string[] | null;
  at: string;
  id?: string;
}): KitchenStockMove {
  return {
    id: input.id ?? pendingId("mov"),
    itemId: input.change.itemId,
    kind: input.change.kind,
    qtyMilli: input.change.qtyMilli,
    quantity: input.quantity,
    unit: input.unit,
    costMinor: input.change.costMinor,
    actor: input.actor,
    consumers: input.consumers ? [...input.consumers] : null,
    txnId: null,
    reverses: null,
    at: input.at,
    undone: false,
    undoneBy: null,
  };
}

/**
 * Every cached read a use or waste changes: the item (its page), each list
 * it is in (pantries, Home's use-soon strip, search, usuals, cookable) and
 * Home's inbox card. Its history row is `movesPatch`, by the item's ref.
 */
export function stockPatches(change: StockChange): CachePatch[] {
  return [
    { prefix: qk.kitchenPantry(), update: stockUpdate(change, false) },
    { prefix: qk.kitchenInbox(), update: (d) => inboxStockWith(d as InboxResponse, change, false) },
  ];
}

/** The moves read of one item (by its page ref), for a row added there. */
export function movesPatch(ref: string, move: KitchenStockMove): CachePatch {
  return { prefix: qk.kitchenItemMoves(ref), update: (d) => (isArray(d) ? [move, ...(d as KitchenStockMove[])] : d) };
}

/** Undo of a use or waste once the server has it: the stock back wherever the item is still listed. */
export function stockReturnPatches(change: StockChange): CachePatch[] {
  return [
    { prefix: qk.kitchenPantry(), update: stockUpdate(change, true) },
    { prefix: qk.kitchenInbox(), update: (d) => inboxStockWith(d as InboxResponse, change, true) },
  ];
}

// ── Dishes: a portion, finalize ────────────────────────────────────

/** Someone's portion of a dish, set by `setBy` (the caller). */
export interface PortionChange {
  dishId: string;
  /** Whose portion: the caller's own claim today; anyone's once SM-7 sets other people's. */
  subjectId: string;
  /** Half portions; 0 takes it back. */
  half: number;
  /** Who set it (`usr_…`): the caller. */
  setBy: string;
  /** The caller (`myClaimHalf` is theirs). */
  meId: string;
  /** ISO time of the write. */
  at: string;
}

/**
 * The dish with one person's portion set — as a claim writes it: in their
 * place when they have a share, added after everyone else when new, gone at
 * zero; the claimed and unclaimed counts follow. What it costs stays the
 * server's until it answers (the screens preview it with the engine).
 */
export function withPortion(dish: KitchenDish, change: PortionChange): KitchenDish {
  if (dish.id !== change.dishId) return dish;
  const at = dish.shares.findIndex((s) => s.subjectId === change.subjectId);
  const current = at >= 0 ? dish.shares[at]! : null;
  if (current && current.portionsHalf === change.half && current.exactMinor === null) return dish;
  if (!current && change.half <= 0) return dish;
  let shares: KitchenDishShare[];
  if (change.half <= 0) shares = dish.shares.filter((_, i) => i !== at);
  else if (current) {
    shares = dish.shares.map((s, i) =>
      i === at ? { ...s, portionsHalf: change.half, exactMinor: null, source: "self", setBy: change.setBy, updatedAt: change.at } : s,
    );
  } else {
    shares = [
      ...dish.shares,
      {
        id: pendingId("dsr"),
        subjectId: change.subjectId,
        portionsHalf: change.half,
        exactMinor: null,
        source: "self",
        setBy: change.setBy,
        createdAt: change.at,
        updatedAt: change.at,
      },
    ];
  }
  const claimedHalf = shares.reduce((sum, s) => sum + (s.portionsHalf ?? 0), 0);
  return {
    ...dish,
    shares,
    myClaimHalf: change.subjectId === change.meId ? Math.max(0, change.half) : dish.myClaimHalf,
    claimedHalf,
    unclaimedHalf: Math.max(0, dish.portionsHalf - claimedHalf),
    updatedAt: change.at,
  };
}

/** A finalized dish, as the screens show it until the server's answer (its transaction, its leftovers) arrives. */
export function withDishFinalized(dish: KitchenDish, dishId: string, at: string): KitchenDish {
  if (dish.id !== dishId || dish.state === "finalized" || dish.state === "canceled") return dish;
  return { ...dish, state: "finalized", finalizedAt: at, updatedAt: at };
}

/** `fn` on the dish wherever it is cached: its own read and a group's Dishes tab (paged). */
function dishUpdate(fn: (dish: KitchenDish) => KitchenDish) {
  return (data: unknown, key: CacheKey): unknown => {
    if (key[1] === "dish") return fn(data as KitchenDish);
    if (key[1] === "group") {
      const d = data as { pages: { dishes: KitchenDish[]; nextCursor: string | null }[]; pageParams: unknown[] };
      if (!d || !Array.isArray(d.pages)) return data;
      let hit = false;
      const pages = d.pages.map((page) => {
        let changed = false;
        const dishes = page.dishes.map((x) => {
          const next = fn(x);
          if (next !== x) changed = true;
          return next;
        });
        if (!changed) return page;
        hit = true;
        return { ...page, dishes };
      });
      return hit ? { ...d, pages } : data;
    }
    return data;
  };
}

function inboxDishWith(inbox: InboxResponse, dishId: string, fn: (d: InboxDish) => InboxDish | null): InboxResponse {
  let hit = false;
  const items: InboxItem[] = [];
  for (const entry of inbox.items) {
    if ((entry.kind !== "claim_dish" && entry.kind !== "finalize_dish") || entry.dish.id !== dishId) {
      items.push(entry);
      continue;
    }
    hit = true;
    const next = fn(entry.dish);
    if (next) items.push({ ...entry, dish: next });
  }
  return hit ? withCounts(inbox, items) : inbox;
}

/**
 * Every cached read a portion changes: the dish, its group's Dishes tab, and
 * Home's card for it ("2 of 5 portions left"). `fromHalf` is what that person
 * had (the inbox counts only totals).
 */
export function portionPatches(change: PortionChange, fromHalf: number): CachePatch[] {
  const delta = Math.max(0, change.half) - fromHalf;
  return [
    { prefix: qk.kitchenDishes(), update: dishUpdate((d) => withPortion(d, change)) },
    {
      prefix: qk.kitchenInbox(),
      update: (d) =>
        delta === 0
          ? d
          : inboxDishWith(d as InboxResponse, change.dishId, (x) => {
              const claimedHalf = Math.max(0, x.claimedHalf + delta);
              return { ...x, claimedHalf, unclaimedHalf: Math.max(0, x.portionsHalf - claimedHalf) };
            }),
    },
  ];
}

/** Finalizing: the dish is final wherever it is cached, and Home's "Finalize your …" card goes. */
export function finalizePatches(dishId: string, at: string): CachePatch[] {
  return [
    { prefix: qk.kitchenDishes(), update: dishUpdate((d) => withDishFinalized(d, dishId, at)) },
    {
      prefix: qk.kitchenInbox(),
      update: (d) => {
        const inbox = d as InboxResponse;
        const has = inbox.items.some((i) => i.kind === "finalize_dish" && i.dish.id === dishId);
        return has ? withCounts(inbox, inbox.items.filter((i) => !(i.kind === "finalize_dish" && i.dish.id === dishId))) : inbox;
      },
    },
  ];
}

// ── Money: a payment, an expense ───────────────────────────────────

/** A payment recorded: `fromSubjectId` paid `toSubjectId` `amountMinor` in `orgId`. */
export interface PaymentChange extends SettlePayment {
  orgId: string;
}

function samePayment(a: SettlePayment, b: SettlePayment): boolean {
  return a.fromSubjectId === b.fromSubjectId && a.toSubjectId === b.toSubjectId && a.amountMinor === b.amountMinor;
}

/** The plan without the payment just recorded (its first match); the other payments stay as the server planned them. */
export function withoutPayment(plan: SettlePlan, payment: SettlePayment): SettlePlan {
  const at = plan.payments.findIndex((p) => samePayment(p, payment));
  if (at < 0) return plan;
  return {
    ...plan,
    payments: plan.payments.filter((_, i) => i !== at),
    working: { ...plan.working, payments: Math.max(0, plan.working.payments - 1) },
  };
}

function isPaymentDue(entry: InboxItem, change: PaymentChange): boolean {
  return (
    entry.kind === "payment_due" &&
    entry.orgId === change.orgId &&
    entry.toSubjectId === change.toSubjectId &&
    entry.amountMinor === change.amountMinor
  );
}

/** Home without the "You owe …" card the payment settles (it is the caller's when they pay). */
export function withoutPaymentDue(inbox: InboxResponse, change: PaymentChange): InboxResponse {
  return inbox.items.some((i) => isPaymentDue(i, change)) ? withCounts(inbox, inbox.items.filter((i) => !isPaymentDue(i, change))) : inbox;
}

/** A transaction shown before the server has posted it: the payment or the expense, as it will read. */
export function pendingTxn(input: {
  orgId: string;
  kind: "settlement" | "expense";
  title: string;
  totalMinor: number;
  currency: string;
  createdBy: string;
  at: string;
  splits: KitchenTxn["splits"];
  method?: SettlementMethod | null;
  note?: string | null;
  id?: string;
}): KitchenTxn {
  return {
    id: input.id ?? pendingId("txn"),
    orgId: input.orgId,
    kind: input.kind,
    title: input.title,
    totalMinor: input.totalMinor,
    currency: input.currency,
    occurredAt: input.at,
    createdBy: input.createdBy,
    createdAt: input.at,
    sourceKind: null,
    sourceId: null,
    reverses: null,
    reversed: false,
    reversedBy: null,
    method: input.method ?? null,
    note: input.note ?? null,
    splits: input.splits,
  };
}

/** The payment as its activity row: the payer paid it, the payee is owed it (as kitchen-worker posts it). */
export function paymentTxn(change: PaymentChange, ctx: { currency: string; method: SettlementMethod; createdBy: string; at: string; id?: string }): KitchenTxn {
  return pendingTxn({
    orgId: change.orgId,
    kind: "settlement",
    title: "Payment",
    totalMinor: change.amountMinor,
    currency: ctx.currency,
    createdBy: ctx.createdBy,
    at: ctx.at,
    method: ctx.method,
    splits: [
      { subjectId: change.fromSubjectId, paidMinor: change.amountMinor, owedMinor: 0 },
      { subjectId: change.toSubjectId, paidMinor: 0, owedMinor: change.amountMinor },
    ],
    ...(ctx.id ? { id: ctx.id } : {}),
  });
}

/**
 * The expense as its activity row: who paid what (as sent) and each
 * participant's share — the split the form showed, by the same engine — in
 * the order the form lists the people.
 */
export function expenseTxn(
  orgId: string,
  request: CreateExpenseRequest,
  owed: ReadonlyMap<string, number>,
  ctx: { currency: string; createdBy: string; at: string; order: readonly string[]; id?: string },
): KitchenTxn {
  const ids = new Set<string>([...request.payers.map((p) => p.subjectId), ...request.participants.map((p) => p.subjectId)]);
  const ordered = [...ctx.order.filter((id) => ids.has(id)), ...[...ids].filter((id) => !ctx.order.includes(id))];
  const splits = ordered.map((subjectId) => ({
    subjectId,
    paidMinor: request.payers.filter((p) => p.subjectId === subjectId).reduce((s, p) => s + p.amountMinor, 0),
    owedMinor: owed.get(subjectId) ?? 0,
  }));
  return pendingTxn({
    orgId,
    kind: "expense",
    title: request.title,
    totalMinor: request.totalMinor,
    currency: ctx.currency,
    createdBy: ctx.createdBy,
    at: ctx.at,
    note: request.note ?? null,
    splits,
    ...(ctx.id ? { id: ctx.id } : {}),
  });
}

type Paged = { pages: ActivityPage[]; pageParams: unknown[] };

function feedWith(data: unknown, fn: (items: KitchenTxn[]) => KitchenTxn[], first = false): unknown {
  const d = data as Paged;
  if (!d || !Array.isArray(d.pages) || d.pages.length === 0) return data;
  let hit = false;
  const pages = d.pages.map((page, i) => {
    if (first && i > 0) return page;
    const items = fn(page.items);
    if (items === page.items) return page;
    hit = true;
    return { ...page, items };
  });
  return hit ? { ...d, pages } : data;
}

/** `fn` on every cached list of the group's activity: the feed (paged), the whole feed, Home's recent entries. */
function ledgerUpdate(orgId: string, fn: (items: KitchenTxn[]) => KitchenTxn[], newestOnly: boolean) {
  return (data: unknown, key: CacheKey): unknown => {
    if (key[1] !== orgId) return data;
    switch (key[2]) {
      case "activity":
        return feedWith(data, fn, newestOnly);
      case "activityAll": {
        const d = data as { txns: KitchenTxn[]; truncated: boolean };
        const txns = fn(d.txns);
        return txns === d.txns ? d : { ...d, txns };
      }
      case "recent":
        return isArray(data) ? fn(data as KitchenTxn[]) : data;
      default:
        // balances and the plan: the server's.
        return data;
    }
  };
}

/** A new row at the top of the group's activity, wherever it is cached (before the server's arrives). */
export function txnAddedPatches(txn: KitchenTxn): CachePatch[] {
  const add = (items: KitchenTxn[]) => (items.some((t) => t.id === txn.id) ? items : [txn, ...items]);
  return [{ prefix: qk.kitchenLedger(txn.orgId), update: ledgerUpdate(txn.orgId, add, true) }];
}

/** A row struck through as undone wherever it is cached (Undo, before the reversal is posted). */
export function txnReversedPatches(orgId: string, txnId: string): CachePatch[] {
  const strike = (items: KitchenTxn[]) =>
    items.some((t) => t.id === txnId && !t.reversed) ? items.map((t) => (t.id === txnId ? { ...t, reversed: true } : t)) : items;
  return [{ prefix: qk.kitchenLedger(orgId), update: ledgerUpdate(orgId, strike, false) }];
}

/**
 * Every cached read "Paid" changes: the payment comes off the group's plan
 * and off Home, and its row shows at the top of the group's activity. The
 * balances wait for the server.
 */
export function paymentPatches(change: PaymentChange, txn: KitchenTxn): CachePatch[] {
  return [
    { prefix: qk.kitchenSettlePlan(change.orgId), update: (d) => withoutPayment(d as SettlePlan, change) },
    { prefix: qk.kitchenInbox(), update: (d) => withoutPaymentDue(d as InboxResponse, change) },
    ...txnAddedPatches(txn),
  ];
}

// ── Pantry: an item added ──────────────────────────────────────────

/** Whole days from `today` to `day` (YYYY-MM-DD, UTC midnights). */
function daysBetween(today: string, day: string): number {
  return Math.round((Date.parse(`${day}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
}

/**
 * The item an add will make, as the pantry lists it until the server answers:
 * the quantity in thousandths by the engine, nothing used, worth what was
 * paid. Null when the unit is not one the engine knows (the form never sends
 * one).
 */
export function pendingItem(input: {
  body: {
    name: string;
    category: string;
    quantity: string | number;
    unit: string;
    priceMinor: number;
    currency?: string | undefined;
    boughtOn?: string | undefined;
    expiresOn?: string | null | undefined;
    paidBy?: string | undefined;
    wastePolicy?: KitchenItem["wastePolicy"] | undefined;
  };
  pantry: PantryRef;
  currency: string;
  /** The group's waste rule, for a group item. */
  groupWastePolicy?: KitchenItem["wastePolicy"];
  meId: string;
  today: string;
  at: string;
  id?: string;
}): ReachableItem | null {
  const { body } = input;
  if (!isUnit(body.unit)) return null;
  let milli: number;
  try {
    milli = toMilli(body.quantity, body.unit);
  } catch {
    return null;
  }
  const qty = fromMilli(milli, body.unit);
  const group = input.pantry.kind === "group";
  const override = group ? (body.wastePolicy ?? null) : null;
  return {
    id: input.id ?? pendingId("itm"),
    pantry: input.pantry,
    name: body.name,
    category: body.category,
    dimension: dimensionOf(body.unit),
    displayUnit: body.unit,
    qtyBought: qty,
    qtyLeft: qty,
    qtyBoughtMilli: milli,
    qtyLeftMilli: milli,
    priceMinor: body.priceMinor,
    currency: input.currency,
    unitPriceMinor: qty > 0 ? Math.round(body.priceMinor / qty) : 0,
    worthMinor: body.priceMinor,
    paidBy: group ? (body.paidBy ?? input.meId) : input.meId,
    boughtOn: body.boughtOn ?? input.today,
    expiresOn: body.expiresOn ?? null,
    daysToUseBy: body.expiresOn ? daysBetween(input.today, body.expiresOn) : null,
    wastePolicy: group ? (override ?? input.groupWastePolicy ?? "split_equally") : null,
    wastePolicyOverride: override,
    state: "active",
    version: 1,
    createdBy: input.meId,
    createdAt: input.at,
    updatedAt: input.at,
    canUse: true,
  };
}

/** The pantry lists' order: soonest use-by first (none last), then by name. */
function listOrder(a: Pick<KitchenItem, "expiresOn" | "name">, b: Pick<KitchenItem, "expiresOn" | "name">): number {
  const ea = a.expiresOn ?? "9999-12-31";
  const eb = b.expiresOn ?? "9999-12-31";
  return ea < eb ? -1 : ea > eb ? 1 : a.name.localeCompare(b.name);
}

/** `items` with `item` in its place by the lists' order (or in place of `replacing`). */
export function withItemListed<T extends Pick<KitchenItem, "id" | "expiresOn" | "name">>(items: readonly T[], item: T, replacing?: string): T[] {
  const rest = items.filter((i) => i.id !== item.id && i.id !== replacing);
  const at = rest.findIndex((i) => listOrder(item, i) < 0);
  return at < 0 ? [...rest, item] : [...rest.slice(0, at), item, ...rest.slice(at)];
}

/** Which pantry choices list an item: everything, and its own pantry. */
function listsItem(choice: unknown, pantry: PantryRef): boolean {
  return choice === "all" || (pantry.kind === "personal" ? choice === "personal" : choice === pantry.orgId);
}

/**
 * Every cached read an added item shows in: the pantry it went to and "all"
 * — or, once the server answers, the server's item in place of the pending
 * one (`replacing`), so its row opens the real item.
 */
export function itemAddedPatches(item: ReachableItem, replacing?: string): CachePatch[] {
  return [
    {
      prefix: ["kitchenPantry", "items"],
      update: (d, key) => {
        if (!listsItem(key[2], item.pantry)) return d;
        const data = d as { items: ReachableItem[]; truncated: boolean };
        if (!replacing && data.items.some((i) => i.id === item.id)) return d;
        if (replacing && !data.items.some((i) => i.id === replacing)) return d;
        return { ...data, items: withItemListed(data.items, item, replacing) };
      },
    },
  ];
}

/** The item off every pantry list (an add undone once the server has made it). */
export function itemRemovedPatches(itemId: string): CachePatch[] {
  return [
    {
      prefix: ["kitchenPantry", "items"],
      update: (d) => {
        const data = d as { items: ReachableItem[]; truncated: boolean };
        return data.items.some((i) => i.id === itemId) ? { ...data, items: data.items.filter((i) => i.id !== itemId) } : d;
      },
    },
  ];
}
