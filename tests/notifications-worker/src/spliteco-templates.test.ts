// Spliteco's notifications (cookpool-spliteco SE-3): spliteco.reminder and
// spliteco.paid_you render an email and a push in Spliteco's voice, link only
// over http(s), escape what they substitute, and notifications-worker takes
// them from spliteco-worker.

import crypto from "node:crypto";
import { route } from "@notifications-worker/router";
import { renderEmailTemplate } from "@notifications-worker/templates/index";
import { renderPushMessage } from "@notifications-worker/templates/push";
import type { Env } from "@notifications-worker/env";
import { SPLITECO_EMAILS, type SplitecoPaidYouEmail, type SplitecoReminderEmail } from "@saas/contracts/spliteco";

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
