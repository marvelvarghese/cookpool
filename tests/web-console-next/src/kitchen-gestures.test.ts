import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { KitchenTxn } from "@saas/contracts/kitchen";
import { RepeatButton, SwipeRow } from "@web-console-next/components/kitchen/row-gestures-ui";
import { SWIPE_UNDO_KINDS, activityRow, swipeUndoable } from "@web-console-next/components/kitchen/activity";
import { canSwipeUndoMove, canUndoMove } from "@web-console-next/components/kitchen/item-use";
import { itemActions, itemRefFromHref, swipeUseLabel } from "@web-console-next/components/kitchen/item-actions";
import { lineView, pantryLine } from "@web-console-next/components/kitchen/dish-maker";
import { itemRefOf } from "@web-console-next/components/kitchen/pantry";
import { ANU, DEV, FLAT, ME, NAMES, PERSONAL_REF, groupRef, makeItem, makeMove } from "./kitchen-pantry-fixtures";

const NOW = new Date(2026, 10, 2, 18, 0, 0);

function txn(patch: Partial<KitchenTxn>): KitchenTxn {
  return {
    id: "txn_1",
    orgId: FLAT.orgId,
    kind: "use",
    title: "Milk (1 glass)",
    totalMinor: 1_700,
    currency: "INR",
    occurredAt: new Date(2026, 10, 2, 15, 0, 0).toISOString(),
    createdBy: ME,
    createdAt: new Date(2026, 10, 2, 15, 0, 0).toISOString(),
    sourceKind: null,
    sourceId: null,
    reverses: null,
    reversed: false,
    reversedBy: null,
    method: null,
    note: null,
    splits: [
      { subjectId: ANU, paidMinor: 1_700, owedMinor: 0 },
      { subjectId: ME, paidMinor: 0, owedMinor: 1_700 },
    ],
    ...patch,
  };
}

const ctx = { meId: ME, canReverseAny: false, now: NOW, names: NAMES };

describe("swiping your own log left undoes it (PW-8): the activity", () => {
  it("swipes your own use or waste — the rows whose ⋮ offers Undo", () => {
    expect(SWIPE_UNDO_KINDS).toEqual(["use", "waste"]);
    for (const kind of ["use", "waste"] as const) {
      expect(activityRow(txn({ kind }), ctx)).toMatchObject({ canUndo: true, canSwipeUndo: true });
    }
  });

  it("never swipes a bill, even your own: undoing one reverses it for the group, which stays a button", () => {
    expect(activityRow(txn({ kind: "expense", title: "Groceries" }), ctx)).toMatchObject({ canUndo: true, canSwipeUndo: false });
  });

  it("never swipes a payment or a dish, even your own: their Undo stays behind ⋮", () => {
    const paid = txn({ kind: "settlement", title: "Payment", method: "upi" });
    expect(activityRow(paid, ctx)).toMatchObject({ canUndo: true, canSwipeUndo: false });
    const dish = txn({ kind: "dish", title: "Egg fried rice" });
    expect(activityRow(dish, ctx)).toMatchObject({ canUndo: true, canSwipeUndo: false });
  });

  it("never swipes anyone else's entry, even for an owner or admin who may undo it from ⋮", () => {
    const anus = txn({ createdBy: ANU });
    expect(activityRow(anus, ctx)).toMatchObject({ canUndo: false, canSwipeUndo: false });
    expect(activityRow(anus, { ...ctx, canReverseAny: true })).toMatchObject({ canUndo: true, canSwipeUndo: false });
  });

  it("never swipes what can't be undone: undone already, an undo itself, not posted yet, or a viewer's", () => {
    expect(activityRow(txn({ reversed: true, reversedBy: "txn_2" }), ctx).canSwipeUndo).toBe(false);
    expect(activityRow(txn({ kind: "reversal", reverses: "txn_0" }), ctx).canSwipeUndo).toBe(false);
    expect(activityRow(txn({ id: "pending_txn_abc" }), ctx).canSwipeUndo).toBe(false);
    expect(activityRow(txn({}), { ...ctx, canWrite: false }).canSwipeUndo).toBe(false);
  });

  it("is the menu's Undo and your own, nothing more", () => {
    expect(swipeUndoable({ kind: "use", createdBy: ME }, { meId: ME, canUndo: true })).toBe(true);
    expect(swipeUndoable({ kind: "use", createdBy: ME }, { meId: ME, canUndo: false })).toBe(false);
    expect(swipeUndoable({ kind: "use", createdBy: ME }, { meId: null, canUndo: true })).toBe(false);
    expect(swipeUndoable({ kind: "settlement", createdBy: ME }, { meId: ME, canUndo: true })).toBe(false);
  });
});

