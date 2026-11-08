import type { AsksResponse } from "@saas/contracts/kitchen";
import {
  NEW_ASK_DRAFT,
  addItemAskFields,
  allowedChips,
  answererOf,
  askDraftOf,
  askExplainer,
  askFirstRefusalFields,
  askItemPatches,
  askModes,
  askName,
  askRequest,
  askRowEnd,
  askSavedText,
  askSettingBody,
  askStatus,
  canSetAsk,
  itemWords,
  lapsesIn,
  showsAddItemAsk,
  withAskChanged,
  withMineAsk,
} from "@web-console-next/components/kitchen/ask-before-use";
import { pantryRow } from "@web-console-next/components/kitchen/pantry-list";
import { historyRows, logRefusal } from "@web-console-next/components/kitchen/item-use";
import { checkAskNote, checkOptions, defaultGone } from "@web-console-next/components/kitchen/stock-check";
import { ANU, DEV, FLAT, KIRAN, MEERA, NAMES, PERSONAL_REF, makeMove } from "./kitchen-pantry-fixtures";
import { ASK_NOW, makeAsk, plainSaffron, saffron } from "./kitchen-ask-fixtures";

// cookpool-pantry PN-9 (design §8.1–§8.2): Who can use it, and the row of
// someone who must ask the buyer before using a guarded item.

const ROSTER = [MEERA, DEV, ANU];
const HOUR = 3_600_000;

describe("Who can use it: who sees it (§8.1)", () => {
  it("shows to the buyer only while she is in the group", () => {
    const item = saffron();
    expect(canSetAsk(item, { meId: MEERA, role: "member", roster: ROSTER })).toBe(true);
    expect(canSetAsk(item, { meId: DEV, role: "member", roster: ROSTER })).toBe(false);
    // An owner or admin doesn't, while the buyer is a member…
    expect(canSetAsk(item, { meId: DEV, role: "admin", roster: ROSTER })).toBe(false);
    // …but does once she has left (the server's answerer is null).
    const left = saffron({ answerer: null });
    expect(canSetAsk(left, { meId: DEV, role: "admin", roster: [DEV, ANU] })).toBe(true);
    expect(canSetAsk(left, { meId: ANU, role: "member", roster: [DEV, ANU] })).toBe(false);
  });

  it("works on an item that doesn't ask yet, from its buyer and the roster", () => {
    const plain = plainSaffron();
    expect(answererOf(plain, ROSTER)).toBe(MEERA);
    expect(answererOf(plain, [DEV, ANU])).toBeNull();
    expect(canSetAsk(plain, { meId: MEERA, role: "member", roster: null })).toBe(true);
    expect(canSetAsk(plain, { meId: DEV, role: "owner", roster: [DEV, ANU] })).toBe(true);
  });

  it("never shows on your own pantry's item, or one that's finished", () => {
    expect(canSetAsk(saffron({ pantry: PERSONAL_REF, paidBy: MEERA }), { meId: MEERA, role: null, roster: null })).toBe(false);
    expect(canSetAsk(saffron({ state: "used_up" }), { meId: MEERA, role: "member", roster: ROSTER })).toBe(false);
  });
});

describe("Who can use it: the choices, the chips and the lines", () => {
  it("offers Anyone in the group and Ask me first", () => {
    expect(askModes("Flat 4B", "ask")).toEqual([
      { id: "anyone", title: "Anyone in Flat 4B", sub: "Use it like everything else", on: false },
      { id: "ask", title: "Ask me first", sub: "You approve each use", on: true },
    ]);
    expect(askDraftOf(saffron({ allowed: [ANU, ANU] }))).toEqual({ mode: "ask", allowed: [ANU] });
    expect(askDraftOf(saffron({ askFirst: false }))).toEqual({ mode: "anyone", allowed: [] });
  });

  it("lists who never needs to ask with ×, and everyone else with +, never the buyer", () => {
    const chips = allowedChips({ mode: "ask", allowed: [ANU, KIRAN] }, { roster: ROSTER, answerer: MEERA, meId: MEERA, names: NAMES });
    // Kiran left the group: off the list.
    expect(chips.allowed).toEqual([{ id: ANU, name: "Anu", label: "Remove Anu" }]);
    expect(chips.others).toEqual([{ id: DEV, name: "Dev", label: "Let Dev use it without asking" }]);
  });

  it("says what it does in three lines", () => {
    expect(askExplainer("Meera")).toEqual([
      "Others see Ask Meera instead of Use.",
      "Nothing comes off and no money moves until you approve.",
      "You get a push. An ask lapses after 24 h.",
    ]);
    expect(askSavedText({ mode: "ask" })).toBe("Saved · others ask you first");
    expect(askSavedText({ mode: "anyone" })).toBe("Saved · anyone can use it");
  });
});

