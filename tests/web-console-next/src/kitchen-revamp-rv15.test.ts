import { readFileSync } from "node:fs";
import { cwd } from "node:process";
import type { InboxDish, InboxItem, KitchenMeasure, KitchenDish } from "@saas/contracts/kitchen";
import {
  NEEDS_RANK,
  askAnsweredMeta,
  askRowText,
  cancelledMeta,
  claimedMeta,
  foodButton,
  mineRowText,
  needsCount,
  needsTodo,
  needsTodos,
  orderNeeds,
  paidMeta,
  usedMeta,
  waitingMine,
} from "@web-console-next/components/kitchen/inbox-needs";
import { NEW_HOME_SECTIONS, TODAY_HOME_SECTIONS } from "@web-console-next/components/kitchen/new-home";
import { cookNowTag, groupsCookedMeta, youPaid } from "@web-console-next/components/kitchen/new-home-look";
import { historyFace, itemSubtitle, quickPicks, ringLines } from "@web-console-next/components/kitchen/item-page";
import { runOutEstimate } from "@web-console-next/components/kitchen/item-use";
import type { AmountPick } from "@web-console-next/components/kitchen/amount-picker";
import { ANU, DEV, FLAT, ME, MEERA, NAMES, PERSONAL_REF, makeItem, makeMove } from "./kitchen-pantry-fixtures";
import { ASK_NOW, makeAsk } from "./kitchen-ask-fixtures";

// cookpool-revamp RV-15: Home and the item page match the approved boards
// (HomeRevamp, RvItem) and the owner's decisions of 13 Nov.

const SRC = `${cwd()}/../../apps/web-console-next/src`;
const kitchen = (f: string) => readFileSync(`${SRC}/components/kitchen/${f}`, "utf8");
const app = (f: string) => readFileSync(`${SRC}/app/(kitchen)/${f}`, "utf8");

const NOW = new Date(2026, 10, 8, 12, 0);
const ctx = { meId: ME, names: NAMES, now: NOW };

function dish(id: string, patch: Partial<InboxDish> = {}): InboxDish {
  return {
    id,
    name: "Egg fried rice",
    cook: MEERA,
    cookName: "Meera",
    orgId: FLAT.orgId,
    groupName: FLAT.name,
    groupSlug: FLAT.slug,
    state: "open",
    splitMode: "claims",
    portionsHalf: 8,
    claimedHalf: 2,
    unclaimedHalf: 6,
    totalMinor: 24800,
    perPortionMinor: 3100,
    currency: "INR",
    cookedAt: "2026-11-08T10:00:00.000Z",
    ...patch,
  };
}

const food = (days: number): InboxItem =>
  ({
    kind: "use_soon",
    item: { id: "itm_y", ref: "me:itm_y", name: "Greek yogurt", unit: "g", qtyLeftMilli: 100_000, expiresOn: "2026-11-07", daysToUseBy: days, pantry: { kind: "personal", name: "My pantry" } },
    usual: null,
  }) as unknown as InboxItem;

const pay: InboxItem = {
  kind: "payment_due",
  orgId: FLAT.orgId,
  groupSlug: FLAT.slug,
  groupName: FLAT.name,
  toSubjectId: DEV,
  toName: "Dev",
  amountMinor: 2500,
  currency: "INR",
  canRecord: true,
} as InboxItem;

const flag = {
  kind: "flag",
  flagId: "flg_1",
  flaggedBy: DEV,
  flaggedByName: "Dev",
  title: "Groceries",
  reason: "Charged twice",
  txnId: "txn_1",
  txnKind: "expense",
  dishId: null,
  groupSlug: FLAT.slug,
  groupName: FLAT.name,
  totalMinor: 42000,
  currency: "INR",
  flaggedAt: "2026-11-08T09:00:00.000Z",
} as unknown as InboxItem;

