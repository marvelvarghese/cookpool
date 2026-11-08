import { QueryClient, QueryObserver, keepPreviousData } from "@tanstack/react-query";
import type { ItemHistoryEntry, KitchenItem, MyGroupBalance, Recipe, RecipeIngredient, RecipeMatch } from "@saas/contracts/kitchen";
import { qk } from "@web-console-next/lib/query-keys";
import { initialItemForm, previewItemForm } from "@web-console-next/components/kitchen/item-form";
import { JUST_ME, cookRequest, dishTotals, pantryLine, previewNewItem, type DishLine } from "@web-console-next/components/kitchen/dish-maker";
import { itemRefOf, itemRefParam } from "@web-console-next/components/kitchen/pantry";
import { amountCost } from "@web-console-next/components/kitchen/item-use";
import {
  FROM_BEFORE_DEBOUNCE_MS,
  FROM_BEFORE_LIMIT,
  FROM_BEFORE_STALE_MS,
  TYPEAHEAD_CLOSED,
  addDays,
  createDebounce,
  fromBeforeTerm,
  historyFill,
  historySuggestion,
  ingredientLine,
  mergeRecipeLines,
  missingDraft,
  missingFor,
  newLineFromMissing,
  priceInput,
  quantityInput,
  recipeFill,
  recipeSuggestion,
  resolvePending,
  shortMoney,
  shownSuggestions,
  typeaheadKey,
  type DebounceTimers,
} from "@web-console-next/components/kitchen/from-before";
import { itemHistoryQuery, recipesQuery } from "@web-console-next/components/kitchen/from-before-data";
import {
  ANU,
  FLAT,
  LUNCH,
  ME,
  MEERA,
  PERSONAL_REF,
  TRIP,
  groupPantry,
  groupRef,
  makeItem,
  personalPantry,
} from "./kitchen-pantry-fixtures";

// SM-9: "from before" on Bought and on Cook. The fixtures are the canvas's
// (SimpleAddItem "Bought from before", SimpleCook "Cook again"): Rahul (ME)
// bought milk for Flat 4B six times, Meera paid last time; he cooks egg fried
// rice again from Flat 4B's rice and oil and his own eggs, and the spring
// onions are in no pantry now.

const TODAY = "2026-11-04";

function entry(patch: Partial<ItemHistoryEntry> = {}): ItemHistoryEntry {
  return {
    name: "Milk",
    category: "dairy",
    dimension: "volume",
    unit: "L",
    quantity: 1,
    qtyMilli: 1_000_000,
    priceMinor: 6800,
    currency: "INR",
    pantry: { kind: "group", orgId: FLAT.orgId, name: FLAT.name },
    paidBy: MEERA,
    wastePolicy: null,
    useByDays: 5,
    times: 6,
    lastBoughtOn: "2026-10-30",
    ...patch,
  };
}

// The pantries the Add-item form adds to: yours, Flat 4B, Goa trip (USD). Lunch club is a viewer's: left out.
const WRITABLE = [personalPantry(), groupPantry(FLAT), groupPantry(TRIP, { currency: "USD" })];
const fillCtx = (patch: Partial<Parameters<typeof historyFill>[2]> = {}) => ({
  today: TODAY,
  pantries: WRITABLE,
  fallbackPantry: "personal",
  meId: ME,
  ...patch,
});
const blank = () => initialItemForm({ today: TODAY, pantry: "personal", meId: ME });

describe("what a read asks for (fromBeforeTerm)", () => {
  it("trims, collapses spaces and folds ASCII letters only, as the server's lower() does", () => {
    expect(fromBeforeTerm("  Mi ")).toBe("mi");
    expect(fromBeforeTerm("Egg   Fried\tRice")).toBe("egg fried rice");
    expect(fromBeforeTerm("Élan")).toBe("Élan");
    expect(fromBeforeTerm("")).toBe("");
    expect(fromBeforeTerm("x".repeat(150))).toHaveLength(100);
  });
});

