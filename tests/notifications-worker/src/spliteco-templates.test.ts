// Spliteco's notifications (cookpool-spliteco SE-3, SE-6): spliteco.reminder,
// spliteco.paid_you and spliteco.expense_for_you render an email and a push in Spliteco's voice, link only
// over http(s), escape what they substitute, and notifications-worker takes
// them from spliteco-worker.

import crypto from "node:crypto";
import { route } from "@notifications-worker/router";
import { renderEmailTemplate } from "@notifications-worker/templates/index";
import { renderPushMessage } from "@notifications-worker/templates/push";
import type { Env } from "@notifications-worker/env";
import { SPLITECO_EMAILS, type SplitecoExpenseForYouEmail, type SplitecoPaidYouEmail, type SplitecoReminderEmail } from "@saas/contracts/spliteco";

if (!(globalThis as Record<string, unknown>).crypto) {
  (globalThis as Record<string, unknown>).crypto = crypto;
}

const reminder: SplitecoReminderEmail = {
  fromName: "Anu",
  amount: "₹620.00",
  groupName: "Goa Trip",
  payUrl: "https://spliteco.test/settle?group=org_1&to=usr_anu",
};

const paid: SplitecoPaidYouEmail = {
  payerName: "Dev",
  amount: "₹400.00",
  method: "UPI",
  groupName: "Goa Trip",
  personUrl: "https://spliteco.test/friend?id=usr_dev",
};

describe("spliteco.reminder", () => {
  it("says who nudged you, how much and where, and links to Settle up", () => {
    const email = renderEmailTemplate(SPLITECO_EMAILS.REMINDER, reminder, { brandName: "Cookpool" })!;
    expect(email.subject).toBe("Anu sent a friendly nudge: ₹620.00");
    expect(email.text).toBe(
      [
        "Anu says you owe ₹620.00 in Goa Trip.",
        "One tap to settle up by UPI, cash or bank. No rush.",
        "",
        "https://spliteco.test/settle?group=org_1&to=usr_anu",
        "",
        "You get this when someone you owe in Goa Trip sends a reminder — at most once a day.",
      ].join("\n"),
    );
    expect(email.html).toContain('href="https://spliteco.test/settle?group=org_1&amp;to=usr_anu"');
    expect(email.html).toContain("Settle up</a>");
    expect(email.html).toContain("Sent by Spliteco.");
  });

  it("pushes one line titled Spliteco, opening Settle up in the app", () => {
    expect(renderPushMessage(SPLITECO_EMAILS.REMINDER, reminder, "spliteco.reminder:rmd_1:usr_me")).toEqual({
      kind: "spliteco.reminder",
      title: "Spliteco",
      body: "Anu sent a friendly nudge: ₹620.00 · Goa Trip",
      url: "/settle?group=org_1&to=usr_anu",
      tag: "spliteco.reminder:rmd_1:usr_me",
    });
  });
});

describe("spliteco.paid_you", () => {
  it("says who paid you how much and how, and where to say it never came", () => {
    const email = renderEmailTemplate(SPLITECO_EMAILS.PAID_YOU, paid)!;
    expect(email.subject).toBe("Dev paid you ₹400.00 · UPI");
    expect(email.text).toContain('Didn\'t get it? Mark it "Not received" and it comes off.');
    expect(email.html).toContain('href="https://spliteco.test/friend?id=usr_dev"');
    expect(renderPushMessage(SPLITECO_EMAILS.PAID_YOU, paid, "t")).toMatchObject({ title: "Spliteco", body: "Dev paid you ₹400.00 · UPI", url: "/friend?id=usr_dev" });
  });

  it("leaves out what is missing, escapes what it substitutes and keeps the subject to one line", () => {
    const bare = renderEmailTemplate(SPLITECO_EMAILS.PAID_YOU, { ...paid, payerName: null, method: null, personUrl: "" })!;
    expect(bare.subject).toBe("Someone paid you ₹400.00");
    expect(bare.html).not.toContain("href=");
    const hostile = renderEmailTemplate(SPLITECO_EMAILS.REMINDER, {
      ...reminder,
      fromName: "Anu\r\nBcc: everyone@example.com",
      groupName: "<script>x</script>",
      payUrl: "javascript:alert(1)",
    })!;
    expect(hostile.subject).not.toMatch(/[\r\n]/);
    expect(hostile.html).not.toContain("<script>");
    expect(hostile.html).not.toContain("javascript:");
    expect(renderPushMessage(SPLITECO_EMAILS.REMINDER, { ...reminder, payUrl: "javascript:alert(1)" }, "t")!.url).toBe("/");
  });
});

const changed: SplitecoExpenseForYouEmail = {
  actorName: "Anu via Claude",
  change: "added",
  title: "Sunset cruise",
  amount: "₹3,200.00",
  groupName: "Goa Trip",
  fromGroupName: null,
  yourShare: "₹800.00",
  expenseUrl: "https://spliteco.test/expense?id=txn_1",
};

