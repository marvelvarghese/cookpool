import type { AiStatus, AiUseProposal, KitchenMeasure, ReachableItem } from "@saas/contracts/kitchen";
import {
  addFormName,
  addItHref,
  logSaidLabel,
  markSentence,
  proposalPick,
  saidEntries,
  saidRowView,
  saidToast,
  sayItError,
  sayItShows,
  sentenceToSend,
  SAY_IT_EXAMPLES,
} from "@web-console-next/components/kitchen/say-it";
import { sendInOrder, undoLastFirst } from "@web-console-next/components/kitchen/log-several";
import { pickStep } from "@web-console-next/components/kitchen/amount-picker";
import { logRequest } from "@web-console-next/components/kitchen/item-use";
import { receiptError } from "@web-console-next/components/kitchen/receipt-run";
import { aiSwitchOn } from "@web-console-next/lib/ai-switches";
import { frameRedirect } from "@web-console-next/lib/features";
import { STATIC_PAGES } from "@web-console-next/lib/static-pages.mjs";
import { backParent } from "@web-console-next/components/kitchen/back";
import { ANU, FLAT, ME, NAMES, PERSONAL_REF, makeItem } from "./kitchen-pantry-fixtures";

// cookpool-ai AI-7 (design §2, the canvas's AiSayIt): where Say what you used
// shows, the sentence marked, the rows and PN-11's amount, Log's writes one
// after another with one Undo, and the refusals.

const GLASS: KitchenMeasure = { id: "msr_glass", one: "glass", many: "glasses", count: 1, amountMilli: 250_000 };
const LOAF: KitchenMeasure = { id: "msr_loaf", one: "loaf", many: "loaves", count: 1, amountMilli: 1_000 };

const status = (o: Partial<AiStatus> & { sayIt?: boolean } = {}): AiStatus => ({
  available: o.available ?? true,
  features: { sayIt: o.sayIt ?? true, receipt: false, import: false, voice: false, swaps: false, ...(o.features ?? {}) },
  budget: o.budget ?? "ok",
  today: o.today ?? { actions: 9, actionsLimit: 50, voiceSeconds: 0, voiceSecondsLimit: 1800, receipts: 2, receiptsLimit: 10 },
});

const milk = (left = "1.5"): ReachableItem => ({ ...makeItem({ name: "Milk", category: "dairy", unit: "L", bought: "2", left, priceMinor: 13600 }), measures: [GLASS] });
const bread = (): ReachableItem => ({ ...makeItem({ name: "Brown bread", category: "grains", unit: "pack", bought: "1", left: "1", priceMinor: 4500 }), measures: [LOAF] });
const eggs = (): ReachableItem => makeItem({ name: "Eggs", category: "protein", unit: "pcs", bought: "12", left: "10", priceMinor: 8400, pantry: PERSONAL_REF });

const line = (item: ReachableItem, o: Partial<AiUseProposal> = {}): AiUseProposal => ({
  itemRef: item.pantry.kind === "group" ? { kind: "group", orgId: item.pantry.orgId, itemId: item.id } : { kind: "personal", itemId: item.id },
  name: item.name,
  pantry: item.pantry,
  quantity: 1,
  consumers: [ME],
  label: "1",
  flags: [],
  ...o,
});

