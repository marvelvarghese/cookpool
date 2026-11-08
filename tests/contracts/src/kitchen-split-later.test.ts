// Cooked, then split later (Cookpool CM-8, cookpool-community design §2a):
// the split request and its refusal reason, the audit event's name, the
// split reminder's rules and shape — riding beside `items`, never one of its
// kinds — all through `@saas/contracts/kitchen`.

import {
  INBOX_KINDS,
  KITCHEN_DISH_SPLIT_EVENT,
  KITCHEN_ERROR_REASONS,
  KITCHEN_SPLIT_ERROR_REASONS,
  SPLIT_REMINDERS_MAX,
  SPLIT_REMINDER_DAYS,
  SPLIT_REMINDER_MIN_PORTIONS_HALF,
  SPLIT_SUGGEST_REASONS,
  type InboxResponse,
  type KitchenDish,
  type SplitDishRequest,
  type SplitReminderInboxItem,
} from "@saas/contracts/kitchen";

describe("splitting later (CM-8)", () => {
  it("takes a group and, optionally, how it splits; refuses a dish in a group already as already_split", () => {
    const body: SplitDishRequest = { orgId: "org_1" };
    expect(body.splitMode).toBeUndefined();
    expect(KITCHEN_SPLIT_ERROR_REASONS).toEqual({ ALREADY_SPLIT: "already_split" });
    // A new reason, not one the kitchen already had.
    expect(Object.values(KITCHEN_ERROR_REASONS)).not.toContain("already_split");
    expect(KITCHEN_DISH_SPLIT_EVENT).toBe("kitchen.dish.split");
    const dish: Pick<KitchenDish, "splitAt"> = { splitAt: null };
    expect(dish.splitAt).toBeNull();
  });

  it("reminds for a week, from two servings (or any group item), at most ten, naming why the group", () => {
    expect([SPLIT_REMINDER_DAYS, SPLIT_REMINDER_MIN_PORTIONS_HALF, SPLIT_REMINDERS_MAX]).toEqual([7, 4, 10]);
    expect(SPLIT_SUGGEST_REASONS).toEqual(["used_items", "recent"]);
  });

  it("rides in its own list beside `items`, so a console that knows only today's kinds reads the answer as before", () => {
    expect(INBOX_KINDS).not.toContain("split_reminder");
    const reminder: SplitReminderInboxItem = {
      kind: "split_reminder",
      dish: { id: "dsh_1", name: "Dal", portionsHalf: 4, totalMinor: 4000, currency: "INR", cookedAt: "2026-11-02T12:00:00.000Z", state: "draft", groupItems: 0 },
      suggest: { orgId: "org_1", groupName: "Flat 4B", groupSlug: "flat-4b", why: "recent" },
    };
    const inbox: InboxResponse = {
      items: [],
      counts: { total: 0, claim_dish: 0, finalize_dish: 0, use_soon: 0, payment_due: 0, flag: 0 },
      splitReminders: [reminder],
    };
    expect(inbox.counts.total).toBe(0);
    expect(inbox.splitReminders).toHaveLength(1);
  });
});