describe("a suggestion, in one line", () => {
  it("bought before: name · amount · pantry · times · price", () => {
    expect(historySuggestion(entry())).toMatchObject({
      name: "Milk",
      meta: "1 L · Flat 4B · 6×",
      price: "₹68",
      label: "Milk · 1 L · Flat 4B · 6× · ₹68",
    });
    const mint = historySuggestion(
      entry({ name: "Mint leaves", unit: "pcs", dimension: "count", quantity: 1, qtyMilli: 1000, pantry: { kind: "personal", orgId: null, name: "My pantry" }, times: 2, priceMinor: 2050 }),
    );
    expect(mint.label).toBe("Mint leaves · 1 pc · Personal · 2× · ₹20.50");
  });

  it("cooked before: name · times · portions · what it cost", () => {
    expect(recipeSuggestion(recipe()).label).toBe("Egg fried rice · 3× · 5 portions · ₹156");
    expect(recipeSuggestion(recipe({ name: "Egg bhurji", times: 1, portionsHalf: 2, totalMinor: 6400 })).label).toBe("Egg bhurji · 1× · 1 portion · ₹64");
    expect(recipeSuggestion(recipe({ portionsHalf: 5 })).meta).toBe("3× · 2½ portions");
  });

  it("money without a whole number's .00", () => {
    expect(shortMoney(6800, "INR")).toBe("₹68");
    expect(shortMoney(24950, "INR")).toBe("₹249.50");
    expect(shortMoney(123456700, "INR")).toBe("₹1,234,567");
  });
});

describe("what the list shows while someone types (shownSuggestions)", () => {
  const answer = [{ name: "Milk" }, { name: "Mint leaves" }, { name: "Millet flour" }];

  it("narrows the answer to what is typed now, at once", () => {
    expect(shownSuggestions(answer, "mil", false).map((s) => s.name)).toEqual(["Milk", "Millet flour"]);
    expect(shownSuggestions(answer, "MILK", false).map((s) => s.name)).toEqual(["Milk"]);
    expect(shownSuggestions(answer, "", true)).toHaveLength(3);
  });

  it("keeps a previous answer whole rather than flash empty; an answer for this text that matches nothing is empty", () => {
    expect(shownSuggestions(answer, "ma", false)).toHaveLength(3);
    expect(shownSuggestions([], "ma", true)).toEqual([]);
    expect(shownSuggestions(null, "mi", false)).toEqual([]);
  });
});

describe("the keyboard (typeaheadKey)", () => {
  const open = (active = -1) => ({ open: true, active });

  it("↓ opens the list on the first suggestion, then moves down and round", () => {
    expect(typeaheadKey(TYPEAHEAD_CLOSED, "ArrowDown", 3)).toEqual({ state: open(0), pick: null, handled: true });
    expect(typeaheadKey(open(-1), "ArrowDown", 3).state).toEqual(open(0));
    expect(typeaheadKey(open(0), "ArrowDown", 3).state).toEqual(open(1));
    expect(typeaheadKey(open(2), "ArrowDown", 3).state).toEqual(open(0));
  });

  it("↑ moves up and round to the last; from a closed list it opens on the last", () => {
    expect(typeaheadKey(open(2), "ArrowUp", 3).state).toEqual(open(1));
    expect(typeaheadKey(open(0), "ArrowUp", 3).state).toEqual(open(2));
    expect(typeaheadKey(open(-1), "ArrowUp", 3).state).toEqual(open(2));
    expect(typeaheadKey(TYPEAHEAD_CLOSED, "ArrowUp", 3).state).toEqual(open(2));
  });

  it("with no suggestions the arrows highlight nothing", () => {
    expect(typeaheadKey(open(1), "ArrowDown", 0).state).toEqual(open(-1));
    expect(typeaheadKey(open(1), "ArrowUp", 0).state).toEqual(open(-1));
  });

  it("Enter picks the highlighted one and closes; with none highlighted it is the form's", () => {
    expect(typeaheadKey(open(1), "Enter", 3)).toEqual({ state: TYPEAHEAD_CLOSED, pick: 1, handled: true });
    expect(typeaheadKey(open(-1), "Enter", 3)).toEqual({ state: open(-1), pick: null, handled: false });
    expect(typeaheadKey(open(4), "Enter", 3).handled).toBe(false);
    expect(typeaheadKey({ open: false, active: 1 }, "Enter", 3).handled).toBe(false);
  });

  it("Esc closes an open list; with it closed, Esc is the page's", () => {
    expect(typeaheadKey(open(1), "Escape", 3)).toEqual({ state: TYPEAHEAD_CLOSED, pick: null, handled: true });
    expect(typeaheadKey(TYPEAHEAD_CLOSED, "Escape", 3).handled).toBe(false);
  });

  it("any other key is left to the field", () => {
    expect(typeaheadKey(open(1), "m", 3)).toEqual({ state: open(1), pick: null, handled: false });
    expect(typeaheadKey(open(1), "Tab", 3).handled).toBe(false);
  });
});

