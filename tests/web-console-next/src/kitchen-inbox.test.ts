import type { InboxDish, InboxItem, InboxResponse, KitchenTxn } from "@saas/contracts/kitchen";
import {
  HOME_TODOS,
  dueWord,
  flaggedEntryHref,
  homeTodo,
  homeTodos,
  inboxCard,
  inboxHeading,
  inboxView,
  useButtonLabel,
  useByText,
  type InboxAction,
} from "@web-console-next/components/kitchen/inbox";
import { RECENT_ROWS, recentAcrossGroups, recentGroupsToRead } from "@web-console-next/components/kitchen/home";
import { leaveBalance } from "@web-console-next/components/kitchen/groups";
import { isWideKitchenPage } from "@web-console-next/components/kitchen/nav";
import { UNDO_MS, undoFailed, undoneToast } from "@web-console-next/components/kitchen/undo";
import { soonStrip } from "@web-console-next/components/kitchen/pantry";
import { makeItem } from "./kitchen-pantry-fixtures";

const ME = "usr_000000000000000000000000000000aa";
const DEV = "usr_00000000000000000000000000003f9a";
const ANU = "usr_0000000000000000000000000000b0b0";
const MEERA = "usr_0000000000000000000000000000d2d2";
const FLAT = { orgId: "org_00000000000000000000000000000f1a", slug: "flat-4b-k3x9", name: "Flat 4B" };
const NOW = new Date(2026, 10, 2, 18, 0, 0); // 2 Nov 2026, 18:00 local
const at = (d: Date) => d.toISOString();
const names = new Map<string, string>([
  [DEV, "Dev"],
  [ANU, "Anu"],
  [MEERA, "Meera"],
]);
const ctx = { meId: ME, names, now: NOW };

function dish(patch: Partial<InboxDish> = {}): InboxDish {
  return {
    id: "dsh_00000000000000000000000000000002",
    orgId: FLAT.orgId,
    groupName: FLAT.name,
    groupSlug: FLAT.slug,
    name: "Egg fried rice",
    cook: MEERA,
    cookName: "Meera",
    state: "open",
    splitMode: "claims",
    portionsHalf: 10,
    claimedHalf: 2,
    unclaimedHalf: 8,
    perPortionMinor: 3120,
    totalMinor: 15600,
    currency: "INR",
    cookedAt: at(new Date(2026, 10, 2, 15, 0)),
    ...patch,
  };
}

const claim: InboxItem = { kind: "claim_dish", dish: dish() };
const finalizeOpen: InboxItem = {
  kind: "finalize_dish",
  dish: dish({ id: "dsh_00000000000000000000000000000001", name: "Paneer butter masala", cook: ME, cookName: "Rahul", portionsHalf: 8, claimedHalf: 7, unclaimedHalf: 1, totalMinor: 21100, perPortionMinor: 5275 }),
};
const finalizeDraft: InboxItem = {
  kind: "finalize_dish",
  dish: dish({ id: "dsh_00000000000000000000000000000004", name: "Dal tadka", cook: ME, cookName: "Rahul", state: "draft", splitMode: "assign", claimedHalf: 0, unclaimedHalf: 6, portionsHalf: 6 }),
};
const finalizeSolo: InboxItem = {
  kind: "finalize_dish",
  dish: dish({ id: "dsh_00000000000000000000000000000005", name: "Masala oats", cook: ME, cookName: "Rahul", orgId: null, groupName: null, groupSlug: null, state: "draft", splitMode: "assign", portionsHalf: 2, claimedHalf: 0, unclaimedHalf: 2, totalMinor: 2952, perPortionMinor: 2952 }),
};
const milk: InboxItem = {
  kind: "use_soon",
  item: {
    id: "itm_00000000000000000000000000000007",
    ref: `org:${FLAT.orgId}:itm_00000000000000000000000000000007`,
    name: "Milk",
    pantry: { kind: "group", ...FLAT },
    orgId: FLAT.orgId,
    qtyLeftMilli: 1_000_000,
    quantity: 1,
    unit: "L",
    expiresOn: "2026-11-03",
    daysToUseBy: 1,
    canUse: true,
  },
  usual: { quantity: 250, unit: "ml", qtyMilli: 250_000 },
};
const yogurt: InboxItem = {
  kind: "use_soon",
  item: {
    id: "itm_00000000000000000000000000000004",
    ref: "me:itm_00000000000000000000000000000004",
    name: "Greek yogurt",
    pantry: { kind: "personal", name: "My pantry" },
    orgId: null,
    qtyLeftMilli: 400_000,
    quantity: 400,
    unit: "g",
    expiresOn: "2026-11-01",
    daysToUseBy: -1,
    canUse: true,
  },
  usual: null,
};
const eggs: InboxItem = {
  kind: "use_soon",
  item: { ...(yogurt as Extract<InboxItem, { kind: "use_soon" }>).item, id: "itm_00000000000000000000000000000003", ref: "me:itm_00000000000000000000000000000003", name: "Eggs", qtyLeftMilli: 7000, quantity: 7, unit: "pcs", expiresOn: "2026-11-02", daysToUseBy: 0 },
  usual: { quantity: 2, unit: "pcs", qtyMilli: 2000 },
};
const pay: InboxItem = {
  kind: "payment_due",
  orgId: FLAT.orgId,
  groupName: FLAT.name,
  groupSlug: FLAT.slug,
  toSubjectId: DEV,
  toName: "Dev",
  amountMinor: 4575,
  currency: "INR",
  canRecord: true,
};
const flag: InboxItem = {
  kind: "flag",
  flagId: "flg_1",
  txnId: "txn_m3",
  orgId: FLAT.orgId,
  groupName: FLAT.name,
  groupSlug: FLAT.slug,
  title: "Tomatoes",
  txnKind: "use",
  totalMinor: 1200,
  currency: "INR",
  dishId: null,
  flaggedBy: ANU,
  flaggedByName: "Anu",
  reason: "  I wasn't there for this one  ",
  flaggedAt: at(new Date(2026, 10, 2, 17, 55)),
};

