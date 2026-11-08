// Home's split reminder (Cookpool CM-8, cookpool-community design §2a): one
// `splitReminders` row per unsplit dish of the caller's own, cooked in the
// last SPLIT_REMINDER_DAYS, that took something from a group pantry or made
// two servings or more — naming the group it took most from, else the group
// they last cooked for, else their first — until it is split, canceled or
// dismissed (with an Undo). Through the router, against real SQLite.

import type { InboxResponse, SplitReminderDismissResponse, SplitReminderInboxItem } from "@saas/contracts/kitchen";
import { SPLIT_REMINDER_DAYS } from "@saas/contracts/kitchen";
import { servingsOf } from "@kitchen-worker/posts";
import { suggestGroup } from "@kitchen-worker/split-later";
import type { MemberGroup } from "@kitchen-worker/groups-client";
import type { KitchenDishIngredientRecord } from "@saas/db/kitchen";
import type { Uuid } from "@saas/db/ids";
import { newGroup } from "./harness.js";
import {
  ANU,
  DEV,
  LONER,
  MEERA,
  NOW,
  RAHUL,
  cookOwn,
  cookWorkedExample,
  groupItem,
  groupPath,
  me,
  split,
  world,
  type World,
} from "./split-later-helpers.js";

const DAY_MS = 86_400_000;

let w: World;
beforeEach(() => {
  w = world();
});
afterEach(() => w.h.close());

async function inbox(as: string): Promise<InboxResponse> {
  const res = await w.call<InboxResponse>("GET", me("inbox"), as);
  expect(res.status).toBe(200);
  return res.body.data;
}

async function reminders(as = RAHUL): Promise<SplitReminderInboxItem[]> {
  return (await inbox(as)).splitReminders ?? [];
}

/** Each reminder as `name → group (why)`. */
async function named(as = RAHUL): Promise<string[]> {
  return (await reminders(as)).map((r) => `${r.dish.name} → ${r.suggest.groupName} (${r.suggest.why})`);
}

const dismiss = (as: string, dishId: string) =>
  w.call<SplitReminderDismissResponse>("POST", me(`dishes/${dishId}/split-reminder/dismiss`), as);
const restore = (as: string, dishId: string) =>
  w.call<SplitReminderDismissResponse>("POST", me(`dishes/${dishId}/split-reminder/restore`), as);