/** A clock the test moves by hand. */
function manualTimers(): DebounceTimers & { advance(ms: number): void; pending(): number } {
  let now = 0;
  let seq = 0;
  const timers = new Map<number, { at: number; fn: () => void }>();
  return {
    set(fn, ms) {
      seq += 1;
      timers.set(seq, { at: now + ms, fn });
      return seq;
    },
    clear(handle) {
      timers.delete(handle as number);
    },
    advance(ms) {
      now += ms;
      for (const [id, t] of [...timers].sort((a, b) => a[1].at - b[1].at)) {
        if (t.at <= now) {
          timers.delete(id);
          t.fn();
        }
      }
    },
    pending: () => timers.size,
  };
}

describe("waiting for the typing to pause (createDebounce)", () => {
  it("typing 'm', 'i' quickly asks once, for 'mi', 120 ms after the last key", () => {
    const clock = manualTimers();
    const asked: string[] = [];
    const d = createDebounce<string>(FROM_BEFORE_DEBOUNCE_MS, (v) => asked.push(v), (v) => v === "", clock);
    d.push("m");
    clock.advance(80);
    d.push("mi");
    clock.advance(FROM_BEFORE_DEBOUNCE_MS - 1);
    expect(asked).toEqual([]);
    clock.advance(1);
    expect(asked).toEqual(["mi"]);
    expect(clock.pending()).toBe(0);
  });

  it("an emptied field asks at once (the most recent), dropping the wait for what was typed before", () => {
    const clock = manualTimers();
    const asked: string[] = [];
    const d = createDebounce<string>(FROM_BEFORE_DEBOUNCE_MS, (v) => asked.push(v), (v) => v === "", clock);
    d.push("mil");
    d.push("");
    expect(asked).toEqual([""]);
    clock.advance(500);
    expect(asked).toEqual([""]);
  });

  it("cancel drops the wait (the field went away)", () => {
    const clock = manualTimers();
    const asked: string[] = [];
    const d = createDebounce<string>(FROM_BEFORE_DEBOUNCE_MS, (v) => asked.push(v), undefined, clock);
    d.push("egg");
    d.cancel();
    clock.advance(1000);
    expect(asked).toEqual([]);
  });
});

// ── The reads, through React Query ────────────────────────────────

interface Call {
  q: string;
  limit: number | undefined;
  signal: AbortSignal | undefined;
  aborted: boolean;
  answer: (items: ItemHistoryEntry[]) => void;
}

function fakeKitchen() {
  const calls: Call[] = [];
  const kitchen = {
    itemHistory: (q = "", query: { limit?: number } = {}, opts: { signal?: AbortSignal } = {}) =>
      new Promise<{ items: ItemHistoryEntry[] }>((resolve, reject) => {
        const call: Call = { q, limit: query.limit, signal: opts.signal, aborted: false, answer: (items) => resolve({ items }) };
        opts.signal?.addEventListener("abort", () => {
          call.aborted = true;
          reject(new DOMException("The operation was aborted.", "AbortError"));
        });
        calls.push(call);
      }),
  };
  return { kitchen, calls };
}

const settle = () => new Promise((r) => setTimeout(r, 5));