describe("Home's order (the board)", () => {
  it("puts the install card under the quick actions, before Needs you; prod's Home is as it was", () => {
    expect([...NEW_HOME_SECTIONS]).toEqual(["greeting", "quick-actions", "install", "todo", "cook-tonight"]);
    expect([...TODAY_HOME_SECTIONS]).toEqual(["greeting", "install", "money", "quick-use", "todo", "recent"]);
  });

  it("has the quick actions in place of the field (HM-2), no usual chips, and keeps Install restyled", () => {
    const home = kitchen("new-home-ui.tsx");
    expect(home).toContain("<HomeQuickActions />");
    expect(home).not.toContain("<HomeUseField />");
    expect(home).not.toContain("<QuickUse");
    expect(home).toContain("<InstallCard fresh />");
    const field = kitchen("quick-use-ui.tsx");
    const fresh = field.slice(field.indexOf("export function HomeUseField"));
    expect(fresh).not.toMatch(/SayIt|useUsuals|doItAgainRows/);
    // Prod's Home keeps its field, usuals and Say it.
    expect(app("home/page.tsx")).toContain("<QuickUse meId={meId} />");
  });
});

describe("Needs you's rows (every kind, the board's words)", () => {
  it("says an open dish as who cooked and a portion's price, in whole rupees when whole", () => {
    expect(needsTodo({ kind: "claim_dish", dish: dish("dsh_a") }, ctx)).toMatchObject({
      kind: "claim",
      title: "Egg fried rice",
      meta: "Meera cooked · ₹31 a portion",
      faceId: MEERA,
      perPortion: { minor: 3100, currency: "INR" },
    });
    expect(needsTodo({ kind: "claim_dish", dish: dish("dsh_b", { perPortionMinor: 3120 }) }, ctx)!.meta).toBe("Meera cooked · ₹31.20 a portion");
  });

  it("says a payment as Pay X and what you owe, with their face", () => {
    expect(needsTodo(pay, ctx)).toMatchObject({ kind: "pay", title: "Pay Dev", meta: "₹25 you owe", tone: "owe", faceId: DEV });
  });

  it("says food by when it is due, and its button is Used once it is past its date", () => {
    expect(needsTodo(food(-1), ctx)).toMatchObject({ kind: "food", title: "Greek yogurt", meta: "Expired", tone: "expired", icon: "expired" });
    expect(needsTodo(food(2), ctx)).toMatchObject({ meta: "2 days", tone: "soon" });
    expect(foodButton("expired", "100 g")).toBe("Used");
    expect(foodButton("soon", "1 cup")).toBe("1 cup");
  });

  it("says your dish to split, and a flag with what it says and its total", () => {
    const draft = dish("dsh_mine", { cook: ME, cookName: null, state: "draft", splitMode: "assign", name: "Dal tadka", totalMinor: 18000 });
    expect(needsTodo({ kind: "finalize_dish", dish: draft }, ctx)).toMatchObject({ kind: "split", title: "Split your Dal tadka", meta: "Who had how much · ₹180", action: { kind: "split", label: "Set portions" } });
    expect(needsTodo(flag, ctx)).toMatchObject({ kind: "flag", title: "Dev flagged Groceries", meta: "“Charged twice” · ₹420" });
  });

  it("keeps the board's order: asks, dishes, money, food, splits, your asks, flags", () => {
    expect(Object.entries(NEEDS_RANK).sort((a, b) => a[1] - b[1]).map(([k]) => k)).toEqual(["ask", "claim", "pay", "food", "split", "mine", "flag"]);
    const rows = needsTodos([flag, food(-1), pay, { kind: "claim_dish", dish: dish("dsh_a") }], ctx).map((t, i) => ({ key: t.key, rank: NEEDS_RANK[t.kind], seq: i }));
    const ask = { key: "ask:1", rank: NEEDS_RANK.ask, seq: 0 };
    const mine = { key: "mine:1", rank: NEEDS_RANK.mine, seq: 0 };
    expect(orderNeeds([...rows, mine, ask]).map((r) => r.key)).toEqual(["ask:1", "claim_dish:dsh_a", `payment_due:${FLAT.orgId}:${DEV}`, "use_soon:itm_y", "mine:1", "flag:flg_1"]);
  });

  it("counts what is left, says all done once every row is done, and is gone with no rows", () => {
    expect(needsCount([{ done: false }, { done: true }, { done: false }])).toBe("· 2");
    expect(needsCount([{ done: true }])).toBe("· all done");
    expect(needsCount([])).toBeNull();
  });

  it("says what was done, dimmed with Undo", () => {
    expect(claimedMeta(3120, "INR", 2)).toBe("You had 1 · ₹31.20");
    expect(claimedMeta(3100, "INR", 3)).toBe("You had 1½ · ₹46.50");
    expect(paidMeta(2500, "INR", "UPI")).toBe("Paid ₹25 · UPI");
    expect(usedMeta("100 g")).toBe("Used · 100 g");
  });
});