describe("where Say what you used shows", () => {
  it("in the new frame, once AI is available reading sentences, with this device's switch on", () => {
    expect(sayItShows({ isNewFrame: true, status: status(), switchOn: true })).toBe(true);
    expect(sayItShows({ isNewFrame: true, status: status({ available: false }), switchOn: true })).toBe(false);
    expect(sayItShows({ isNewFrame: true, status: status({ sayIt: false }), switchOn: true })).toBe(false);
    expect(sayItShows({ isNewFrame: true, status: status(), switchOn: false })).toBe(false);
    // Loading or failed: hidden.
    expect(sayItShows({ isNewFrame: true, status: null, switchOn: true })).toBe(false);
    expect(sayItShows({ isNewFrame: true, status: undefined, switchOn: true })).toBe(false);
  });

  it("never in today's frame, and today's pages are unchanged", () => {
    expect(sayItShows({ isNewFrame: false, status: status(), switchOn: true })).toBe(false);
    expect(frameRedirect("/you/ai", false)).toBe("/you");
    expect(frameRedirect("/you/ai", true)).toBeNull();
    expect(frameRedirect("/pantry", false)).toBeNull();
    expect(addFormName("jam", false)).toBeNull();
  });

  it("reads the device's switch from AI-8's store: on until turned off", () => {
    expect(aiSwitchOn(null, "sayIt")).toBe(true);
    expect(aiSwitchOn('{"sayIt":false}', "sayIt")).toBe(false);
    expect(aiSwitchOn('{"receipt":false}', "sayIt")).toBe(true);
  });

  it("is a static page under You, back to Settings", () => {
    expect(STATIC_PAGES).toContain("/you/ai");
    expect(backParent("/you/ai", {}, { newFrame: true })).toBe("/you/settings");
  });
});

describe("the sentence", () => {
  it("is sent trimmed and at most 300 characters; blank is nothing to read", () => {
    expect(sentenceToSend("  2 eggs  ")).toBe("2 eggs");
    expect(sentenceToSend("   ")).toBeNull();
    expect(sentenceToSend("x".repeat(400))).toHaveLength(300);
    expect(SAY_IT_EXAMPLES).toEqual(["2 eggs for breakfast", "Anu and I had chai", "The rest of the paneer"]);
  });

  const m = milk();
  const b = bread();
  const text = "Anu and I had 2 glasses of milk and half the bread, and some jam";
  const res = {
    lines: [
      line(m, { quantity: 2, measure: "glass", label: "2 glasses", consumers: [ME, ANU] }),
      line(b, { quantity: 0.5, measure: "loaf", label: "½ loaf", consumers: [ME, ANU] }),
    ],
    unsure: ["jam"],
  };

  it("marks the people, each line with its amount, and the unsure word (the canvas's sentence)", () => {
    const marks = markSentence(text, res, { meId: ME, names: NAMES });
    expect(marks.spans).toEqual([
      { text: "Anu and I", tone: "matched" },
      { text: " had ", tone: "plain" },
      { text: "2 glasses of milk", tone: "matched" },
      { text: " and ", tone: "plain" },
      { text: "half the bread", tone: "matched" },
      { text: ", and some ", tone: "plain" },
      { text: "jam", tone: "unsure" },
    ]);
    expect(marks.spans.map((s) => s.text).join("")).toBe(text);
    expect(marks.heard).toEqual(["2 glasses of milk", "half the bread"]);
  });

  it("finds plurals and 'the rest of', leaves people unmarked for your own pantry, and a line not in the words unheard", () => {
    const e = eggs();
    const marks = markSentence("I had 2 eggs and the rest of the milk", { lines: [line(e, { quantity: 2, unit: "pcs", label: "2 eggs" }), line(m, { flags: ["the_rest"], label: "the rest" })], unsure: [] }, { meId: ME, names: NAMES });
    expect(marks.heard).toEqual(["2 eggs", "the rest of the milk"]);
    expect(marks.spans[0]).toEqual({ text: "I had ", tone: "plain" });
    const none = markSentence("chai", { lines: [line(m)], unsure: [] }, { meId: ME, names: NAMES });
    expect(none.heard).toEqual([null]);
    expect(none.spans).toEqual([{ text: "chai", tone: "plain" }]);
  });
});