describe("the history read as the type-ahead runs it (itemHistoryQuery)", () => {
  const recent = [entry({ name: "Eggs" }), entry({ name: "Milk" })];
  const mi = [entry({ name: "Milk" }), entry({ name: "Mint leaves" })];

  it("is keyed by the typed text, asks for five with React Query's signal, keeps answers five minutes and the last one while the next loads", () => {
    const { kitchen } = fakeKitchen();
    const opts = itemHistoryQuery(kitchen, " Mi ");
    expect(opts.queryKey).toEqual(qk.kitchenItemHistory("mi"));
    expect(opts.queryKey.slice(0, 1)).toEqual(qk.kitchenPantry());
    expect(opts.staleTime).toBe(FROM_BEFORE_STALE_MS);
    expect(opts.placeholderData).toBe(keepPreviousData);
    expect(opts.retry).toBe(false);
    expect(recipesQuery({ recipes: async () => ({ recipes: [] }) }, "Egg").queryKey).toEqual(["kitchenPantry", "recipes", "egg"]);
  });

  it("a text typed past is cancelled, the list keeps the last answer meanwhile, and retyping a prefix answers from the cache", async () => {
    const { kitchen, calls } = fakeKitchen();
    const client = new QueryClient();
    const observer = new QueryObserver(client, itemHistoryQuery(kitchen, ""));
    const unsubscribe = observer.subscribe(() => undefined);
    try {
      await settle();
      expect(calls.map((c) => [c.q, c.limit])).toEqual([["", FROM_BEFORE_LIMIT]]);
      expect(calls[0]!.signal).toBeInstanceOf(AbortSignal);
      calls[0]!.answer(recent);
      await settle();
      expect(observer.getCurrentResult().data).toEqual(recent);

      // "m": asked; the most recent stay on screen while it loads.
      observer.setOptions(itemHistoryQuery(kitchen, "m"));
      await settle();
      expect(calls[1]!.q).toBe("m");
      expect(observer.getCurrentResult()).toMatchObject({ data: recent, isPlaceholderData: true });

      // "mi" before "m" answers: "m" is aborted, nothing it would say ever shows.
      observer.setOptions(itemHistoryQuery(kitchen, "mi"));
      await settle();
      expect(calls[1]!.aborted).toBe(true);
      expect(calls[2]!.q).toBe("mi");
      expect(observer.getCurrentResult()).toMatchObject({ data: recent, isPlaceholderData: true });
      calls[2]!.answer(mi);
      await settle();
      expect(observer.getCurrentResult()).toMatchObject({ data: mi, isPlaceholderData: false });

      // Back to "m" (never answered: asked again), then "mi" again: straight from the cache, no request.
      observer.setOptions(itemHistoryQuery(kitchen, "m"));
      await settle();
      expect(calls).toHaveLength(4);
      calls[3]!.answer([entry({ name: "Mango" }), ...mi]);
      await settle();
      observer.setOptions(itemHistoryQuery(kitchen, "MI"));
      await settle();
      expect(calls).toHaveLength(4);
      expect(observer.getCurrentResult()).toMatchObject({ data: mi, isPlaceholderData: false });
      expect(calls.filter((c) => c.aborted)).toHaveLength(1);
    } finally {
      unsubscribe();
      client.clear();
    }
  });
});

// ── Bought: filling the Add-item form ─────────────────────────────

describe("dates, prices and amounts as the form takes them", () => {
  it("adds days across months, a leap day and the year's end", () => {
    expect(addDays("2026-11-04", 5)).toBe("2026-11-09");
    expect(addDays("2026-01-30", 3)).toBe("2026-02-02");
    expect(addDays("2026-02-27", 3)).toBe("2026-03-02");
    expect(addDays("2028-02-27", 3)).toBe("2028-03-01");
    expect(addDays("2026-12-30", 5)).toBe("2027-01-04");
    expect(addDays("2026-03-31", 0)).toBe("2026-03-31");
    expect(addDays("2026-03-28", 30)).toBe("2026-04-27");
  });

  it("prices and quantities", () => {
    expect(priceInput(6800)).toBe("68");
    expect(priceInput(24950)).toBe("249.50");
    expect(priceInput(5)).toBe("0.05");
    expect(quantityInput(1)).toBe("1");
    expect(quantityInput(0.5)).toBe("0.5");
    expect(quantityInput(1.25)).toBe("1.25");
    expect(quantityInput(0.125)).toBe("0.125");
    expect(quantityInput(250)).toBe("250");
  });
});