describe("Who can use it: what Save sends", () => {
  const ctx = { roster: ROSTER, meId: MEERA };

  it("turns it on with the list, members only and never the buyer", () => {
    const plain = plainSaffron();
    expect(askSettingBody({ mode: "ask", allowed: [ANU, KIRAN, MEERA] }, plain, ctx)).toEqual({ askFirst: true, allowed: [ANU] });
    expect(askSettingBody({ mode: "ask", allowed: [] }, plain, ctx)).toEqual({ askFirst: true, allowed: [] });
  });

  it("changes the list, turns it off, and sends nothing when nothing changed", () => {
    const on = saffron({ allowed: [ANU] });
    expect(askSettingBody({ mode: "ask", allowed: [ANU] }, on, ctx)).toBeNull();
    expect(askSettingBody({ mode: "ask", allowed: [ANU, DEV] }, on, ctx)).toEqual({ askFirst: true, allowed: [ANU, DEV] });
    expect(askSettingBody({ mode: "anyone", allowed: [ANU] }, on, ctx)).toEqual({ askFirst: false });
    expect(askSettingBody({ mode: "anyone", allowed: [] }, saffron({ askFirst: false }), ctx)).toBeNull();
  });

  it("asks on Add item only for a group item you pay for, and sends the setting with the create", () => {
    expect(showsAddItemAsk({ group: true, paidBy: MEERA, meId: MEERA })).toBe(true);
    expect(showsAddItemAsk({ group: true, paidBy: ANU, meId: MEERA })).toBe(false);
    expect(showsAddItemAsk({ group: false, paidBy: MEERA, meId: MEERA })).toBe(false);
    const draft = { mode: "ask" as const, allowed: [ANU, KIRAN] };
    expect(addItemAskFields(draft, { group: true, paidBy: MEERA, meId: MEERA, roster: ROSTER })).toEqual({ askFirst: true, allowed: [ANU] });
    expect(addItemAskFields(draft, { group: true, paidBy: ANU, meId: MEERA, roster: ROSTER })).toEqual({});
    expect(addItemAskFields(NEW_ASK_DRAFT, { group: true, paidBy: MEERA, meId: MEERA, roster: ROSTER })).toEqual({});
  });
});

describe("The row of someone who must ask (§8.2)", () => {
  it("names whom to ask: the buyer's first name, or an admin once she has left", () => {
    expect(askName(saffron(), { names: NAMES })).toBe("Meera");
    expect(askName(saffron({ answerer: null }), { names: NAMES })).toBe("an admin");
    expect(askName(saffron({ mustAsk: false }), { names: NAMES })).toBeNull();
    expect(itemWords("Saffron")).toBe("saffron");
    expect(itemWords("MDH masala")).toBe("MDH masala");
  });

  it("is PN-5's ask variant: the lock tag, no log chip, and Ask Meera at the end", () => {
    const item = saffron();
    const row = pantryRow(item, { usual: null, showPantry: false, meId: DEV, names: NAMES, askName: askName(item, { names: NAMES }) });
    expect(row.variant).toBe("ask");
    expect(row.tag).toEqual({ label: "Ask Meera", tone: "ask" });
    expect(row.chip).toBeNull();
    const end = askRowEnd(row, null, { askName: "Meera", meId: DEV, names: NAMES });
    expect(end).toMatchObject({ kind: "ask", words: "Ask Meera", consumers: [DEV] });
    expect(end?.kind === "ask" && end.label).toBe(`Ask Meera for ${row.ladder.suggestion!.step.words} of Saffron for you`);
  });

  it("ends in Cancel while its ask waits — once the server has it", () => {
    const item = saffron();
    const row = pantryRow(item, { usual: null, showPantry: false, meId: DEV, names: NAMES, askName: "Meera" });
    const waiting = askStatus(item.id, [makeAsk({ asker: DEV })], { now: ASK_NOW, names: NAMES });
    expect(askRowEnd(row, waiting, { askName: "Meera", meId: DEV, names: NAMES })).toMatchObject({ kind: "cancel", label: "Cancel the ask for Saffron" });
    const sending = askStatus(item.id, [makeAsk({ id: "pending_ask_x1" })], { now: ASK_NOW, names: NAMES });
    expect(sending?.cancel).toBe(false);
    expect(askRowEnd(row, sending, { askName: "Meera", meId: DEV, names: NAMES })).toBeNull();
    // A row that just uses keeps PN-5's chip.
    const plain = pantryRow(saffron({ mustAsk: false }), { usual: null, showPantry: false, meId: DEV, names: NAMES });
    expect(askRowEnd(plain, null, { askName: null, meId: DEV, names: NAMES })).toBeNull();
  });
});