function response(items: InboxItem[]): InboxResponse {
  const count = (k: InboxItem["kind"]) => items.filter((i) => i.kind === k).length;
  return {
    items,
    counts: {
      total: items.length,
      claim_dish: count("claim_dish"),
      finalize_dish: count("finalize_dish"),
      use_soon: count("use_soon"),
      payment_due: count("payment_due"),
      flag: count("flag"),
    },
  };
}

describe("Home's inbox: each card kind and its action (CP-23)", () => {
  it("a dish to claim: who made it, what is left, a portion's price, and the claim buttons", () => {
    const card = inboxCard(claim, ctx)!;
    expect(card.title).toBe("Meera made Egg fried rice");
    expect(card.meta).toBe("Flat 4B · 4 of 5 portions left · ₹31.20 a portion · cooked today");
    expect(card.href).toBe("/dishes/dsh_00000000000000000000000000000002");
    expect(card.tone).toBe("dish");
    expect(card.action).toEqual({ kind: "claim", dishId: "dsh_00000000000000000000000000000002", orgId: FLAT.orgId });
  });

  it("a cook with no name to show is a member tag, never an id", () => {
    const card = inboxCard({ kind: "claim_dish", dish: dish({ cookName: null }) }, { meId: ME, names: new Map(), now: NOW })!;
    expect(card.title).toBe("Member · d2d2 made Egg fried rice");
    expect(card.title).not.toContain("usr_");
  });

  it("your open dish finalizes here; an assigned one is split on its page; one just for you finalizes here too", () => {
    const open = inboxCard(finalizeOpen, ctx)!;
    expect(open.title).toBe("Finalize your Paneer butter masala");
    expect(open.meta).toBe("Flat 4B · 3½ of 4 portions claimed · ₹211.00 · cooked today");
    expect(open.action).toEqual({ kind: "finalize", dishId: "dsh_00000000000000000000000000000001", groupName: "Flat 4B" });

    const draft = inboxCard(finalizeDraft, ctx)!;
    expect(draft.title).toBe("Split your Dal tadka");
    expect(draft.action).toEqual({ kind: "split", href: "/dishes/dsh_00000000000000000000000000000004", label: "Set portions" });

    const solo = inboxCard(finalizeSolo, ctx)!;
    expect(solo.meta).toBe("Just for you · ₹29.52 · cooked today");
    expect(solo.action).toEqual({ kind: "finalize", dishId: "dsh_00000000000000000000000000000005", groupName: null });
  });

  it("food to use soon: your usual amount in one tap, for just you, and Cook with it", () => {
    const card = inboxCard(milk, ctx)!;
    expect(card.title).toBe("Milk");
    expect(card.meta).toBe("Flat 4B · 1 L left · use by tomorrow");
    expect(card.tone).toBe("soon");
    expect(card.href).toBe(`/pantry/org:${FLAT.orgId}:itm_00000000000000000000000000000007`);
    const action = card.action as Extract<InboxAction, { kind: "use" }>;
    expect(action).toMatchObject({ kind: "use", qtyMilli: 250_000, label: "I had a glass", words: "1 glass", usual: true });
    expect(action.ref).toEqual({ kind: "group", orgId: FLAT.orgId, itemId: "itm_00000000000000000000000000000007" });
    expect(action.cookHref).toBe(`/cook?item=org:${FLAT.orgId}:itm_00000000000000000000000000000007`);
  });

  it("without a usual it offers the first kitchen measure; past its date it says so", () => {
    const card = inboxCard(yogurt, ctx)!;
    expect(card.meta).toBe("Personal · 400 g left · expired yesterday");
    expect(card.tone).toBe("expired");
    expect(card.action).toMatchObject({ kind: "use", qtyMilli: 200_000, label: "I had a cup", usual: false });
    const counted = inboxCard(eggs, ctx)!;
    expect(counted.meta).toBe("Personal · 7 pcs left · use by today");
    expect(counted.action).toMatchObject({ qtyMilli: 2000, label: "I used 2 pcs", usual: true });
  });

  it("a usual of more than is left is not offered: the first measure that fits is", () => {
    const card = inboxCard({ ...milk, usual: { quantity: 2, unit: "L", qtyMilli: 2_000_000 } } as InboxItem, ctx)!;
    expect(card.action).toMatchObject({ qtyMilli: 250_000, usual: false });
  });

  it("a payment due: who, how much, I paid — and none for a viewer", () => {
    const card = inboxCard(pay, ctx)!;
    expect(card.title).toBe("You owe Dev ₹45.75");
    expect(card.meta).toBe("Flat 4B · the fewest-payments plan");
    expect(card.href).toBe("/settle?group=flat-4b-k3x9");
    expect(card.action).toEqual({
      kind: "pay",
      orgId: FLAT.orgId,
      toSubjectId: DEV,
      toLabel: "Dev",
      amountMinor: 4575,
      currency: "INR",
      canRecord: true,
      groupName: "Flat 4B",
    });
    const viewer = inboxCard({ ...pay, canRecord: false, toName: null } as InboxItem, { meId: ME, names: new Map(), now: NOW })!;
    expect(viewer.action).toMatchObject({ canRecord: false, toLabel: "Member · 3f9a" });
  });

  it("a flag: who flagged what, what they said, and a link to the entry (a dish's charge opens the dish)", () => {
    const card = inboxCard(flag, ctx)!;
    expect(card.title).toBe("Anu flagged “Tomatoes”");
    expect(card.note).toBe("“I wasn't there for this one”");
    expect(card.meta).toBe("Flat 4B · Use · ₹12.00 · 5 min ago");
    expect(card.action).toEqual({ kind: "open", href: "/groups/flat-4b-k3x9?txn=txn_m3", label: "See the entry" });
    const onDish = inboxCard({ ...flag, dishId: "dsh_1", txnKind: "dish" } as InboxItem, ctx)!;
    expect(onDish.action).toEqual({ kind: "open", href: "/dishes/dsh_1", label: "Open the dish" });
    expect(flaggedEntryHref({ dishId: null, groupSlug: "a b", txnId: "txn_1" })).toBe("/groups/a%20b?txn=txn_1");
  });
});

