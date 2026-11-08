import type { AskInboxItem } from "@saas/contracts/kitchen";
import {
  answerRefusal,
  approvalUndo,
  approveRequest,
  approvedText,
  approvingAsk,
  askArrival,
  askCard,
  askCardsShown,
  canApprove,
  declineUndo,
  declinedText,
  parseAskParam,
  withLeft,
  type AnsweredAsk,
} from "@web-console-next/components/kitchen/ask-card";
import {
  addItemLine,
  blankSession,
  cookAskRequest,
  finishPlan,
  includedLines,
  lineAskOf,
  lineAsks,
  progressText,
  sessionLineView,
  setLineAmount,
  setName,
  syncLineAsks,
  tickLine,
  untickedText,
  withLineAsk,
  type CookSession,
} from "@web-console-next/components/kitchen/cook-session";
import { pantryRow } from "@web-console-next/components/kitchen/pantry-list";
import { homeSections } from "@web-console-next/components/kitchen/new-home";
import { ANU, DEV, FLAT, MEERA, NAMES, makeItem, groupRef } from "./kitchen-pantry-fixtures";
import { ASK_NOW, makeAsk, plainSaffron, saffron } from "./kitchen-ask-fixtures";

// cookpool-pantry PN-9 (design §8.3–§8.4): the buyer's card on Home, the
// push's /home?ask=, and a cook session's line that asks.

const ctx = { meId: MEERA, names: NAMES, now: ASK_NOW };

describe("Home's ask card (§8.3)", () => {
  it("says who asks for what, for whom, when, what's left, and the money it moves", () => {
    expect(askCard(makeAsk(), ctx)).toEqual({
      id: "ask_00000000000000000000000000000a01",
      orgId: FLAT.orgId,
      askerId: DEV,
      title: "Dev asks for 1 pinch of saffron",
      sub: "For Dev and Anu · asked 2 min ago · 1.4 g left",
      money: { label: "If you approve", value: "₹12 back to you" },
      always: "Always let Dev use saffron",
      enough: true,
      short: null,
      approve: "Approve",
    });
    expect(askCard(makeAsk({ consumers: [DEV, MEERA], consumerNames: ["Dev", "Meera"], backMinor: 600 }), ctx)).toMatchObject({
      sub: "For Dev and you · asked 2 min ago · 1.4 g left",
      money: { label: "If you approve", value: "₹6 back to you" },
    });
    expect(askCard(makeAsk({ backMinor: 0 }), ctx).money.value).toBe("No money moves");
  });

  it("offers what's left when less is left than was asked", () => {
    const short = makeAsk({ enough: false, item: { ...makeAsk().item, qtyLeftMilli: 30, qtyLeft: 0.03 } });
    expect(askCard(short, ctx)).toMatchObject({ enough: false, short: "Only 0.03 g left", approve: "Approve what's left" });
    expect(canApprove(short)).toBe(true);
    expect(canApprove(makeAsk({ enough: false, item: { ...makeAsk().item, qtyLeftMilli: 0, qtyLeft: 0 } }))).toBe(false);
    // An approval refused for too little left turns the card into that.
    const why = answerRefusal({ reason: "insufficient_stock", message: "x", details: { qtyLeftMilli: 30 } }, makeAsk());
    expect(why).toEqual({ text: "Less is left than was asked.", qtyLeftMilli: 30 });
    expect(askCard(withLeft(makeAsk(), 30), ctx)).toMatchObject({ short: "Only 0.03 g left", approve: "Approve what's left" });
    // Approve what's left reads, at once, as what is left: 0.03 g of the 0.05 g asked, for the rest of the price (the ask's cost already is).
    const taking = approvingAsk(withLeft(makeAsk({ label: null, amount: "0.05 g", costMinor: 720, backMinor: 720 }), 30));
    expect(taking).toMatchObject({ qtyMilli: 30, amount: "0.03 g", label: null, costMinor: 720, backMinor: 720 });
    expect(approvedText(taking, { meId: MEERA, names: NAMES, always: false })).toEqual({ title: "Approved · Dev and Anu owe you ₹7.20", sub: "0.03 g of saffron logged for Dev and Anu" });
    expect(approvingAsk(makeAsk())).toEqual(makeAsk());
  });

  it("sends Always let and what's left only when they're chosen", () => {
    expect(approveRequest(makeAsk(), { always: false })).toEqual({});
    expect(approveRequest(makeAsk(), { always: true })).toEqual({ alwaysAllow: true });
    expect(approveRequest(makeAsk({ enough: false }), { always: false })).toEqual({ takeWhatsLeft: true });
    expect(approveRequest(makeAsk({ enough: false }), { always: true })).toEqual({ alwaysAllow: true, takeWhatsLeft: true });
  });

  it("reads answered, with who owes the buyer", () => {
    const approved = makeAsk({ state: "approved" });
    expect(approvedText(approved, { meId: MEERA, names: NAMES, always: false })).toEqual({
      title: "Approved · Dev and Anu owe you ₹12",
      sub: "1 pinch of saffron logged for Dev and Anu",
    });
    expect(approvedText(approved, { meId: MEERA, names: NAMES, always: true }).sub).toBe("Dev won't need to ask for saffron again");
    expect(approvedText(makeAsk({ consumers: [DEV, MEERA], consumerNames: ["Dev", "Meera"], backMinor: 600 }), { meId: MEERA, names: NAMES, always: false }).title).toBe(
      "Approved · Dev owes you ₹6",
    );
    expect(approvedText(makeAsk({ backMinor: 0 }), { meId: MEERA, names: NAMES, always: false }).title).toBe("Approved · 1 pinch logged");
    expect(declinedText(makeAsk(), { names: NAMES })).toEqual({ title: "Declined · Dev was told", sub: "Nothing was logged" });
  });

  it("undoes an approval by its transaction, else its move, and a decline by reopening", () => {
    const move = { id: "mov_1" } as never;
    expect(approvalUndo(FLAT.orgId, { move, txn: { id: "txn_1" } as never })).toEqual({ kind: "txn", orgId: FLAT.orgId, txnId: "txn_1" });
    expect(approvalUndo(FLAT.orgId, { move, txn: null })).toEqual({ kind: "move", orgId: FLAT.orgId, moveId: "mov_1" });
    expect(declineUndo(makeAsk())).toEqual({ kind: "reopen", orgId: FLAT.orgId, askId: "ask_00000000000000000000000000000a01" });
    expect(answerRefusal({ reason: "lapsed", message: "x" }, makeAsk()).text).toBe("This ask lapsed. Dev can ask again.");
    expect(answerRefusal({ reason: "not_pending", message: "x" }, makeAsk()).text).toBe("Already answered.");
  });

  it("keeps an answered card in its place after the inbox moves on, oldest first", () => {
    const older = makeAsk({ id: "ask_older", createdAt: "2026-11-08T09:00:00.000Z" });
    const newer = makeAsk({ id: "ask_newer", createdAt: "2026-11-08T11:00:00.000Z" });
    const waiting: AskInboxItem[] = [{ kind: "ask", ask: newer }];
    const answered = new Map<string, AnsweredAsk>([["ask_older", { ask: older, answer: "approved", always: false, undo: null }]]);
    const shown = askCardsShown(waiting, answered);
    expect(shown.map((s) => [s.ask.id, s.answered?.answer ?? null])).toEqual([
      ["ask_older", "approved"],
      ["ask_newer", null],
    ]);
    expect(askCardsShown(null, new Map())).toEqual([]);
  });
});