describe("An ask as the row says it", () => {
  const id = saffron().id;
  const status = (asks: Parameters<typeof askStatus>[1], now = ASK_NOW) => askStatus(id, asks, { now, names: NAMES });

  it("waits, and counts down to its lapse", () => {
    expect(status([makeAsk()])).toMatchObject({ phase: "waiting", title: "Asked Meera · 1 pinch", sub: "Waiting · lapses in 24 h", text: "Asked Meera · 1 pinch · waiting · lapses in 24 h", cancel: true });
    expect(status([makeAsk()], new Date(ASK_NOW.getTime() + HOUR))?.text).toBe("Asked Meera · 1 pinch · waiting · lapses in 23 h");
    expect(lapsesIn("2026-11-09T11:58:00.000Z", new Date("2026-11-09T11:28:00.000Z"))).toBe("30 min");
    // A clock read a minute before the ask never says more than 24 h.
    expect(lapsesIn("2026-11-09T11:58:00.000Z", new Date("2026-11-08T11:57:00.000Z"))).toBe("24 h");
  });

  it("then says the answer, briefly", () => {
    const answeredAt = new Date(ASK_NOW.getTime() - HOUR).toISOString();
    expect(status([makeAsk({ state: "approved", answeredAt, answeredBy: MEERA })])?.text).toBe("Meera said yes · logged");
    expect(status([makeAsk({ state: "declined", answeredAt, answeredBy: MEERA })])?.text).toBe("Meera said no");
    expect(status([makeAsk({ state: "lapsed" })])?.text).toBe("Lapsed");
    // An admin answered once the buyer left.
    expect(status([makeAsk({ state: "approved", answeredAt, answeredBy: KIRAN, answerer: null, answererName: null })])?.text).toBe("Kiran said yes · logged");
    // Hours later, or cancelled, the row is as it was.
    expect(status([makeAsk({ state: "approved", answeredAt: new Date(ASK_NOW.getTime() - 3 * HOUR).toISOString(), answeredBy: MEERA })])).toBeNull();
    expect(status([makeAsk({ state: "canceled", answeredAt })])).toBeNull();
  });

  it("shows the waiting ask before an older answer, and leaves a cook session's asks to their lines", () => {
    const old = makeAsk({ id: "ask_old", state: "declined", answeredAt: ASK_NOW.toISOString(), answeredBy: MEERA, createdAt: "2026-11-08T10:00:00.000Z" });
    expect(status([old, makeAsk()])?.phase).toBe("waiting");
    expect(status([makeAsk({ source: "cook" })])).toBeNull();
    expect(status([makeAsk({ item: { ...makeAsk().item, id: "itm_other" } })])).toBeNull();
  });
});

