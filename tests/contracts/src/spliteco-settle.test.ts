// Spliteco SE2 (SE-3) in the contract: the payment methods, the refusals,
// the reminder window, the UPI ID format, and the two notification kinds that
// notifications-worker takes from spliteco-worker.

import {
  NOTIFICATIONS_INTERNAL_ACTOR_VALUES,
  NOTIFICATION_KINDS,
  PUSH_ONLY_KINDS,
  PUSH_TO_SUBJECT_KINDS,
  isNotificationKind,
} from "@saas/contracts/notifications";
import {
  SPLITECO_EMAILS,
  SPLITECO_ERROR_REASONS,
  SPLITECO_PAYMENT_METHODS,
  SPLITECO_REMINDER_HOURS,
  isUpiVpa,
} from "@saas/contracts/spliteco";
import { SETTLEMENT_METHODS } from "@saas/contracts/kitchen";
import type { SplitecoReceivedPaymentRequest, SplitecoReceivedPaymentResponse } from "@saas/contracts/spliteco";

describe("spliteco settle up (SE2)", () => {
  it("records UPI, cash or bank — Cookpool's methods without `other`", () => {
    expect(SPLITECO_PAYMENT_METHODS).toEqual(["upi", "cash", "bank"]);
    for (const m of SPLITECO_PAYMENT_METHODS) expect(SETTLEMENT_METHODS).toContain(m);
  });

  it("names the refusals the routes answer with", () => {
    expect(SPLITECO_ERROR_REASONS).toMatchObject({
      OVER_SETTLED: "over_settled",
      NOTHING_OWED: "nothing_owed",
      SPLIT_MISMATCH: "split_mismatch",
      NOT_THE_PAYEE: "not_the_payee",
      NOT_A_SETTLEMENT: "not_a_settlement",
      ALREADY_REVERSED: "already_reversed",
      REMINDED_RECENTLY: "reminded_recently",
      NOT_FROM_AN_ASSISTANT: "not_from_an_assistant",
      SAME_PERSON: "same_person",
    });
    expect(new Set(Object.values(SPLITECO_ERROR_REASONS)).size).toBe(Object.values(SPLITECO_ERROR_REASONS).length);
  });

  it("allows one reminder per pair per 24 hours", () => {
    expect(SPLITECO_REMINDER_HOURS).toBe(24);
  });

  it("reads a UPI ID as handle@bank", () => {
    for (const ok of ["devk@okaxis", "98100.12345@ybl", "anu_s-1@paytm", "Meera.R@oksbi"]) expect([ok, isUpiVpa(ok)]).toEqual([ok, true]);
    for (const bad of ["", "devk", "devk@", "@okaxis", "d@okaxis", "dev k@okaxis", "devk@ok.axis", "devk@1bank", "a@b@c", `${"a".repeat(65)}@okaxis`, null, 42]) {
      expect([bad, isUpiVpa(bad)]).toEqual([bad, false]);
    }
  });

  it("adds spliteco.reminder and spliteco.paid_you as notification kinds, sent by email with push riding along", () => {
    // …and (SE5) spliteco.expense_for_you.
    expect(SPLITECO_EMAILS).toEqual({ REMINDER: "spliteco.reminder", PAID_YOU: "spliteco.paid_you", EXPENSE_FOR_YOU: "spliteco.expense_for_you" });
    for (const kind of Object.values(SPLITECO_EMAILS)) {
      expect(isNotificationKind(kind)).toBe(true);
      expect(NOTIFICATION_KINDS).toContain(kind);
      // Not push-only (they are emailed too), and never a push-to-subject kind.
      expect(PUSH_ONLY_KINDS as readonly string[]).not.toContain(kind);
      expect(PUSH_TO_SUBJECT_KINDS as readonly string[]).not.toContain(kind);
    }
    expect(NOTIFICATIONS_INTERNAL_ACTOR_VALUES).toContain("spliteco-worker");
  });
});

describe("a payment received (MY-16)", () => {
  it("takes who paid and how much, and answers one payment per group", () => {
    const body: SplitecoReceivedPaymentRequest = { fromSubjectId: "usr_a", amountMinor: 100, currency: "INR", method: "cash", bucket: "kitchen" };
    const minimal: SplitecoReceivedPaymentRequest = { fromSubjectId: "usr_a", amountMinor: 100 };
    const answer: SplitecoReceivedPaymentResponse = { fromSubjectId: "usr_a", amountMinor: 100, currency: "INR", payments: [] };
    expect([body.method, minimal.method, answer.payments]).toEqual(["cash", undefined, []]);
    expect(SPLITECO_PAYMENT_METHODS).toContain(body.method);
  });
});