describe("picking a name bought before (historyFill)", () => {
  it("fills everything from last time, and the form can be added at once: type 'mi', tap Milk, tap Add", () => {
    const fill = historyFill(entry(), blank(), fillCtx());
    expect(fill.form).toEqual({
      name: "Milk",
      category: "dairy",
      quantity: "1",
      unit: "L",
      price: "68",
      boughtOn: TODAY,
      expiresOn: "2026-11-09",
      pantry: FLAT.orgId,
      paidBy: MEERA,
      waste: "group",
      // A note is never filled from last time (RC-3): what was typed stays.
      note: "",
    });
    expect(fill.pantryFellBack).toBe(false);
    expect(fill.moreUnits).toBe(false);
    const preview = previewItemForm(fill.form, { today: TODAY, currency: "INR", meId: ME });
    expect(preview.errors).toEqual({});
    expect(preview.request).toEqual({
      kind: "group",
      orgId: FLAT.orgId,
      body: { name: "Milk", category: "dairy", quantity: "1", unit: "L", priceMinor: 6800, boughtOn: TODAY, expiresOn: "2026-11-09", paidBy: MEERA },
    });
  });

  it("keeps a note typed before the pick, and sends it (RC-3)", () => {
    const fill = historyFill(entry(), { ...blank(), note: "For Sunday's curry" }, fillCtx());
    expect(fill.form.note).toBe("For Sunday's curry");
    const preview = previewItemForm(fill.form, { today: TODAY, currency: "INR", meId: ME });
    expect(preview.request?.body).toMatchObject({ name: "Milk", note: "For Sunday's curry" });
  });

  it("last time's own waste rule, your own pantry, no use-by", () => {
    expect(historyFill(entry({ wastePolicy: "buyer_absorbs" }), blank(), fillCtx()).form.waste).toBe("buyer_absorbs");
    const own = historyFill(entry({ pantry: { kind: "personal", orgId: null, name: "My pantry" }, paidBy: ME, useByDays: null }), blank(), fillCtx());
    expect(own.form).toMatchObject({ pantry: "personal", paidBy: ME, expiresOn: "" });
    const preview = previewItemForm(own.form, { today: TODAY, currency: "INR", meId: ME });
    expect(preview.request).toEqual({
      kind: "personal",
      body: { name: "Milk", category: "dairy", quantity: "1", unit: "L", priceMinor: 6800, boughtOn: TODAY, currency: "INR" },
    });
  });

  it("the use-by counts from the day bought, across a month's end", () => {
    const form = { ...blank(), boughtOn: "2026-01-29" };
    expect(historyFill(entry({ useByDays: 5 }), form, fillCtx({ today: "2026-01-30" })).form.expiresOn).toBe("2026-02-03");
    expect(historyFill(entry({ useByDays: 14 }), blank(), fillCtx({ today: "2026-12-20" })).form.expiresOn).toBe(addDays(TODAY, 14));
    expect(historyFill(entry({ useByDays: 0 }), blank(), fillCtx()).form.expiresOn).toBe(TODAY);
    // A day bought the form can't read falls back to today.
    expect(historyFill(entry({ useByDays: 3 }), { ...blank(), boughtOn: "" }, fillCtx({ today: "2026-02-27" })).form.expiresOn).toBe("2026-03-02");
  });

  it("a group you only view now, or left: the form's default pantry, the rest kept", () => {
    const lunch = entry({ pantry: { kind: "group", orgId: LUNCH.orgId, name: LUNCH.name }, paidBy: ANU });
    const toOwn = historyFill(lunch, blank(), fillCtx());
    expect(toOwn.pantryFellBack).toBe(true);
    expect(toOwn.form).toMatchObject({ name: "Milk", pantry: "personal", paidBy: ME, quantity: "1", unit: "L", price: "68", expiresOn: "2026-11-09" });

    const toFlat = historyFill(lunch, blank(), fillCtx({ fallbackPantry: FLAT.orgId }));
    expect(toFlat.form).toMatchObject({ pantry: FLAT.orgId, paidBy: ANU, price: "68" });
  });

  it("falling back to a pantry in another currency drops last time's price", () => {
    const trip = entry({ pantry: { kind: "group", orgId: "org_00000000000000000000000000000dead", name: "Old flat" }, currency: "USD", priceMinor: 499 });
    expect(historyFill(trip, blank(), fillCtx()).form.price).toBe("");
    // Goa trip counts in dollars, as last time: the price stays.
    const goa = entry({ pantry: { kind: "group", orgId: TRIP.orgId, name: TRIP.name }, currency: "USD", priceMinor: 499 });
    expect(historyFill(goa, blank(), fillCtx()).form).toMatchObject({ pantry: TRIP.orgId, price: "4.99" });
  });

  it("a cooking measure shows the units behind 'more'; a unit or category the app doesn't know keeps the form's", () => {
    const ghee = historyFill(entry({ name: "Ghee", unit: "tbsp", dimension: "volume", quantity: 2, qtyMilli: 30_000 }), blank(), fillCtx());
    expect(ghee).toMatchObject({ moreUnits: true, form: { unit: "tbsp", quantity: "2" } });
    const odd = historyFill(entry({ unit: "bunch", quantity: 3, category: "herbs" }), { ...blank(), unit: "pcs", quantity: "", category: "" }, fillCtx());
    expect(odd.form).toMatchObject({ unit: "pcs", quantity: "", category: "" });
  });
});

