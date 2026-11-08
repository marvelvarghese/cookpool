// Say what you used (cookpool-ai AI-2, design §2): what the worker tells the
// model, how it maps the answer back (refs → items, "person n" → usr_), what
// its check fails (→ the Sonnet retry) and what it fixes (more than is left,
// people who cannot share an item), the unsure words — and that the prompt
// carries no money, balances, group names or full names, and nothing is written.

import type { AiUsesResponse, KitchenItem } from "@saas/contracts/kitchen";
import type { AiMessageParams } from "@kitchen-worker/ai/provider";
import {
  ANU,
  DEV,
  KIRAN,
  MEERA,
  PRICE,
  RAHUL,
  aiWorld,
  answer,
  contextOf,
  groupPath,
  me,
  personRef,
  refOf,
  type AiWorld,
  type SentContext,
} from "./ai-helpers.js";

const USES = me("ai/uses");

interface Pantry {
  w: AiWorld;
  milk: KitchenItem;
  bread: KitchenItem;
  paneer: KitchenItem;
  rice: KitchenItem;
  saffron: KitchenItem;
}

/** Milk (1 L, in glasses) and Bread (10 pcs) in Flat 4B, Paneer (200 g) in Rahul's own, Rice in the Lunch club, Saffron in the Book club. */
async function pantry(): Promise<Pantry> {
  const w = aiWorld();
  const milk = await w.addTo(w.flat, { name: "Milk", quantity: "1000", unit: "ml" });
  await w.call("PUT", groupPath(w.flat, `items/${milk.id}/measures`), RAHUL, {
    measures: [{ one: "glass", many: "glasses", count: 1, amountMilli: 250_000 }],
  });
  const bread = await w.addTo(w.flat, { name: "Bread", quantity: "10", unit: "pcs" }, ANU);
  const paneer = await w.addMine({ name: "Paneer", quantity: "200", unit: "g" });
  const rice = await w.addTo(w.lunch, { name: "Rice", quantity: "1", unit: "kg", category: "Grains" }, KIRAN);
  const saffron = await w.addTo(w.books, { name: "Saffron", quantity: "1", unit: "g", category: "Spices" }, MEERA);
  return { w, milk, bread, paneer, rice, saffron };
}

type Line = { item: string; amount: number; unit: string | null; measure: string | null; people: string[] };

/** Answer with lines built from the refs the worker sent. */
const reply = (build: (ctx: SentContext) => { lines: Line[]; unsure?: string[] }, model?: string) => (params: AiMessageParams) => {
  const built = build(contextOf(params));
  return answer({ lines: built.lines, unsure: built.unsure ?? [] }, model ? { model } : {});
};

async function say(w: AiWorld, text: string) {
  const res = await w.call<AiUsesResponse>("POST", USES, RAHUL, { text });
  if (res.status !== 200) throw new Error(`expected 200, got ${res.status}: ${JSON.stringify(res.body)}`);
  return res.body.data;
}