describe("spliteco.expense_for_you (SE-6)", () => {
  it("says who did what, the total, where and your share, and links to the expense", () => {
    const email = renderEmailTemplate(SPLITECO_EMAILS.EXPENSE_FOR_YOU, changed)!;
    expect(email.subject).toBe("Anu via Claude added “Sunset cruise” · ₹3,200.00");
    expect(email.text).toBe(
      [
        "In Goa Trip: Anu via Claude added “Sunset cruise” (₹3,200.00).",
        "Your share is ₹800.00.",
        "",
        "https://spliteco.test/expense?id=txn_1",
        "",
        "You get this when an expense you're on changes in Goa Trip.",
      ].join("\n"),
    );
    expect(email.html).toContain('href="https://spliteco.test/expense?id=txn_1"');
    expect(email.html).toContain("See the expense</a>");
    expect(email.html).toContain("Sent by Spliteco.");
  });

  it("pushes one line titled Spliteco, opening the expense", () => {
    expect(renderPushMessage(SPLITECO_EMAILS.EXPENSE_FOR_YOU, changed, "spliteco.expense_for_you:txn_1:usr_me")).toEqual({
      kind: "spliteco.expense_for_you",
      title: "Spliteco",
      body: "Anu via Claude added “Sunset cruise” ₹3,200.00 · Goa Trip",
      url: "/expense?id=txn_1",
      tag: "spliteco.expense_for_you:txn_1:usr_me",
    });
  });

  it.each([
    ["edited", { yourShare: "₹1,066.67" }, "Anu via Claude changed “Sunset cruise”", "Your share is ₹1,066.67."],
    ["edited", { yourShare: null }, "Anu via Claude changed “Sunset cruise”", "You're no longer on it."],
    ["deleted", { yourShare: null }, "Anu via Claude deleted “Sunset cruise”", "It no longer counts toward your balance. It can be restored for 30 days."],
    ["restored", {}, "Anu via Claude restored “Sunset cruise”", "Your share is ₹800.00."],
    ["moved", { groupName: "Flat 4B", fromGroupName: "Goa Trip" }, "Anu via Claude moved “Sunset cruise” to Flat 4B", "Your share is ₹800.00."],
  ] as const)("%s reads as it happened", (change, over, did, yours) => {
    const data = { ...changed, change, ...over };
    const email = renderEmailTemplate(SPLITECO_EMAILS.EXPENSE_FOR_YOU, data)!;
    expect(email.subject).toBe(`${did} · ₹3,200.00`);
    expect(email.text.split("\n")[1]).toBe(yours);
    if (change === "moved") expect(email.text).toMatch(/^From Goa Trip to Flat 4B: /);
    expect(renderPushMessage(SPLITECO_EMAILS.EXPENSE_FOR_YOU, data, "t")!.body).toBe(change === "moved" ? `${did} ₹3,200.00` : `${did} ₹3,200.00 · Goa Trip`);
  });

  it("says Someone without a name, escapes what it substitutes and links only over http(s)", () => {
    expect(renderEmailTemplate(SPLITECO_EMAILS.EXPENSE_FOR_YOU, { ...changed, actorName: null })!.subject).toBe("Someone added “Sunset cruise” · ₹3,200.00");
    const hostile = renderEmailTemplate(SPLITECO_EMAILS.EXPENSE_FOR_YOU, { ...changed, actorName: "Anu\r\nBcc: x@y.z", title: "<img src=x>", expenseUrl: "javascript:alert(1)" })!;
    expect(hostile.subject).not.toMatch(/[\r\n]/);
    expect(hostile.html).not.toContain("<img");
    expect(hostile.html).not.toContain("javascript:");
    expect(renderPushMessage(SPLITECO_EMAILS.EXPENSE_FOR_YOU, { ...changed, expenseUrl: "javascript:alert(1)" }, "t")!.url).toBe("/");
  });
});

describe("the internal-actor gate", () => {
  it("lets spliteco-worker enqueue", async () => {
    const env: Env = { ENVIRONMENT: "test", NOTIFICATIONS_PROVIDER: "local-debug" };
    const res = await route(
      new Request("http://nf/v1/notifications", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-internal-actor": "spliteco-worker",
          "x-actor-subject-id": "usr_anu",
          "x-actor-subject-type": "user",
        },
        body: JSON.stringify({
          orgId: "00000000-0000-0000-0000-000000000000",
          category: "product",
          templateKey: SPLITECO_EMAILS.REMINDER,
          templateData: reminder,
          recipient: { channel: "email", address: "x@y.com" },
        }),
      }),
      env,
    );
    // Past the gate: without a database the handler answers 503, not 403.
    expect(res.status).toBe(503);
  });
});