describe("swiping your own log left undoes it (PW-8): an item's history", () => {
  const can = { meId: ME, personal: false, role: "member" as const, canWrite: true };

  it("swipes your own use or waste that shows Undo", () => {
    const use = makeMove({ kind: "use", actor: ME, txnId: "txn_1" });
    expect(canUndoMove(use, [use], can)).toBe(true);
    expect(canSwipeUndoMove(use, [use], can)).toBe(true);
    const waste = makeMove({ kind: "waste", actor: ME, txnId: "txn_2" });
    expect(canSwipeUndoMove(waste, [waste], can)).toBe(true);
    const own = makeMove({ kind: "use", actor: ME });
    expect(canSwipeUndoMove(own, [own], { meId: ME, personal: true, role: null, canWrite: true })).toBe(true);
  });

  it("never swipes someone else's use, even for an admin whose button undoes it", () => {
    const anus = makeMove({ kind: "use", actor: ANU, txnId: "txn_3" });
    expect(canUndoMove(anus, [anus], { ...can, role: "admin" })).toBe(true);
    expect(canSwipeUndoMove(anus, [anus], { ...can, role: "admin" })).toBe(false);
  });

  it("never swipes a dish's take, a transfer, an undone move or a viewer's", () => {
    const dish = makeMove({ kind: "dish", actor: ME, txnId: "txn_4" });
    expect(canSwipeUndoMove(dish, [dish], can)).toBe(false);
    const transfer = makeMove({ kind: "transfer", actor: ME });
    expect(canSwipeUndoMove(transfer, [transfer], can)).toBe(false);
    const undone = { ...makeMove({ kind: "use", actor: ME, txnId: "txn_5" }), undone: true };
    expect(canSwipeUndoMove(undone, [undone], can)).toBe(false);
    const use = makeMove({ kind: "use", actor: ME, txnId: "txn_6" });
    expect(canSwipeUndoMove(use, [use], { ...can, role: "viewer", canWrite: false })).toBe(false);
  });
});

describe("a pantry row's swipe says what its Use does (PW-8)", () => {
  it("names your usual, or just Use when the row opens Use", () => {
    expect(swipeUseLabel("2 onions")).toBe("Use 2 onions");
    expect(swipeUseLabel(null)).toBe("Use");
    expect(swipeUseLabel("")).toBe("Use");
  });
});