describe("Home's inbox: order, heading and All clear (CP-23)", () => {
  it("keeps the server's order (most urgent first), each card once", () => {
    const view = inboxView(response([yogurt, claim, finalizeOpen, milk, pay, flag, claim]), ctx);
    expect(view.cards.map((c) => c.kind)).toEqual(["use_soon", "claim_dish", "finalize_dish", "use_soon", "payment_due", "flag"]);
    expect(new Set(view.cards.map((c) => c.key)).size).toBe(view.cards.length);
    expect(view.heading).toBe("Needs you · 6 to do");
    expect(view.empty).toBe(false);
  });

  it("is All clear with nothing to do, and counts only the cards it shows", () => {
    const view = inboxView(response([]), ctx);
    expect(view).toEqual({ cards: [], heading: "Needs you", empty: true });
    expect(inboxHeading(1)).toBe("Needs you · 1 to do");
    const unknown = { kind: "something_new" } as unknown as InboxItem;
    expect(inboxView(response([unknown, pay]), ctx).heading).toBe("Needs you · 1 to do");
  });

  it("Pantry's soonest items leave out what is excluded", () => {
    const soon = [makeItem({ id: "itm_a", daysToUseBy: 0 }), makeItem({ id: "itm_b", daysToUseBy: 2 }), makeItem({ id: "itm_c", daysToUseBy: 3 })];
    expect(soonStrip(soon, [], 4, new Set(["itm_a", "itm_b"])).map((i) => i.id)).toEqual(["itm_c"]);
  });
});