// ── Cook: filling the dish from a recipe ──────────────────────────

const rice = makeItem({ name: "Basmati rice", pantry: groupRef(FLAT), unit: "kg", bought: "5", left: "3.2", priceMinor: 62000, paidBy: ANU });
const eggs = makeItem({ name: "Eggs", pantry: PERSONAL_REF, unit: "pcs", bought: "12", left: "3", priceMinor: 8400, paidBy: ME });
const oil = makeItem({ name: "Cooking oil", pantry: groupRef(FLAT), unit: "L", bought: "1", left: "0.4", priceMinor: 18500, paidBy: ME });
const usedUp = makeItem({ name: "Butter", pantry: PERSONAL_REF, unit: "g", bought: "500", left: "0", priceMinor: 28000, paidBy: ME, state: "used_up" });

function matchOf(item: KitchenItem): RecipeMatch {
  return { itemId: item.id, ref: itemRefParam(itemRefOf(item)), pantry: item.pantry, qtyLeftMilli: item.qtyLeftMilli, canUse: true };
}

function ingredient(name: string, qtyMilli: number, unit: string, dimension: RecipeIngredient["dimension"], match: RecipeMatch | null): RecipeIngredient {
  return { name, qtyMilli, quantity: qtyMilli / 1000, unit, dimension, pantry: null, match };
}

function recipe(patch: Partial<Recipe> = {}): Recipe {
  return {
    name: "Egg fried rice",
    times: 3,
    lastCookedAt: "2026-11-01T13:00:00.000Z",
    portionsHalf: 10,
    extrasMinor: 1000,
    totalMinor: 15600,
    currency: "INR",
    orgId: FLAT.orgId,
    ingredients: [
      ingredient("Basmati rice", 250_000, "g", "mass", matchOf(rice)),
      ingredient("Eggs", 4000, "pcs", "count", matchOf(eggs)),
      ingredient("Cooking oil", 30_000, "ml", "volume", matchOf(oil)),
      ingredient("Spring onions", 1000, "pcs", "count", null),
    ],
    ...patch,
  };
}

function balance(g: { orgId: string; slug: string; name: string }, role: MyGroupBalance["role"], currency = "INR"): MyGroupBalance {
  return { ...g, currency, balanceMinor: 0, role, memberCount: 4 };
}
const GROUPS = [balance(FLAT, "owner"), balance(LUNCH, "viewer"), balance(TRIP, "builder", "USD")];
const usableOf = (...items: KitchenItem[]) => new Map(items.map((i) => [i.id, i] as const));