describe("asks as rows", () => {
  const actx = { meId: MEERA, names: NAMES };

  it("reads 'Dev asks for Saffron' with the amount, who it is for and the money back", () => {
    expect(askRowText(makeAsk(), actx)).toEqual({
      title: "Dev asks for Saffron",
      meta: "1 pinch for Dev and Anu · ₹12 back to you",
      tone: "owed",
      allow: "Allow",
      always: "Always let Dev use saffron",
    });
    expect(askRowText(makeAsk({ consumers: [DEV], consumerNames: ["Dev"] }), actx).meta).toBe("1 pinch · ₹12 back to you");
    const short = makeAsk({ enough: false, item: { ...makeAsk().item, qtyLeftMilli: 30, qtyLeft: 0.03 } });
    expect(askRowText(short, actx)).toMatchObject({ meta: "1 pinch for Dev and Anu · Only 0.03 g left", tone: "soon", allow: "Allow what's left" });
  });

  it("says an answer as Allowed or Said no", () => {
    expect(askAnsweredMeta({ ask: makeAsk(), answer: "approved", always: false, undo: null }, actx)).toBe("Allowed · Dev and Anu owe you ₹12");
    expect(askAnsweredMeta({ ask: makeAsk(), answer: "declined", always: false, undo: null }, actx)).toBe("Said no · Dev was told");
  });

  it("lists your own asks that wait, with how long they have", () => {
    const mine = makeAsk({ asker: ME, askerName: "Rahul" });
    expect(mineRowText(mine, { names: NAMES, now: ASK_NOW })).toEqual({ title: "Asked Meera for saffron", meta: "1 pinch · waiting · 24 h left", tone: "soon" });
    expect(cancelledMeta(mine, NAMES)).toBe("Cancelled · Meera was told");
    const ids = waitingMine([mine, makeAsk({ id: "ask_x", state: "approved" }), makeAsk({ id: "pending_1" })]).map((a) => a.id);
    expect(ids).toEqual([mine.id]);
  });
});

describe("Cook now and Your groups cooked", () => {
  const entry = (minutes: number | null) => ({ match: { missing: 0, missingNames: [], lines: 4 }, recipe: { minutes } }) as unknown as Parameters<typeof cookNowTag>[0];

  it("tags a makeable recipe 'Have all · 30 min'", () => {
    expect(cookNowTag(entry(30))).toEqual({ text: "Have all · 30 min", tone: "have" });
    expect(cookNowTag(entry(null))).toEqual({ text: "Have all", tone: "have" });
  });

  it("says what you paid: 'Anu · you had 1 · ₹54'", () => {
    const card = { groupName: "Flat 4B", when: "3 h ago", each: "₹31.20", youHad: "1" };
    expect(groupsCookedMeta(card, "Anu", "₹54")).toBe("Anu · you had 1 · ₹54");
    expect(groupsCookedMeta(card, "Anu")).toBe("Anu · you had 1 · ₹31.20 each");
    const d = (id: string, owed: number) => ({ id, currency: "INR", amounts: [{ subjectId: ME, portionsHalf: 2, exactMinor: null, owedMinor: owed }] }) as unknown as KitchenDish;
    const paid = youPaid([d("dsh_1", 5400), d("dsh_2", 3120), d("dsh_3", 0)], ME);
    expect([...paid.entries()]).toEqual([["dsh_1", "₹54"], ["dsh_2", "₹31.20"]]);
    expect(youPaid([d("dsh_1", 5400)], null).size).toBe(0);
  });
});