describe("which dishes remind", () => {
  it("a dish that took group items, whatever its size, suggesting the group it took most from (by cost)", async () => {
    // The worked example as Rahul's own: ₹19.00 from Flat 4B, ₹24.00 from the Lunch club.
    const dish = await cookWorkedExample(w, "own");
    const [r] = await reminders();
    expect(r).toEqual({
      kind: "split_reminder",
      dish: {
        id: dish.id, name: dish.name, portionsHalf: 8, totalMinor: 21100, currency: dish.currency,
        cookedAt: NOW.toISOString(), state: "draft", groupItems: 3,
      },
      suggest: { orgId: w.lunch.publicId, groupName: "Lunch club", groupSlug: w.lunch.slug, why: "used_items" },
    });

    // Half a portion of something from Flat 4B alone reminds too, naming Flat 4B; newest first.
    w.clock = new Date(NOW.getTime() + 60_000);
    const milk = await groupItem(w, ANU, w.flat, { name: "Milk", quantity: "1", unit: "L", priceMinor: 6000 });
    const res = await w.call("POST", me("dishes"), RAHUL, {
      name: "Chai", orgId: null, portionsHalf: 1, splitMode: "assign", ingredients: [{ itemId: milk.id, quantity: "0.25", unit: "L" }],
    });
    expect(res.status).toBe(201);
    expect(await named()).toEqual([
      "Chai → Flat 4B (used_items)",
      "Paneer butter masala with rotis → Lunch club (used_items)",
    ]);
  });

  it("a dish of the cook's own things reminds from two servings, not below", async () => {
    await cookOwn(w, RAHUL, { name: "One", portionsHalf: 2 });
    await cookOwn(w, RAHUL, { name: "One and a half", portionsHalf: 3 });
    expect(await reminders()).toEqual([]);
    await cookOwn(w, RAHUL, { name: "Two", portionsHalf: 4 });
    expect((await named())).toEqual(["Two → Flat 4B (recent)"]);
  });

  it("names the group the cook last cooked for when it took nothing from one, else their first group by name", async () => {
    await cookOwn(w, RAHUL, { name: "Soup" });
    // Never cooked for a group: the first one he cooks in, by name (not the Book club, where he only views).
    expect(await named()).toEqual(["Soup → Flat 4B (recent)"]);
    const forLunch = await cookOwn(w, RAHUL, { name: "Lunch dish", portionsHalf: 2 });
    expect((await split(w, RAHUL, forLunch, { orgId: w.lunch.publicId })).status).toBe(200);
    expect(await named()).toEqual(["Soup → Lunch club (recent)"]);
  });

  it("only within SPLIT_REMINDER_DAYS of cooking it", async () => {
    await cookOwn(w, RAHUL, { name: "Old" });
    w.clock = new Date(NOW.getTime() + SPLIT_REMINDER_DAYS * DAY_MS);
    expect(await named()).toEqual(["Old → Flat 4B (recent)"]);
    w.clock = new Date(NOW.getTime() + SPLIT_REMINDER_DAYS * DAY_MS + 1);
    expect(await reminders()).toEqual([]);
  });

  it("only where there is a group to split with: none for someone in no group, or only a viewer, or whose groups count in another currency", async () => {
    await cookOwn(w, LONER);
    expect(await reminders(LONER)).toEqual([]);

    const viewer = "usr_viewer";
    w.h.grant(viewer, w.flat, "viewer");
    await cookOwn(w, viewer);
    expect(await reminders(viewer)).toEqual([]);

    const abroad = "usr_abroad";
    const trip = newGroup("Trip");
    w.h.grant(abroad, trip, "owner");
    expect((await w.call("PATCH", groupPath(trip, "settings"), abroad, { currency: "USD" })).status).toBe(200);
    await cookOwn(w, abroad);
    expect(await reminders(abroad)).toEqual([]);
  });

  it("never someone else's dish, nor a dish in a group: one cooked into it, or split", async () => {
    await cookWorkedExample(w, "group");
    await cookOwn(w, ANU, { name: "Anu's" });
    expect(await reminders(RAHUL)).toEqual([]);
    // Anu has never cooked for a group: her first by name.
    expect(await named(ANU)).toEqual(["Anu's → Another flat (recent)"]);

    const dish = await cookOwn(w, RAHUL, { name: "Mine" });
    expect(await named()).toEqual(["Mine → Flat 4B (recent)"]);
    expect((await split(w, RAHUL, dish, { orgId: w.flat.publicId })).status).toBe(200);
    expect(await reminders()).toEqual([]);
  });

  it("stays for a dish its cook marked finalized as just theirs, and goes when it is canceled", async () => {
    const done = await cookOwn(w, RAHUL, { name: "Marked" });
    expect((await w.call("POST", me(`dishes/${done.id}/finalize`), RAHUL)).status).toBe(200);
    expect((await reminders()).map((r) => [r.dish.name, r.dish.state])).toEqual([["Marked", "finalized"]]);
    expect((await w.call("POST", me(`dishes/${done.id}/cancel`), RAHUL)).status).toBe(409);

    const gone = await cookOwn(w, RAHUL, { name: "Gone" });
    expect((await w.call("POST", me(`dishes/${gone.id}/cancel`), RAHUL)).status).toBe(200);
    expect((await reminders()).map((r) => r.dish.name)).toEqual(["Marked"]);
  });

  it("rides beside items and counts, which stay as they were", async () => {
    const dish = await cookOwn(w, RAHUL);
    const data = await inbox(RAHUL);
    // The finalize_dish card a just-for-you draft has always had is still there; the reminder is its own list.
    expect(data.items.map((i) => i.kind)).toEqual(["finalize_dish"]);
    expect(data.counts.total).toBe(1);
    expect(data.splitReminders!.map((r) => r.dish.id)).toEqual([dish.id]);
  });
});