describe("picking a dish cooked before (recipeFill)", () => {
  it("fills portions, extras, the group and each matched ingredient at last time's amount; one with no match is 'Not in a pantry'", () => {
    const fill = recipeFill(recipe(), { usable: usableOf(rice, eggs, oil), groups: GROUPS });
    expect(fill).toMatchObject({ name: "Egg fried rice", portionsHalf: 10, extrasMinor: 1000, share: FLAT.orgId, pending: [] });
    expect(fill.lines.map((l) => [l.item.name, l.qtyMilli])).toEqual([
      ["Basmati rice", 250_000],
      // Four eggs last time, three left now: all three.
      ["Eggs", 3000],
      ["Cooking oil", 30_000],
    ]);
    expect(fill.missing).toEqual([{ key: "missing:3:spring onions", name: "Spring onions", qtyMilli: 1000, dimension: "count", unit: "pcs" }]);
  });

  it("prices the dish with the form's own pricing, from each matched item", () => {
    const fill = recipeFill(recipe(), { usable: usableOf(rice, eggs, oil), groups: GROUPS });
    const totals = dishTotals({ lines: fill.lines, extrasMinor: fill.extrasMinor, portionsHalf: fill.portionsHalf, meId: ME, currency: "INR" });
    const each = [amountCost(rice, 250_000), amountCost(eggs, 3000), amountCost(oil, 30_000)];
    expect(totals.ingredientsMinor).toBe(each.reduce((a, b) => a + b, 0));
    expect(totals.totalMinor).toBe(totals.ingredientsMinor + 1000);
    expect(cookRequest({ name: fill.name, lines: fill.lines, extrasMinor: 1000, portionsHalf: 10, share: FLAT.orgId, mode: "claims" })).toEqual({
      name: "Egg fried rice",
      orgId: FLAT.orgId,
      portionsHalf: 10,
      extrasMinor: 1000,
      splitMode: "claims",
      ingredients: [
        { itemId: rice.id, quantity: "250", unit: "g" },
        { itemId: eggs.id, quantity: "3", unit: "pcs" },
        { itemId: oil.id, quantity: "30", unit: "ml" },
      ],
    });
  });

  it("who it is for: a group you no longer cook in keeps the form's choice; a dish for its cook alone is just you", () => {
    expect(recipeFill(recipe({ orgId: LUNCH.orgId }), { usable: usableOf(), groups: GROUPS }).share).toBeNull();
    expect(recipeFill(recipe({ orgId: "org_00000000000000000000000000000dead" }), { usable: usableOf(), groups: GROUPS }).share).toBeNull();
    expect(recipeFill(recipe({ orgId: TRIP.orgId }), { usable: usableOf(), groups: GROUPS }).share).toBe(TRIP.orgId);
    expect(recipeFill(recipe({ orgId: null }), { usable: usableOf(), groups: GROUPS }).share).toBe(JUST_ME);
  });

  it("a match the usable-items list doesn't hold is read, not guessed; one with nothing left now is missing", () => {
    const fill = recipeFill(
      recipe({ ingredients: [ingredient("Basmati rice", 250_000, "g", "mass", matchOf(rice)), ingredient("Butter", 20_000, "g", "mass", matchOf(usedUp))] }),
      { usable: usableOf(usedUp), groups: GROUPS },
    );
    expect(fill.lines).toEqual([]);
    expect(fill.pending.map((p) => [p.ingredient.name, p.ref])).toEqual([["Basmati rice", { kind: "group", orgId: FLAT.orgId, itemId: rice.id }]]);
    expect(fill.missing.map((m) => m.name)).toEqual(["Butter"]);
  });

  it("portions stay within 1–100 and two ingredients from one item go in as one", () => {
    const twice = recipe({
      portionsHalf: 500,
      extrasMinor: -5,
      ingredients: [ingredient("Basmati rice", 250_000, "g", "mass", matchOf(rice)), ingredient("Basmati rice", 100_000, "g", "mass", matchOf(rice))],
    });
    const fill = recipeFill(twice, { usable: usableOf(rice), groups: GROUPS });
    expect(fill).toMatchObject({ portionsHalf: 200, extrasMinor: 0 });
    expect(fill.lines.map((l) => l.qtyMilli)).toEqual([350_000]);
  });

  it("an ingredient takes no more than is left, and nothing from an item of another dimension", () => {
    expect(ingredientLine({ qtyMilli: 5_000_000, dimension: "mass" }, rice)?.qtyMilli).toBe(rice.qtyLeftMilli);
    expect(ingredientLine({ qtyMilli: 1000, dimension: "count" }, rice)).toBeNull();
    expect(ingredientLine({ qtyMilli: 1000, dimension: "mass" }, usedUp)).toBeNull();
  });
});