describe("the item page (RvItem)", () => {
  const GLASS: KitchenMeasure = { id: "msr_glass", one: "glass", many: "glasses", count: 1, amountMilli: 250_000 };
  const milk = (left = "1", o: Parameters<typeof makeItem>[0] = {}) => ({
    ...makeItem({ name: "Milk", category: "dairy", unit: "L", bought: "2", left, priceMinor: 6800, paidBy: MEERA, ...o }),
    measures: [GLASS],
  });
  const glass = (count: number): AmountPick => ({ unit: "m:glass", count, rest: false, how: "suggested" });

  it("says where it is and who paid what under the name", () => {
    expect(itemSubtitle(milk(), { meId: ME, names: NAMES })).toBe("Flat 4B · Meera paid ₹68");
    expect(itemSubtitle(milk("1", { pantry: PERSONAL_REF, paidBy: ME }), { meId: ME, names: NAMES })).toBe("Me · You paid ₹68");
    expect(itemSubtitle(milk("0", { priceMinor: 0 }), { meId: ME, names: NAMES, state: "Used up" })).toBe("Flat 4B · Used up");
  });

  it("puts two lines in the ring card: '1 L of 2 L' and '₹34 left'", () => {
    expect(ringLines(makeItem({ name: "Milk", unit: "L", bought: "2", left: "1", priceMinor: 6800 }))).toEqual({ left: "1 L of 2 L", worth: "₹34 left" });
    expect(ringLines(makeItem({ unit: "L", bought: "2", left: "1", priceMinor: 0 })).worth).toBeNull();
  });

  it("offers ½ glass, 1 glass (the usual) and 2 glasses, then More", () => {
    expect(quickPicks(milk(), glass(1)).map((q) => [q.label, q.usual])).toEqual([["½ glass", false], ["1 glass", true], ["2 glasses", false]]);
    // Twice the usual reaching what is left is The rest.
    expect(quickPicks(milk("0.4"), glass(1)).map((q) => q.label)).toEqual(["½ glass", "1 glass", "The rest"]);
    expect(quickPicks(milk(), { unit: "m:glass", count: 0, rest: true, how: "suggested" }).map((q) => q.label)).toEqual(["The rest"]);
    expect(quickPicks(milk("0"), glass(1))).toEqual([]);
    expect(quickPicks(milk(), null)).toEqual([]);
  });

  it("says 'Runs out Sat'", () => {
    const at = new Date("2026-11-02T12:00:00Z");
    const use = (ml: number) => makeMove({ kind: "use", qtyMilli: ml * 1000, quantity: ml, unit: "ml", costMinor: 0, actor: ME, consumers: [ME] });
    expect(runOutEstimate([use(250), use(250)], milk("1", { boughtOn: "2026-10-31" }), at)!.short).toBe("Runs out Sat");
  });

  it("starts a history row with who had it, else who did it, and the purchase with who added it", () => {
    const item = { createdBy: ANU };
    expect(historyFace({ kind: "use", actor: ME, consumers: [MEERA, ME] }, item)).toBe(MEERA);
    expect(historyFace({ kind: "use", actor: ME, consumers: null }, item)).toBe(ME);
    expect(historyFace({ kind: "waste", actor: DEV, consumers: null }, item)).toBe(DEV);
    expect(historyFace(undefined, item)).toBe(ANU);
  });

  it("wastes at once with Undo, says Got more, and keeps Fix how much is left and Cook with it", () => {
    const parts = kitchen("item-page-ui.tsx");
    const actions = parts.slice(parts.indexOf("export function ItemActionsRow"));
    expect(actions).not.toContain("WasteConfirm");
    expect(actions).toContain("Got more");
    expect(actions).not.toMatch(/>\s*Bought again/);
    expect(actions).toContain("Fix how much is left");
    expect(actions).toContain("Cook with it");
  });
});

describe("tokens and weights", () => {
  const files = ["inbox-needs-ui.tsx", "inbox-needs-rows-ui.tsx", "inbox-row-ui.tsx", "ask-card-ui.tsx", "ask-ui.tsx", "amount-picker-ui.tsx", "item-actions-ui.tsx", "item-page-ui.tsx", "new-home-ui.tsx", "new-home-parts-ui.tsx"];
  it.each(files)("%s has no raw hex and no weight over 500", (f) => {
    const src = kitchen(f);
    expect(src).not.toMatch(/#[0-9A-Fa-f]{6}\b/);
    expect(src).not.toMatch(/font-(semibold|bold|extrabold)/);
  });

  it("puts the item page's old-frame bar on --cp-bottom-bar", () => {
    expect(app("pantry/[itemRef]/page.tsx")).toContain("bottom-[var(--cp-bottom-bar,calc(env(safe-area-inset-bottom)+5.75rem))]");
  });
});