describe("Home's inbox: the words (CP-23)", () => {
  it("the one-tap button says the measure", () => {
    expect(useButtonLabel("1 glass", "volume")).toBe("I had a glass");
    expect(useButtonLabel("½ glass", "volume")).toBe("I had ½ glass");
    expect(useButtonLabel("a splash", "volume")).toBe("I had a splash");
    expect(useButtonLabel("1 cup", "mass")).toBe("I had a cup");
    expect(useButtonLabel("1 pc", "count")).toBe("I used 1 pc");
    expect(useButtonLabel("1 pack", "pack")).toBe("I used 1 pack");
  });

  it("use-by in words", () => {
    expect(useByText({ expiresOn: "2026-11-02", daysToUseBy: 0 })).toBe("use by today");
    expect(useByText({ expiresOn: "2026-11-04", daysToUseBy: 2 })).toBe("use by 4 Nov");
    expect(useByText({ expiresOn: "2026-10-31", daysToUseBy: -2 })).toBe("expired 31 Oct");
  });
});

describe("Home's to-dos (SM-10: a compact list, three at most)", () => {
  const all = [yogurt, claim, finalizeOpen, milk, pay, flag, finalizeDraft, finalizeSolo, eggs];

  it("shows at most three, most urgent first, and how many See all adds", () => {
    expect(HOME_TODOS).toBe(3);
    const todos = homeTodos(response(all), ctx);
    expect(todos.rows.map((r) => r.kind)).toEqual(["use_soon", "claim_dish", "finalize_dish"]);
    expect(todos).toMatchObject({ total: 9, more: 6 });
    const seeAll = homeTodos(response(all), ctx, { all: true });
    expect(seeAll.rows).toHaveLength(9);
    expect(seeAll.more).toBe(0);
    expect(homeTodos(response([milk, pay]), ctx)).toMatchObject({ total: 2, more: 0 });
    expect(homeTodos(response([]), ctx)).toEqual({ rows: [], total: 0, more: 0 });
  });

  it("lists each thing once — a debt the server repeats is still one row", () => {
    const todos = homeTodos(response([pay, claim, pay, { ...pay } as InboxItem, claim]), ctx);
    expect(todos.rows.map((r) => r.key)).toEqual([`payment_due:${FLAT.orgId}:${DEV}`, "claim_dish:dsh_00000000000000000000000000000002"]);
    expect(todos.total).toBe(2);
  });

  it("is a word or two and one line of numbers per row, as the canvas draws it", () => {
    const row = (item: InboxItem) => {
      const r = homeTodo(item, ctx)!;
      return [r.title, r.sub, r.subTone];
    };
    expect(row(claim)).toEqual(["Egg fried rice", "Meera · ₹31.20 each", "muted"]);
    expect(row(finalizeOpen)).toEqual(["Paneer butter masala", "3½ of 4 had", "muted"]);
    expect(row(finalizeDraft)).toEqual(["Dal tadka", "0 of 3 had", "muted"]);
    expect(row(finalizeSolo)).toEqual(["Masala oats", "Just for you", "muted"]);
    expect(row(yogurt)).toEqual(["Greek yogurt", "Expired", "expired"]);
    expect(row(milk)).toEqual(["Milk", "Tomorrow", "soon"]);
    expect(row(eggs)).toEqual(["Eggs", "Today", "soon"]);
    expect(row(pay)).toEqual(["Pay Dev", "₹45.75", "owe"]);
    expect(row(flag)).toEqual(["Anu flagged Tomatoes", "“I wasn't there for this one”", "muted"]);
    expect(homeTodo({ ...flag, reason: "  " } as InboxItem, ctx)!.sub).toBe("₹12.00");
  });

  it("keeps each card's one action, and shows the face of who you pay", () => {
    expect(homeTodo(pay, ctx)).toMatchObject({ faceId: DEV, action: { kind: "pay", canRecord: true } });
    expect(homeTodo(claim, ctx)).toMatchObject({ faceId: null, action: { kind: "claim" } });
    expect(homeTodo(milk, ctx)!.action).toMatchObject({ kind: "use", words: "1 glass", qtyMilli: 250_000 });
    expect(homeTodo(finalizeDraft, ctx)!.action).toMatchObject({ kind: "split" });
    expect(homeTodo({ kind: "something_new" } as unknown as InboxItem, ctx)).toBeNull();
  });

  it("has no captions or ledger words in any row", () => {
    const words = homeTodos(response(all), ctx, { all: true })
      .rows.map((r) => `${r.title} ${r.sub}`)
      .join(" ");
    expect(words).not.toMatch(/for just you|fewest|netting|claim|posted|finalize,|usual/i);
  });

  it("says when food is due in a word or two", () => {
    expect([-3, 0, 1, 2, 9].map(dueWord)).toEqual(["Expired", "Today", "Tomorrow", "2 days", "9 days"]);
  });
});