describe("a row and its amount (PN-11's control, compact)", () => {
  it("starts in the measure said, else the unit said, else the same amount in the base unit; the rest as The rest", () => {
    const m = milk();
    expect(proposalPick(m, { quantity: 2, measure: "glass", flags: [] })).toMatchObject({ unit: "m:glass", count: 2, rest: false });
    expect(proposalPick(m, { quantity: 250, unit: "ml", flags: [] })).toMatchObject({ unit: "u:ml", count: 250, rest: false });
    expect(proposalPick(m, { quantity: 0.5, unit: "L", flags: [] })).toMatchObject({ unit: "u:L", count: 0.5 });
    const cream = makeItem({ name: "Cream", unit: "ml", bought: "200", left: "150" });
    // L is not one of its chips: the same amount in ml.
    expect(proposalPick(cream, { quantity: 0.1, unit: "L", flags: [] })).toMatchObject({ unit: "u:ml", count: 100 });
    expect(proposalPick(m, { quantity: 1, unit: "L", flags: ["the_rest"] })).toMatchObject({ rest: true });
    expect(proposalPick(milk("0"), { quantity: 1, unit: "L", flags: [] })).toBeNull();
    // A measure the item no longer has: its first chip.
    expect(proposalPick(m, { quantity: 2, measure: "cup", flags: [] })).toMatchObject({ unit: "m:glass" });
  });

  it("shows the name, the amount, its pantry, cost and each share; − and + move the amount and the cost", () => {
    const m = milk();
    const l = line(m, { quantity: 2, measure: "glass", label: "2 glasses", consumers: [ME, ANU] });
    const pick = proposalPick(m, l)!;
    const v = saidRowView(l, m, pick);
    expect(v).toMatchObject({ name: "Milk", amount: "2 glasses", consumers: [ME, ANU], note: null, currency: "INR", canLess: true, canMore: true });
    expect(v.costMinor).toBe(3400);
    expect(v.sub).toBe("Flat 4B · ₹34.00 · ₹17.00 each");
    const more = saidRowView(l, m, pickStep(m, pick, 1));
    expect(more.amount).toBe("3 glasses");
    expect(more.costMinor).toBe(5100);
    const less = saidRowView(l, m, pickStep(m, pick, -1));
    expect(less.amount).toBe("1 glass");
  });

  it("is just you in your own pantry, and says when someone was left out", () => {
    const e = eggs();
    const v = saidRowView(line(e, { quantity: 2, unit: "pcs", label: "2 eggs" }), e, proposalPick(e, { quantity: 2, unit: "pcs", flags: [] })!);
    expect(v).toMatchObject({ name: "Eggs", amount: "2 eggs", consumers: [] });
    expect(v.sub).toBe("Personal · ₹14.00");
    const m = milk();
    const removed = line(m, { quantity: 1, measure: "glass", consumers: [ME], flags: ["people_removed"] });
    expect(saidRowView(removed, m, proposalPick(m, removed)!).note).toBe("Left someone out · not in this group");
  });

  it("Log says how many and what they cost", () => {
    expect(logSaidLabel([{ costMinor: 3400, currency: "INR" }, { costMinor: 2250, currency: "INR" }])).toBe("Log 2 · ₹56.50");
    expect(logSaidLabel([{ costMinor: 3400, currency: "INR" }, { costMinor: 300, currency: "USD" }])).toBe("Log 2 · ₹34.00 and $3.00");
  });
});

