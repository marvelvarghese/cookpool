import type { InboxItem, InboxKind, InboxResponse, SubjectBalanceResponse } from "@saas/contracts/kitchen";
import {
  INBOX_EXPIRED_DAYS,
  INBOX_KINDS,
  INBOX_USE_SOON_DAYS,
  INBOX_USE_SOON_MAX,
  KITCHEN_ERROR_REASONS,
  KITCHEN_INTERNAL_ACTORS,
  KITCHEN_INTERNAL_ACTOR_HEADER,
  USE_SOON_EMAIL_DAYS,
} from "@saas/contracts/kitchen";
import { ERROR_CODES } from "@saas/contracts/errors";

describe("contracts: Home's inbox (Cookpool CP-19)", () => {
  it("names five kinds of card", () => {
    expect(INBOX_KINDS).toEqual(["claim_dish", "finalize_dish", "use_soon", "payment_due", "flag"]);
    const kind: InboxKind = "payment_due";
    expect(INBOX_KINDS).toContain(kind);
  });

  it("looks two days either side of the use-by date, as the daily digest does ahead, and lists at most ten", () => {
    expect(INBOX_USE_SOON_DAYS).toBe(USE_SOON_EMAIL_DAYS);
    expect(INBOX_USE_SOON_DAYS).toBe(2);
    expect(INBOX_EXPIRED_DAYS).toBe(2);
    expect(INBOX_USE_SOON_MAX).toBe(10);
  });

  it("types GET /v1/kitchen/me/inbox: every card with what its one-tap action needs, and the counts", () => {
    const dish = {
      id: "dsh_1",
      orgId: "org_1",
      groupName: "Flat 4B",
      groupSlug: "flat-4b",
      name: "Egg fried rice",
      cook: "usr_anu",
      cookName: "Anu",
      state: "open" as const,
      splitMode: "claims" as const,
      portionsHalf: 8,
      claimedHalf: 2,
      unclaimedHalf: 6,
      perPortionMinor: 5275,
      totalMinor: 21100,
      currency: "INR",
      cookedAt: "2026-11-02T12:00:00.000Z",
    };
    const items: InboxItem[] = [
      {
        kind: "use_soon",
        item: {
          id: "itm_1",
          ref: "org:org_1:itm_1",
          name: "Tomatoes",
          pantry: { kind: "group", orgId: "org_1", slug: "flat-4b", name: "Flat 4B" },
          orgId: "org_1",
          qtyLeftMilli: 750_000,
          quantity: 0.75,
          unit: "kg",
          expiresOn: "2026-11-02",
          daysToUseBy: 0,
          canUse: true,
        },
        usual: { quantity: 250, unit: "g", qtyMilli: 250_000 },
      },
      { kind: "claim_dish", dish },
      { kind: "finalize_dish", dish: { ...dish, cook: "usr_rahul", orgId: null, groupName: null, groupSlug: null, state: "draft", splitMode: "assign" } },
      {
        kind: "payment_due",
        orgId: "org_1",
        groupName: "Flat 4B",
        groupSlug: "flat-4b",
        toSubjectId: "usr_anu",
        toName: "Anu",
        amountMinor: 1400,
        currency: "INR",
        canRecord: true,
      },
      {
        kind: "flag",
        flagId: "flg_1",
        txnId: "txn_1",
        orgId: "org_1",
        groupName: "Flat 4B",
        groupSlug: "flat-4b",
        title: "Milk run",
        txnKind: "expense",
        totalMinor: 900,
        currency: "INR",
        dishId: null,
        flaggedBy: "usr_dev",
        flaggedByName: null,
        reason: "I wasn't there",
        flaggedAt: "2026-11-02T12:00:00.000Z",
      },
    ];
    const inbox: InboxResponse = {
      items,
      counts: { total: 5, claim_dish: 1, finalize_dish: 1, use_soon: 1, payment_due: 1, flag: 1 },
    };
    expect(Object.keys(inbox.counts).sort()).toEqual([...INBOX_KINDS, "total"].sort());
    expect(inbox.items.map((i) => i.kind)).toEqual(["use_soon", "claim_dish", "finalize_dish", "payment_due", "flag"]);
  });
});

describe("contracts: leaving a group with a balance (Cookpool CP-19)", () => {
  it("refuses on an existing error code, with a reason", () => {
    expect(KITCHEN_ERROR_REASONS.BALANCE_NOT_SETTLED).toBe("balance_not_settled");
    expect(Object.values(ERROR_CODES)).toContain("conflict");
    expect(Object.values(ERROR_CODES)).not.toContain("balance_not_settled");
  });

  it("types the internal balance answer, and names its only caller", () => {
    // Both of a kitchen group's balances (cookpool-spliteco SE3): Kitchen, and Other.
    const balance: SubjectBalanceResponse = { balanceMinor: -1250, otherMinor: 0, currency: "INR" };
    expect(balance.balanceMinor).toBeLessThan(0);
    expect(KITCHEN_INTERNAL_ACTOR_HEADER).toBe("x-internal-actor");
    expect(KITCHEN_INTERNAL_ACTORS).toEqual(["membership-worker"]);
  });
});