describe("holding an item opens its actions (PW-8, the canvas's AppGestures)", () => {
  const onions = makeItem({ name: "Onions", pantry: groupRef(FLAT), unit: "kg", bought: "1", left: "0.6", paidBy: DEV });
  const ref = itemRefOf(onions);

  it("lists Use [usual] · Use some… · Cook with it · Wasted · Open, in that order", () => {
    const actions = itemActions({ item: onions, ref, usualWords: "2 onions" });
    expect(actions.map((a) => a.label)).toEqual(["Use 2 onions", "Use some…", "Cook with it", "Wasted", "Open"]);
    const param = `org:${FLAT.orgId}:${onions.id}`;
    expect(actions.map((a) => a.href)).toEqual([null, `/use?item=${param}`, `/cook?item=${param}`, null, `/pantry/${param}`]);
  });

  it("leaves out Use [usual] without a usual that fits (the row's Use opens Use)", () => {
    expect(itemActions({ item: onions, ref, usualWords: null }).map((a) => a.id)).toEqual(["use-some", "cook", "waste", "open"]);
  });

  it("offers only Open for what you can't use: a viewer's, used up, wasted, or not read yet", () => {
    expect(itemActions({ item: { ...onions, canUse: false }, ref, usualWords: "2 onions" }).map((a) => a.id)).toEqual(["open"]);
    expect(itemActions({ item: { ...onions, qtyLeftMilli: 0, state: "used_up" }, ref, usualWords: null }).map((a) => a.id)).toEqual(["open"]);
    expect(itemActions({ item: { ...onions, state: "wasted" }, ref, usualWords: null }).map((a) => a.id)).toEqual(["open"]);
    expect(itemActions({ item: null, ref, usualWords: "2 onions" }).map((a) => a.id)).toEqual(["open"]);
  });

  it("works for your own pantry's item", () => {
    const eggs = makeItem({ name: "Eggs", pantry: PERSONAL_REF, unit: "pcs", bought: "12", left: "7" });
    const actions = itemActions({ item: eggs, ref: itemRefOf(eggs), usualWords: "2 eggs" });
    expect(actions[0]).toEqual({ id: "use", label: "Use 2 eggs", href: null });
    expect(actions.at(-1)).toEqual({ id: "open", label: "Open", href: `/pantry/me:${eggs.id}` });
  });

  it("reads Home's use-soon row's item from its address", () => {
    expect(itemRefFromHref(`/pantry/org:${FLAT.orgId}:${onions.id}`)).toEqual({ kind: "group", orgId: FLAT.orgId, itemId: onions.id });
    expect(itemRefFromHref(`/pantry/me%3A${onions.id}`)).toEqual({ kind: "personal", itemId: onions.id });
    expect(itemRefFromHref("/pantry/new")).toBeNull();
    expect(itemRefFromHref("/dishes/dsh_1")).toBeNull();
  });
});

describe("a held − stops before it takes an ingredient out (PW-8)", () => {
  it("marks the smallest amount, where one more tap (not a hold) takes it out", () => {
    const onions = makeItem({ name: "Onions", pantry: groupRef(FLAT), unit: "kg", bought: "2", left: "1.6", priceMinor: 7000, paidBy: DEV });
    const smallest = lineView(pantryLine(onions, 50_000), { meId: ME, names: NAMES, currency: "INR" });
    expect(smallest).toMatchObject({ atSmallest: true, lessLabel: "Take out onions" });
    const more = lineView(pantryLine(onions, 200_000), { meId: ME, names: NAMES, currency: "INR" });
    expect(more).toMatchObject({ atSmallest: false, lessLabel: "Less onions" });
  });
});

describe("the gesture components, rendered (PW-8)", () => {
  const noop = () => undefined;

  it("a swipeable row takes horizontal drags only and shows no callout or selection; its front is opaque", () => {
    const html = renderToStaticMarkup(
      React.createElement(SwipeRow, { action: { label: "Use 2 onions", tone: "use", run: noop }, frontClassName: "flex items-center" }, "Onions"),
    );
    expect(html).toMatch(/^<li /);
    expect(html).toContain("touch-action:pan-y");
    expect(html).toContain("data-swipe-row");
    expect(html).toContain("select-none");
    expect(html).toContain("[-webkit-touch-callout:none]");
    expect(html).toContain('class="relative bg-card flex items-center"');
    // The action is drawn only while the row moves.
    expect(html).not.toContain("Use 2 onions");
  });

  it("a row with nothing to swipe to and no menu is a plain row (a payment's)", () => {
    const html = renderToStaticMarkup(React.createElement(SwipeRow, { as: "div", action: null }, "Anu paid you"));
    expect(html).toMatch(/^<div /);
    expect(html).not.toContain("touch-action");
    expect(html).not.toContain("data-swipe-row");
  });

  it("a held-only row (a viewer's item) still takes the press", () => {
    const html = renderToStaticMarkup(React.createElement(SwipeRow, { action: null, onLongPress: noop }, "Milk"));
    expect(html).toContain("touch-action:pan-y");
  });

  it("a repeat button is a plain button: its tap is its click, and it is disabled at the end", () => {
    const on = renderToStaticMarkup(React.createElement(RepeatButton, { onStep: noop, "aria-label": "One portion more" }, "+"));
    expect(on).toBe('<button type="button" aria-label="One portion more">+</button>');
    const off = renderToStaticMarkup(React.createElement(RepeatButton, { onStep: noop, disabled: true, "aria-label": "One portion more" }, "+"));
    expect(off).toContain("disabled");
  });
});