describe("pending ingredients once read (resolvePending)", () => {
  it("from the list, from its own read, gone (missing), or still being read", () => {
    const fill = recipeFill(recipe(), { usable: usableOf(), groups: GROUPS });
    expect(fill.pending).toHaveLength(3);
    const r = resolvePending(fill.pending, { usable: usableOf(rice), read: new Map<string, KitchenItem | null>([[eggs.id, eggs], [oil.id, null]]) });
    expect(r.lines.map((l) => [l.item.name, l.qtyMilli])).toEqual([["Basmati rice", 250_000], ["Eggs", 3000]]);
    expect(r.missing.map((m) => [m.key, m.name])).toEqual([["missing:2:cooking oil", "Cooking oil"]]);
    expect(r.pending).toEqual([]);
    const waiting = resolvePending(fill.pending, { usable: usableOf(), read: new Map() });
    expect(waiting.pending).toHaveLength(3);
    expect(waiting.lines).toEqual([]);
  });
});

describe("picking another dish (mergeRecipeLines)", () => {
  it("replaces what the last pick put in and keeps what the cook added by hand", () => {
    const linked = pantryLine(oil, 50_000);
    const first = mergeRecipeLines([linked], new Set(), [pantryLine(rice, 250_000), pantryLine(oil, 30_000)]);
    // Oil was already in the dish: it keeps its amount and stays the cook's.
    expect(first.lines.map((l) => [l.key, (l as { qtyMilli: number }).qtyMilli])).toEqual([[oil.id, 50_000], [rice.id, 250_000]]);
    expect([...first.keys]).toEqual([rice.id]);
    const second = mergeRecipeLines(first.lines, first.keys, [pantryLine(eggs, 2000)]);
    expect(second.lines.map((l) => l.key)).toEqual([oil.id, eggs.id]);
    expect([...second.keys]).toEqual([eggs.id]);
  });
});

describe("'Not in a pantry · add it'", () => {
  const onions = recipeFill(recipe(), { usable: usableOf(rice, eggs, oil), groups: GROUPS }).missing[0]!;

  it("opens 'Bought it just now?' with its name, in last time's unit", () => {
    expect(missingDraft(onions)).toEqual({ name: "Spring onions", quantity: "", unit: "pcs", price: "" });
    expect(missingDraft({ ...onions, unit: null, dimension: "mass" }).unit).toBe("g");
  });

  it("what is bought for it goes in at last time's amount, and joins the dish", () => {
    const bought = previewNewItem({ name: "spring onions", quantity: "6", unit: "pcs", price: "30" }, "new:1", "INR").line!;
    expect(missingFor(bought, [onions])).toBe(onions);
    const line = newLineFromMissing(bought, onions);
    expect(line).toMatchObject({ kind: "new", qtyMilli: 6000, useMilli: 1000 });
    const lines: DishLine[] = [pantryLine(rice, 250_000), line];
    expect(cookRequest({ name: "Egg fried rice", lines, extrasMinor: 0, portionsHalf: 10, share: JUST_ME, mode: "claims" }).newItems).toEqual([
      { name: "spring onions", category: "other", quantity: "6", unit: "pcs", priceMinor: 3000, useQuantity: "1", useUnit: "pcs" },
    ]);
    // Something else bought is not for it; another dimension takes all of it.
    expect(missingFor({ name: "Coriander" }, [onions])).toBeNull();
    const grams = previewNewItem({ name: "Spring onions", quantity: "100", unit: "g", price: "30" }, "new:2", "INR").line!;
    expect(newLineFromMissing(grams, onions).useMilli).toBe(grams.qtyMilli);
  });
});