describe("/home?ask= — the push's address", () => {
  it("names an ask, and lands on its card or says it's gone", () => {
    expect(parseAskParam("ask_00000000000000000000000000000a01")).toBe("ask_00000000000000000000000000000a01");
    expect(parseAskParam("javascript:alert(1)")).toBeNull();
    expect(parseAskParam(null)).toBeNull();
    expect(askArrival(null, ["ask_1"])).toBeNull();
    expect(askArrival("ask_1", null)).toBeNull();
    expect(askArrival("ask_1", ["ask_0", "ask_1"])).toBe("card");
    expect(askArrival("ask_1", [])).toBe("gone");
  });
});

describe("A cook session's line that asks (§8.4)", () => {
  const start = (item = saffron()): { s: CookSession; key: string } => {
    const s = addItemLine(blankSession(ASK_NOW), item);
    const key = s.lines[0]!.key;
    return { s: setLineAmount(s, key, 500), key };
  };

  it("reads Ask Meera instead of a tick, and is out of the dish and its count", () => {
    const { s, key } = start();
    const line = s.lines[0]!;
    expect(lineAsks(line)).toBe(true);
    const view = sessionLineView(line, { meId: DEV, names: NAMES, now: ASK_NOW });
    expect(view.ask).toEqual({ state: "ask", who: "Meera", button: "Ask Meera", buttonLabel: "Ask Meera for 0.5 g of Saffron", text: null, cancel: false });
    expect(view.tickable).toBe(false);
    // A tick does nothing, Took them all leaves it out, and the count doesn't wait for it.
    expect(tickLine(s, key)).toEqual(s);
    expect(includedLines(s, "all")).toEqual([]);
    expect(progressText(s)).toBe("0 of 0 in");
    expect(untickedText(s)).toBeNull();
  });

  it("asks for the line's amount, for the cook, from a cook session", () => {
    const { s } = start();
    expect(cookAskRequest(s.lines[0]!, DEV)).toEqual({
      orgId: FLAT.orgId,
      itemId: saffron().id,
      body: { quantity: "0.5", unit: "g", consumers: [DEV], source: "cook" },
      amount: "0.5 g",
    });
  });

  it("waits, then stays out of the dish once approved — even when Dev may now use it", () => {
    const { s, key } = start();
    const asked = withLineAsk(s, key, lineAskOf(makeAsk({ id: "ask_cook1", source: "cook", amount: "0.5 g" })));
    const waiting = sessionLineView(asked.lines[0]!, { meId: DEV, names: NAMES, now: ASK_NOW });
    expect(waiting.ask).toMatchObject({ state: "waiting", text: "Asked Meera · waiting · lapses in 24 h", cancel: true, button: null });
    expect(waiting.canEdit).toBe(false);
    const mine = [makeAsk({ id: "ask_cook1", source: "cook", state: "approved", answeredBy: MEERA, answeredAt: ASK_NOW.toISOString() })];
    const answered = syncLineAsks(asked, mine, ASK_NOW);
    // Always let Dev: the item no longer asks, but the approval was the cook's own use.
    const allowed = { ...answered, lines: answered.lines.map((l) => ({ ...l, takes: l.takes.map((t) => ({ ...t, item: plainSaffron() })) })) };
    expect(sessionLineView(allowed.lines[0]!, { meId: DEV, names: NAMES, now: ASK_NOW }).ask).toMatchObject({ state: "approved", text: "Meera said yes · logged as yours" });
    expect(includedLines(allowed, "all")).toEqual([]);
    expect(syncLineAsks(answered, mine, ASK_NOW)).toBe(answered);
  });

  it("asks again after a no or a lapse, comes off when cancelled, and ticks again once it needn't ask", () => {
    const { s, key } = start();
    const asked = withLineAsk(s, key, lineAskOf(makeAsk({ id: "ask_cook2", source: "cook" })));
    const declined = syncLineAsks(asked, [makeAsk({ id: "ask_cook2", state: "declined", answeredBy: MEERA, answeredAt: ASK_NOW.toISOString() })], ASK_NOW);
    expect(sessionLineView(declined.lines[0]!, { meId: DEV, names: NAMES, now: ASK_NOW }).ask).toMatchObject({ state: "declined", text: "Meera said no", button: "Ask again" });
    const later = new Date("2026-11-09T12:00:00.000Z");
    expect(syncLineAsks(asked, [], later).lines[0]!.ask?.state).toBe("lapsed");
    expect(syncLineAsks(asked, [makeAsk({ id: "ask_cook2", state: "canceled" })], ASK_NOW).lines[0]!.ask).toBeUndefined();
    // The setting turned off after a no: the line is a tick again.
    const off = { ...declined, lines: declined.lines.map((l) => ({ ...l, takes: l.takes.map((t) => ({ ...t, item: plainSaffron() })) })) };
    expect(lineAsks(off.lines[0]!)).toBe(false);
    expect(sessionLineView(off.lines[0]!, { meId: DEV, names: NAMES, now: ASK_NOW }).ask).toMatchObject({ state: "declined", button: null });
    expect(includedLines(tickLine(off, key), "out")).toHaveLength(1);
  });

  it("never sends an asking line in the dish write", () => {
    const onions = makeItem({ name: "Onions", pantry: groupRef(FLAT), unit: "kg", bought: "2", priceMinor: 8_000, paidBy: MEERA });
    const { s } = start();
    const both = setName(addItemLine(s, onions), "Saffron rice");
    const r = finishPlan(both, { unticked: "all", postTo: FLAT.orgId, halves: { [DEV]: 2 }, roster: [MEERA, DEV, ANU], meId: DEV, save: false }, {
      groups: [{ orgId: FLAT.orgId, slug: FLAT.slug, name: FLAT.name, currency: "INR", role: "member", netMinor: 0, memberCount: 3 } as never],
    });
    expect(r.ok && r.plan.request.ingredients?.map((i) => i.itemId)).toEqual([onions.id]);
  });
});

describe("With newFrame false nothing changes", () => {
  it("rows, Home, the session and the stock check read as before for items that don't ask", () => {
    // Today's Pantry never passes askName: an ask-first item's row is an ordinary row.
    expect(pantryRow(saffron(), { usual: null, showPantry: false, meId: DEV, names: NAMES }).variant).toBe("use");
    expect(homeSections(false)).toEqual(["greeting", "install", "money", "quick-use", "todo", "recent"]);
    const { lines } = addItemLine(blankSession(ASK_NOW), plainSaffron());
    const view = sessionLineView(lines[0]!, { meId: DEV, names: NAMES });
    expect(view.ask).toBeNull();
    expect(view.tickable).toBe(true);
  });
});