describe("Home's recent activity (CP-23; SM-10: short, payments as money that moved)", () => {
  function txn(id: string, occurredAt: Date, patch: Partial<KitchenTxn> = {}): KitchenTxn {
    return {
      id,
      orgId: FLAT.orgId,
      kind: "expense",
      title: id,
      totalMinor: 1000,
      currency: "INR",
      occurredAt: at(occurredAt),
      createdBy: DEV,
      createdAt: at(occurredAt),
      sourceKind: null,
      sourceId: null,
      reverses: null,
      reversed: false,
      reversedBy: null,
      method: null,
      note: null,
      splits: [
        { subjectId: DEV, paidMinor: 1000, owedMinor: 500 },
        { subjectId: ME, paidMinor: 0, owedMinor: 500 },
      ],
      ...patch,
    };
  }

  it("merges each group's newest entries, newest first, labelled with the group, at most the limit", () => {
    const rows = recentAcrossGroups(
      [
        { orgId: FLAT.orgId, name: "Flat 4B", slug: FLAT.slug, txns: [txn("txn_a", new Date(2026, 10, 2, 17, 0)), txn("txn_c", new Date(2026, 10, 1, 9, 0))] },
        {
          orgId: "org_2",
          name: "Lunch club",
          slug: "lunch-club",
          txns: [txn("txn_b", new Date(2026, 10, 2, 12, 0), { orgId: "org_2", kind: "dish", sourceKind: "dish", sourceId: "dsh_9" })],
        },
      ],
      { meId: ME, names, now: NOW, limit: 2 },
    );
    expect(rows.map((r) => r.id)).toEqual(["txn_a", "txn_b"]);
    expect(rows[0]!.whoWhen).toBe("Flat 4B · Dev · 1 h ago");
    expect(rows[0]!.href).toBe("/groups/flat-4b-k3x9?txn=txn_a");
    expect(rows[0]!.amountText).toBe("−₹5.00");
    expect(rows[1]!.href).toBe("/dishes/dsh_9");
    expect(rows[0]!.canUndo).toBe(false);
    expect(rows[0]!.canFlag).toBe(false);
  });

  it("reads the most recently opened groups first, then the rest by name", () => {
    const groups = [{ slug: "c", name: "C" }, { slug: "a", name: "A" }, { slug: "b", name: "B" }];
    expect(recentGroupsToRead(groups, ["b"]).map((g) => g.slug)).toEqual(["b", "a", "c"]);
    expect(recentGroupsToRead(groups, [], 2).map((g) => g.slug)).toEqual(["a", "b"]);
  });

  it("is short (SM-10): two rows, so Home fits one screen", () => {
    expect(RECENT_ROWS).toBe(2);
    const many = Array.from({ length: 5 }, (_, n) => txn(`txn_${n}`, new Date(2026, 10, 2, 10 + n, 0)));
    expect(recentAcrossGroups([{ orgId: FLAT.orgId, name: "Flat 4B", slug: FLAT.slug, txns: many }], { meId: ME, names, now: NOW })).toHaveLength(2);
  });

  it("shows a payment as the money that moved: one paid to you is +, in blue; one you paid is −", () => {
    const paidToMe = txn("txn_p1", new Date(2026, 10, 2, 16, 0), {
      kind: "settlement",
      title: "Payment",
      totalMinor: 40000,
      method: "upi",
      createdBy: ANU,
      splits: [
        { subjectId: ANU, paidMinor: 40000, owedMinor: 0 },
        { subjectId: ME, paidMinor: 0, owedMinor: 40000 },
      ],
    });
    const iPaid = txn("txn_p2", new Date(2026, 10, 2, 15, 0), {
      kind: "settlement",
      title: "Payment",
      totalMinor: 2500,
      currency: "USD",
      method: "cash",
      createdBy: ME,
      splits: [
        { subjectId: ME, paidMinor: 2500, owedMinor: 0 },
        { subjectId: DEV, paidMinor: 0, owedMinor: 2500 },
      ],
    });
    const rows = recentAcrossGroups([{ orgId: FLAT.orgId, name: "Flat 4B", slug: FLAT.slug, txns: [paidToMe, iPaid] }], { meId: ME, names, now: NOW });
    expect(rows.map((r) => [r.title, r.amountText, r.tone, r.amountWords])).toEqual([
      ["Anu paid you · UPI", "+₹400.00", "owed", "You received ₹400.00"],
      ["You paid Dev · cash", "−$25.00", "owe", "You paid $25.00"],
    ]);
    // Anything else keeps what it did to your balance.
    const bill = recentAcrossGroups([{ orgId: FLAT.orgId, name: "Flat 4B", slug: FLAT.slug, txns: [txn("txn_b", new Date(2026, 10, 2, 17, 0))] }], { meId: ME, names, now: NOW });
    expect(bill[0]).toMatchObject({ amountText: "−₹5.00", tone: "owe" });
  });
});