describe("dismissing a reminder", () => {
  it("takes it off Home until restored (the Undo); splitting still works after a dismissal", async () => {
    const dish = await cookOwn(w, RAHUL, { name: "Pasta" });
    const other = await cookOwn(w, RAHUL, { name: "Salad" });
    const res = await dismiss(RAHUL, dish.id);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ dishId: dish.id, dismissed: true, dismissedAt: NOW.toISOString() });
    expect((await reminders()).map((r) => r.dish.name)).toEqual(["Salad"]);
    // Again: still dismissed.
    expect((await dismiss(RAHUL, dish.id)).body.data.dismissed).toBe(true);

    const back = await restore(RAHUL, dish.id);
    expect(back.body.data).toEqual({ dishId: dish.id, dismissed: false, dismissedAt: null });
    expect((await reminders()).map((r) => r.dish.name).sort()).toEqual(["Pasta", "Salad"]);

    expect((await dismiss(RAHUL, other.id)).status).toBe(200);
    expect((await split(w, RAHUL, other, { orgId: w.flat.publicId })).status).toBe(200);
    expect(w.h.db.prepare("SELECT split_dismissed_at FROM kitchen_dishes WHERE split_at IS NOT NULL").get()).toEqual({ split_dismissed_at: null });
  });

  it("is only for the dish's cook: anyone else's, or no dish, is the opaque 404, and changes nothing", async () => {
    const dish = await cookOwn(w, RAHUL);
    for (const as of [ANU, DEV, MEERA]) {
      expect((await dismiss(as, dish.id)).status).toBe(404);
      expect((await restore(as, dish.id)).status).toBe(404);
    }
    expect((await dismiss(RAHUL, "dsh_00000000000000000000000000000000")).status).toBe(404);
    expect((await dismiss(RAHUL, "nope")).status).toBe(404);
    expect((await reminders()).map((r) => r.dish.id)).toEqual([dish.id]);
  });

  it("needs an actor, and only POST", async () => {
    const dish = await cookOwn(w, RAHUL);
    expect((await w.call("POST", me(`dishes/${dish.id}/split-reminder/dismiss`), null)).status).toBe(401);
    expect((await w.call("GET", me(`dishes/${dish.id}/split-reminder/dismiss`), RAHUL)).status).toBe(405);
    expect((await w.call("POST", me(`dishes/${dish.id}/split`), null, { orgId: w.flat.publicId })).status).toBe(401);
    expect((await w.call("GET", me(`dishes/${dish.id}/split`), RAHUL)).status).toBe(405);
  });
});

describe("the suggestion and the servings, as pure functions", () => {
  const g = (name: string, role = "builder"): MemberGroup => ({ orgId: name as Uuid, publicId: `org_${name}`, slug: name, name, role });
  const took = (orgId: string | null, costMinor: number) => ({ orgId, costMinor }) as KitchenDishIngredientRecord;
  const [a, b, c] = [g("a"), g("b"), g("c")];

  it("takes the group it took most from by cost, then by how many items, then the first in order", () => {
    expect(suggestGroup({ ingredients: [took("a", 100), took("b", 300)] }, [a, b, c], null)).toEqual({ group: b, why: "used_items" });
    expect(suggestGroup({ ingredients: [took("a", 100), took("b", 50), took("b", 50)] }, [a, b, c], null)).toEqual({ group: b, why: "used_items" });
    expect(suggestGroup({ ingredients: [took("b", 100), took("a", 100)] }, [a, b, c], null)).toEqual({ group: a, why: "used_items" });
    // Free items still count as taken from there.
    expect(suggestGroup({ ingredients: [took("c", 0), took(null, 900)] }, [a, b, c], null)).toEqual({ group: c, why: "used_items" });
  });

  it("falls back to the group last cooked for, then the first; a group it can't go to doesn't count; nothing without one", () => {
    expect(suggestGroup({ ingredients: [took("x", 500)] }, [a, b], "b")).toEqual({ group: b, why: "recent" });
    expect(suggestGroup({ ingredients: [] }, [a, b], "x")).toEqual({ group: a, why: "recent" });
    expect(suggestGroup({ ingredients: [took("a", 1)] }, [], "a")).toBeNull();
  });

  it("counts servings as portions rounded up, at least one", () => {
    expect([1, 2, 3, 4, 5, 8].map(servingsOf)).toEqual([1, 1, 2, 2, 3, 4]);
  });
});