describe("Log: the uses one after another, with one Undo", () => {
  const m = milk();
  const e = eggs();
  const ml = line(m, { quantity: 2, measure: "glass", label: "2 glasses", consumers: [ME, ANU] });
  const el = line(e, { quantity: 2, unit: "pcs", label: "2 eggs" });
  const rows = [
    { line: ml, item: m, pick: proposalPick(m, ml)! },
    { line: el, item: e, pick: proposalPick(e, el)! },
  ];

  it("writes each row through the use routes' own body: a measure with who had it, a personal amount without", () => {
    const entries = saidEntries(rows);
    expect(entries.map((x) => [x.name, x.step.words, x.consumers])).toEqual([
      ["Milk", "2 glasses", [ME, ANU]],
      ["Eggs", "2 eggs", []],
    ]);
    const bodies = entries.map((x) => logRequest(x.item, x.step.qtyMilli, x.consumers ?? [], x.step.amount.kind === "measure" ? { measure: x.step.amount.measure, quantity: x.step.amount.quantity } : null));
    expect(bodies).toEqual([
      { quantity: "2", measure: "glass", consumers: [ME, ANU] },
      { quantity: "2", unit: "pcs" },
    ]);
    expect(entries[0]!.ref).toEqual({ kind: "group", orgId: FLAT.orgId, itemId: m.id });
    expect(entries[1]!.ref).toEqual({ kind: "personal", itemId: e.id });
  });

  it("sends the next only once the one before it has answered", async () => {
    const log: string[] = [];
    const release: (() => void)[] = [];
    const send = (name: string) => () =>
      new Promise<string>((resolve) => {
        log.push(`start ${name}`);
        release.push(() => {
          log.push(`done ${name}`);
          resolve(name);
        });
      });
    const answers = sendInOrder([send("milk"), send("eggs"), send("bread")]);
    await Promise.resolve();
    expect(log).toEqual(["start milk"]);
    release[0]!();
    await answers[0];
    await Promise.resolve();
    expect(log).toEqual(["start milk", "done milk", "start eggs"]);
    release[1]!();
    await answers[1];
    await Promise.resolve();
    release[2]!();
    expect(await Promise.all(answers)).toEqual(["milk", "eggs", "bread"]);
    expect(log.filter((l) => l.startsWith("start"))).toEqual(["start milk", "start eggs", "start bread"]);
  });

  it("one Undo puts back every one written, the last first, skipping the refused", async () => {
    const order: number[] = [];
    const out = await undoLastFirst([{ ok: true }, { ok: false }, { ok: true }], (r) => r.ok, async (i) => {
      order.push(i);
      return i !== 0;
    });
    expect(order).toEqual([2, 0]);
    expect(out).toEqual({ undone: [2], refused: [0] });
  });

  it("toasts once: 'Logged 2 · ₹48.00', or which were refused", () => {
    const entries = saidEntries(rows);
    expect(saidToast(entries)).toEqual({ title: "Logged 2 · ₹48.00" });
    expect(saidToast(entries, [entries[1]!])).toEqual({ title: "Logged 1 of 2", description: "Couldn't log Eggs. ₹34.00" });
  });
});

describe("unsure names and the refusals", () => {
  it("Add it opens the add form with the name filled in (new frame)", () => {
    expect(addItHref(" jam ")).toBe("/pantry/new?name=jam");
    expect(addItHref("peanut butter")).toBe("/pantry/new?name=peanut%20butter");
    expect(addFormName("peanut  butter", true)).toBe("Peanut butter");
    expect(addFormName("  ", true)).toBeNull();
    expect(addFormName(null, true)).toBeNull();
    expect(addFormName("x".repeat(90), true)).toHaveLength(60);
  });

  it("maps the budget, no key, today's limit and anything else", () => {
    expect(sayItError({ code: "internal_error", details: { reason: "budget" } }, 503)).toEqual({ kind: "budget", title: "Cookpool AI is resting until the 1st" });
    expect(sayItError({ code: "internal_error", reason: "budget" }, 503).kind).toBe("budget");
    expect(sayItError({ code: "internal_error", reason: "ai_unavailable" }, 503)).toEqual({ kind: "unavailable", title: "AI isn't set up yet · log by hand" });
    expect(sayItError({ code: "internal_error" }, 503).kind).toBe("unavailable");
    expect(sayItError({ code: "rate_limited", reason: "ai_daily_limit" }, 429)).toEqual({ kind: "limit", title: "You've used today's AI · try tomorrow" });
    expect(sayItError({ code: "rate_limited" }, 429).kind).toBe("limit");
    const failed = { kind: "failed", title: "Couldn't read that · try again or log by hand" };
    expect(sayItError({ code: "internal_error", reason: "ai_failed" }, 502)).toEqual(failed);
    expect(sayItError({ code: "network_error", reason: "offline" }, 0)).toEqual(failed);
    expect(sayItError(null)).toEqual(failed);
  });

  it("the receipt scan (AI-8) now knows the budget too: hidden, resting until the 1st", () => {
    expect(receiptError({ code: "internal_error", details: { reason: "budget" } }, 503)).toEqual({ kind: "unavailable", title: "Cookpool AI is resting until the 1st · add by hand" });
    expect(receiptError({ code: "internal_error", reason: "ai_unavailable" }, 503).title).toBe("AI isn't set up yet · add by hand");
  });
});