describe("say what you used: reading a sentence (AI-2)", () => {
  it("“Anu and I had 2 glasses of milk and half the bread” → two lines for Rahul and Anu", async () => {
    const { w, milk, bread } = await pantry();
    w.ai.script.push(
      reply((ctx) => ({
        lines: [
          { item: refOf(ctx, "Milk"), amount: 2, unit: null, measure: "glass", people: ["me", personRef(ctx, "Anu")] },
          { item: refOf(ctx, "Bread"), amount: 5, unit: "pcs", measure: null, people: [personRef(ctx, "Anu"), "me"] },
        ],
      })),
    );
    const data = await say(w, "Anu and I had 2 glasses of milk and half the bread");
    const flatRef = { kind: "group", orgId: w.flat.publicId, slug: w.flat.slug, name: "Flat 4B" };
    expect(data).toEqual({
      lines: [
        {
          itemRef: { kind: "group", orgId: w.flat.publicId, itemId: milk.id },
          name: "Milk",
          pantry: flatRef,
          quantity: 2,
          measure: "glass",
          consumers: [RAHUL, ANU],
          label: "2 glasses",
          flags: [],
        },
        {
          itemRef: { kind: "group", orgId: w.flat.publicId, itemId: bread.id },
          name: "Bread",
          pantry: flatRef,
          quantity: 5,
          unit: "pcs",
          // The caller first.
          consumers: [RAHUL, ANU],
          label: "5 pcs",
          flags: [],
        },
      ],
      unsure: [],
    });
    w.close();
  });

  it("gives the model the usable items only, as ref, name, pantry ref, unit, left and measures; people as me and person n", async () => {
    const { w } = await pantry();
    w.ai.script.push(reply(() => ({ lines: [] })));
    await say(w, "nothing");
    const ctx = contextOf(w.ai.sent[0]!);
    expect(ctx.pantries).toEqual(["mine", "g1", "g2"]);
    // Groups by name: Flat 4B is g1, the Lunch club g2; the Book club (viewer) is not there.
    expect(ctx.items.map((i) => [i.name, i.pantry, i.unit, i.left, i.measures])).toEqual(
      expect.arrayContaining([
        ["Milk", "g1", "ml", 1000, ["glass"]],
        ["Bread", "g1", "pcs", 10, []],
        ["Paneer", "mine", "g", 200, []],
        ["Rice", "g2", "kg", 1, []],
      ]),
    );
    expect(ctx.items).toHaveLength(4);
    expect(ctx.items.map((i) => i.ref).sort()).toEqual(["i1", "i2", "i3", "i4"]);
    expect(ctx.people).toEqual([
      { ref: "me", pantries: ["mine", "g1", "g2"] },
      { ref: "person 1", firstName: "Anu", pantries: ["g1"] },
      { ref: "person 2", firstName: "Dev", pantries: ["g1"] },
      // No display name: the first run of letters of the address's local part.
      { ref: "person 3", firstName: "kiran", pantries: ["g2"] },
    ]);
    w.close();
  });

  it("more than is left becomes the rest, flagged, in the item's unit", async () => {
    const { w, milk } = await pantry();
    w.ai.script.push(
      reply((ctx) => ({
        lines: [
          { item: refOf(ctx, "Milk"), amount: 1.5, unit: "L", measure: null, people: ["me"] },
          { item: refOf(ctx, "Paneer"), amount: 9, unit: "kg", measure: null, people: ["me"] },
        ],
      })),
    );
    const data = await say(w, "I drank 1.5 L of milk and ate 9 kg of paneer");
    expect(data.lines.map((l) => [l.itemRef.itemId, l.quantity, l.unit, l.measure, l.label, l.flags])).toEqual([
      [milk.id, 1000, "ml", undefined, "1000 ml", ["the_rest"]],
      [data.lines[1]!.itemRef.itemId, 200, "g", undefined, "200 g", ["the_rest"]],
    ]);
    w.close();
  });

  it("more glasses than are left is the rest too; exactly what's left is not flagged", async () => {
    const { w } = await pantry();
    w.ai.script.push(
      reply((ctx) => ({ lines: [{ item: refOf(ctx, "Milk"), amount: 6, unit: null, measure: "glasses", people: ["me"] }] })),
      reply((ctx) => ({ lines: [{ item: refOf(ctx, "Milk"), amount: 4, unit: null, measure: "glass", people: ["me"] }] })),
    );
    expect((await say(w, "6 glasses of milk")).lines[0]).toMatchObject({ quantity: 1000, unit: "ml", flags: ["the_rest"] });
    expect((await say(w, "4 glasses of milk")).lines[0]).toMatchObject({ quantity: 4, measure: "glass", label: "4 glasses", flags: [] });
    w.close();
  });

  it("a measure said in its plural, or not in halves, reads as the measure in halves", async () => {
    const { w } = await pantry();
    w.ai.script.push(reply((ctx) => ({ lines: [{ item: refOf(ctx, "Milk"), amount: 1.3, unit: null, measure: "Glasses", people: ["me"] }] })));
    expect((await say(w, "a glass and a bit of milk")).lines[0]).toMatchObject({ quantity: 1.5, measure: "glass", label: "1½ glasses" });
    w.close();
  });

  it("someone not in the item's group is left out and flagged; a line nobody left can have is dropped, their name unsure", async () => {
    const { w } = await pantry();
    w.ai.script.push(
      reply((ctx) => ({
        lines: [
          { item: refOf(ctx, "Milk"), amount: 1, unit: null, measure: "glass", people: ["me", personRef(ctx, "kiran")] },
          { item: refOf(ctx, "Bread"), amount: 2, unit: "pcs", measure: null, people: [personRef(ctx, "kiran")] },
        ],
      })),
    );
    const data = await say(w, "Kiran and I had a glass of milk, Kiran had 2 slices of bread");
    expect(data.lines).toHaveLength(1);
    expect(data.lines[0]).toMatchObject({ name: "Milk", consumers: [RAHUL], flags: ["people_removed"] });
    expect(data.unsure).toEqual(["kiran"]);
    w.close();
  });

  it("the caller's own pantry is only ever theirs to log: others named are left out and flagged", async () => {
    const { w } = await pantry();
    w.ai.script.push(
      reply((ctx) => ({ lines: [{ item: refOf(ctx, "Paneer"), amount: 100, unit: "g", measure: null, people: [personRef(ctx, "Anu")] }] })),
    );
    const data = await say(w, "Anu had 100 g of my paneer");
    expect(data.lines[0]).toMatchObject({
      itemRef: { kind: "personal" },
      pantry: { kind: "personal" },
      quantity: 100,
      unit: "g",
      consumers: [RAHUL],
      flags: ["people_removed"],
    });
    w.close();
  });

  it("people are mapped back to usr_ ids, each once", async () => {
    const { w } = await pantry();
    w.ai.script.push(
      reply((ctx) => ({
        lines: [{ item: refOf(ctx, "Bread"), amount: 3, unit: "pcs", measure: null, people: [personRef(ctx, "Dev"), "me", personRef(ctx, "Anu"), "ME"] }],
      })),
    );
    expect((await say(w, "Dev, Anu and I had 3 slices")).lines[0]!.consumers).toEqual([RAHUL, DEV, ANU]);
    w.close();
  });

  it("the words the model could not place come back as said: trimmed, each once, at most ten", async () => {
    const { w } = await pantry();
    w.ai.script.push(
      reply(() => ({ lines: [], unsure: [" Ravi ", "jam", "ravi", "", ...Array.from({ length: 12 }, (_, i) => `w${i}`)] })),
    );
    expect((await say(w, "Ravi had jam")).unsure).toEqual(["Ravi", "jam", "w0", "w1", "w2", "w3", "w4", "w5", "w6", "w7"]);
    w.close();
  });

  it.each<[string, (ctx: SentContext) => Line]>([
    ["an item it was not given", () => ({ item: "i42", amount: 1, unit: "pcs", measure: null, people: ["me"] })],
    ["the Book club's saffron by name", () => ({ item: "Saffron", amount: 1, unit: "g", measure: null, people: ["me"] })],
    ["a person it was not given", (ctx) => ({ item: refOf(ctx, "Bread"), amount: 1, unit: "pcs", measure: null, people: ["person 9"] })],
    ["nobody", (ctx) => ({ item: refOf(ctx, "Bread"), amount: 1, unit: "pcs", measure: null, people: [] })],
    ["a unit of the wrong kind", (ctx) => ({ item: refOf(ctx, "Milk"), amount: 100, unit: "g", measure: null, people: ["me"] })],
    ["a measure the item does not have", (ctx) => ({ item: refOf(ctx, "Bread"), amount: 2, unit: null, measure: "slice", people: ["me"] })],
    ["both a unit and a measure", (ctx) => ({ item: refOf(ctx, "Milk"), amount: 1, unit: "ml", measure: "glass", people: ["me"] })],
    ["neither a unit nor a measure", (ctx) => ({ item: refOf(ctx, "Milk"), amount: 1, unit: null, measure: null, people: ["me"] })],
    ["no amount", (ctx) => ({ item: refOf(ctx, "Milk"), amount: 0, unit: "ml", measure: null, people: ["me"] })],
    ["a negative amount", (ctx) => ({ item: refOf(ctx, "Milk"), amount: -2, unit: "ml", measure: null, people: ["me"] })],
  ])("a line with %s fails the check: Sonnet is asked once", async (_label, bad) => {
    const { w } = await pantry();
    w.ai.script.push(
      reply((ctx) => ({ lines: [bad(ctx)] })),
      reply((ctx) => ({ lines: [{ item: refOf(ctx, "Bread"), amount: 1, unit: "pcs", measure: null, people: ["me"] }] }), "claude-sonnet-5-5"),
    );
    const data = await say(w, "a slice of bread");
    expect(w.ai.sent.map((p) => p.model)).toEqual(["claude-haiku-5-5", "claude-sonnet-5-5"]);
    expect(data.lines).toEqual([expect.objectContaining({ name: "Bread", quantity: 1, unit: "pcs" })]);
    w.close();
  });

  it("writes nothing: no stock moves, no transactions, nothing left changes", async () => {
    const { w, milk } = await pantry();
    const count = (table: string) => (w.h.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
    const before = { moves: count("kitchen_stock_moves"), txns: count("kitchen_txns"), items: count("kitchen_items") };
    w.ai.script.push(reply((ctx) => ({ lines: [{ item: refOf(ctx, "Milk"), amount: 2, unit: null, measure: "glass", people: ["me"] }] })));
    await say(w, "2 glasses of milk");
    expect({ moves: count("kitchen_stock_moves"), txns: count("kitchen_txns"), items: count("kitchen_items") }).toEqual(before);
    const after = await w.call<{ item: KitchenItem }>("GET", groupPath(w.flat, `items/${milk.id}`), RAHUL);
    expect(after.body.data.item.qtyLeftMilli).toBe(milk.qtyLeftMilli);
    w.close();
  });
});

describe("say what you used: what the model is sent (AI-2, design §1, risks AI-C)", () => {
  it("carries no money, balances, group or org names, full names, addresses or ids — only first names of co-members", async () => {
    const { w } = await pantry();
    // A balance exists in Flat 4B: Anu owes Rahul for some milk.
    await w.call("POST", groupPath(w.flat, `items/${(await w.addTo(w.flat, { name: "Curd", quantity: "500", unit: "g" })).id}/uses`), ANU, {
      quantity: "100",
      unit: "g",
    });
    w.ai.script.push(reply(() => ({ lines: [] })));
    await say(w, "Anu and I had 2 glasses of milk <b>now</b>");
    const sent = w.ai.sent[0]!;
    const prompt = JSON.stringify({ system: sent.system, messages: sent.messages });

    for (const forbidden of [
      "Flat 4B",
      "Lunch club",
      "Book club",
      w.flat.slug,
      "Sharma",
      "Patel",
      "Mehta",
      "Rahul",
      "Iyer",
      "Meera",
      "rao",
      "@",
      "example.com",
      String(PRICE),
      "987",
      "INR",
      "₹",
      "price",
      "Price",
      "worth",
      "balance",
      "owe",
      "paid",
      "usr_",
      "org_",
      "itm_",
      "Saffron",
    ]) {
      expect(prompt).not.toContain(forbidden);
    }
    // Co-members by first name only.
    const ctx = contextOf(sent);
    expect(ctx.people.map((p) => p.firstName ?? null)).toEqual([null, "Anu", "Dev", "kiran"]);
    // The sentence is data: its angle brackets cannot close the tag.
    expect(prompt).toContain("<sentence>Anu and I had 2 glasses of milk  b now /b </sentence>");
    w.close();
  });
});