describe("The request, and what shows at once", () => {
  it("asks for an amount in the unit or a measure, for the people, from the Pantry or a cook session", () => {
    const item = saffron();
    expect(askRequest(item, 500, [DEV, ANU])).toEqual({ quantity: "0.5", unit: "g", consumers: [DEV, ANU] });
    expect(askRequest(item, 50, [DEV], { measure: { one: "pinch" }, quantity: 1 })).toEqual({ quantity: "1", measure: "pinch", consumers: [DEV] });
    expect(askRequest(item, 500, [DEV], null, "cook")).toEqual({ quantity: "0.5", unit: "g", consumers: [DEV], source: "cook" });
  });

  it("puts the ask in your asks, replaces the one on its way, and cancels in place", () => {
    const res: AsksResponse = { toAnswer: [], mine: [makeAsk({ id: "ask_older" })] };
    const sending = makeAsk({ id: "pending_ask_1" });
    const shown = withMineAsk(res, sending);
    expect(shown.mine.map((a) => a.id)).toEqual(["pending_ask_1", "ask_older"]);
    expect(withMineAsk(shown, makeAsk(), "pending_ask_1").mine.map((a) => a.id)).toEqual(["ask_00000000000000000000000000000a01", "ask_older"]);
    expect(withAskChanged(res, "ask_older", { state: "canceled" }).mine[0]!.state).toBe("canceled");
    expect(withAskChanged(res, "ask_none", { state: "canceled" })).toBe(res);
  });

  it("turns a row into the ask row when a use is refused with ask_first", () => {
    const fields = askFirstRefusalFields({ reason: "ask_first", details: { answerer: MEERA, itemId: "itm_1" } });
    expect(fields).toEqual({ askFirst: true, mustAsk: true, answerer: MEERA });
    expect(askFirstRefusalFields({ reason: "insufficient_stock" })).toBeNull();
    const item = saffron({ mustAsk: false });
    const [patch] = askItemPatches(item.id, fields!);
    const list = patch!.update({ items: [item], truncated: false }, ["kitchenPantry", "items", "all"]) as { items: { mustAsk?: boolean }[] };
    expect(list.items[0]!.mustAsk).toBe(true);
    expect((patch!.update(item, ["kitchenPantry", "item", "org:x"]) as { answerer?: string }).answerer).toBe(MEERA);
    expect(patch!.update([item], ["kitchenPantry", "usuals"])).toEqual([item]);
  });
});

describe("History and the stock check for an ask-first item", () => {
  const item = saffron();
  const approved = makeMove({ kind: "use", via: "ask", actor: DEV, consumers: [DEV, ANU], label: "1 pinch", qtyMilli: 50, quantity: 0.05, unit: "g", costMinor: 1_200, at: "2026-11-08T11:00:00.000Z" });

  it("reads an approved ask's use as one: Asked · approved by Meera", () => {
    const [row] = historyRows([approved], { item, meId: DEV, names: NAMES, now: ASK_NOW, stockChecks: true });
    expect(row!.what).toBe("You and Anu · 1 pinch");
    expect(row!.when).toBe("Asked · approved by Meera · 1 h ago");
    const [mine] = historyRows([approved], { item, meId: MEERA, names: NAMES, now: ASK_NOW, stockChecks: true });
    expect(mine!.what).toBe("Dev and Anu · 1 pinch");
    expect(mine!.when).toBe("Asked · approved by you · 1 h ago");
    // Today's frame reads it as any use.
    const [today] = historyRows([approved], { item, meId: DEV, names: NAMES, now: ASK_NOW });
    expect(today!.when).not.toContain("Asked");
  });

  it("offers only It went bad to someone who must ask, and says who logs a use", () => {
    const opts = checkOptions({ item, says: 1_000, roster: ROSTER, meId: DEV, names: NAMES });
    expect(opts.map((o) => o.gone)).toEqual(["waste"]);
    expect(defaultGone(item)).toBe("waste");
    expect(checkAskNote(item, NAMES)).toBe("Ask Meera to log what was used");
    // The buyer, and everyone on an item that doesn't ask, keep all three.
    const free = saffron({ mustAsk: false });
    expect(checkOptions({ item: free, says: 1_000, roster: ROSTER, meId: MEERA, names: NAMES }).map((o) => o.gone)).toEqual(["split", "me", "waste"]);
    expect(defaultGone(free)).toBe("split");
    expect(checkAskNote(free, NAMES)).toBeNull();
  });

  it("leaves today's refusal words alone (the new frame says Ask Meera first)", () => {
    expect(logRefusal({ reason: "ask_first", message: "Ask first." }, { item, meId: DEV, names: NAMES }).message).toBe("Ask first.");
    expect(FLAT.name).toBe("Flat 4B");
  });
});