describe("Leaving with a balance (CP-23)", () => {
  const group = { name: "Flat 4B", slug: "flat-4b-k3x9" };
  it("says how much and which way, with Settle up in that group", () => {
    expect(leaveBalance(group, { balanceMinor: -4575, currency: "INR" })).toEqual({
      title: "You owe ₹45.75 in Flat 4B",
      body: "Settle up first: once it's paid and recorded, you can leave.",
      settleHref: "/settle?group=flat-4b-k3x9",
    });
    expect(leaveBalance(group, { balanceMinor: 8650, currency: "INR" }).title).toBe("Flat 4B owes you ₹86.50");
  });
  it("without a usable amount, just that it isn't zero", () => {
    expect(leaveBalance(group, {}).title).toBe("Your balance in Flat 4B isn't zero");
    expect(leaveBalance(group, { balanceMinor: "12" }).title).toBe("Your balance in Flat 4B isn't zero");
    expect(leaveBalance(group, null).settleHref).toBe("/settle?group=flat-4b-k3x9");
  });
});

describe("Undo, the same everywhere (CP-23)", () => {
  it("ten seconds; Undone with what is back, or the refusal", () => {
    expect(UNDO_MS).toBe(10_000);
    expect(undoneToast({ ok: true, description: "“Milk” is reversed." })).toEqual({ kind: "success", title: "Undone", description: "“Milk” is reversed." });
    expect(undoneToast({ ok: true })).toEqual({ kind: "success", title: "Undone" });
    expect(undoneToast({ ok: false, title: "Couldn't undo it" })).toEqual({ kind: "error", title: "Couldn't undo it" });
    expect(undoneToast(undoFailed({ reason: "already_reversed", message: "x" }))).toEqual({ kind: "warning", title: "Already undone" });
    expect(undoneToast(undoFailed({ message: "Boom" }))).toEqual({ kind: "error", title: "Couldn't undo it", description: "Boom" });
  });
});

describe("Desktop width (CP-23)", () => {
  it("Home and the Groups list take the room from 1280px; other pages keep their width", () => {
    expect(isWideKitchenPage("/home")).toBe(true);
    expect(isWideKitchenPage("/groups/")).toBe(true);
    expect(isWideKitchenPage("/groups/flat-4b")).toBe(false);
    expect(isWideKitchenPage("/pantry")).toBe(false);
    expect(isWideKitchenPage(null)).toBe(false);
  });
});
