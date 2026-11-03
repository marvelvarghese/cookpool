// Cookpool's kitchen email templates (CP-18): kitchen.use_soon,
// kitchen.dish_posted and kitchen.logged_for_you render a subject, text and
// HTML in the app's voice, link into the app only over http(s), escape
// everything they substitute, and keep subjects to one line. And
// notifications-worker's internal-actor gate lets kitchen-worker in.

import crypto from "node:crypto";
import { route } from "@notifications-worker/router";
import { renderEmailTemplate, useByPhrase } from "@notifications-worker/templates/index";
import type { Env } from "@notifications-worker/env";
import {
  KITCHEN_EMAILS,
  USE_SOON_EMAIL_MAX_ITEMS,
  useSoonEmailData,
  type DishPostedEmail,
  type LoggedForYouEmail,
} from "@saas/contracts/kitchen";
import { NOTIFICATIONS_INTERNAL_ACTOR_VALUES } from "@saas/contracts/notifications";

if (!(globalThis as Record<string, unknown>).crypto) {
  (globalThis as Record<string, unknown>).crypto = crypto;
}

const digest = useSoonEmailData({
  recipientName: "Rahul",
  date: "2026-11-02",
  count: 3,
  items: [
    { name: "Milk", pantry: "My pantry", useBy: "2026-11-02" },
    { name: "Tomatoes", pantry: "Flat 4B", useBy: "2026-11-03" },
    { name: "Paneer", pantry: "Flat 4B", useBy: "2026-11-04" },
  ],
  homeUrl: "https://stage.cookpool.store/home",
});

const dish: DishPostedEmail = {
  cookName: "Meera",
  dishName: "egg fried rice",
  groupName: "Flat 4B",
  portions: "4½",
  total: "₹240.00",
  dishUrl: "https://stage.cookpool.store/dishes/dsh_0123",
};

const logged: LoggedForYouEmail = {
  kind: "use",
  actorName: "Anu",
  what: "250 ml of milk",
  groupName: "Flat 4B",
  total: "₹15.00",
  yourShare: "₹7.50",
  youPaid: null,
  groupUrl: "https://stage.cookpool.store/groups/flat-4b",
};

describe("kitchen.use_soon", () => {
  it("lists what to use soon, soonest first, with a link Home", () => {
    const email = renderEmailTemplate(KITCHEN_EMAILS.USE_SOON, digest, { brandName: "cookpool" })!;
    expect(email.subject).toBe("3 things to use soon");
    expect(email.text).toBe(
      [
        "Hi Rahul,",
        "",
        "These are close to their use-by date:",
        "",
        "• Milk — My pantry — use by today",
        "• Tomatoes — Flat 4B — use by tomorrow",
        "• Paneer — Flat 4B — use by Wed 4 Nov",
        "",
        "Use them before they go: https://stage.cookpool.store/home",
        "",
        "You get this once a day when something you can use is close to its use-by date.",
      ].join("\n"),
    );
    expect(email.html).toContain("<li style=\"margin:0 0 6px;\">Milk — My pantry — use by today</li>");
    expect(email.html).toContain('href="https://stage.cookpool.store/home"');
    expect(email.html).toContain("Sent by cookpool.");
  });

  it("says one thing in the singular, and counts what it does not list", () => {
    const one = renderEmailTemplate(
      KITCHEN_EMAILS.USE_SOON,
      useSoonEmailData({ recipientName: null, date: "2026-11-02", count: 1, items: [{ name: "Milk", pantry: "My pantry", useBy: "2026-11-03" }], homeUrl: "" }),
    )!;
    expect(one.subject).toBe("1 thing to use soon");
    expect(one.text).toContain("Hi,\n\nThis is close to its use-by date:");
    expect(one.html).not.toContain("href=");

    const items = Array.from({ length: 14 }, (_, i) => ({ name: `Item ${i + 1}`, pantry: "My pantry", useBy: "2026-11-04" }));
    const many = renderEmailTemplate(
      KITCHEN_EMAILS.USE_SOON,
      useSoonEmailData({ recipientName: "Rahul", date: "2026-11-02", count: 14, items, homeUrl: "https://stage.cookpool.store/home" }),
    )!;
    expect(many.subject).toBe("14 things to use soon");
    expect(many.text.match(/^• /gm)).toHaveLength(USE_SOON_EMAIL_MAX_ITEMS);
    expect(many.text).toContain("…and 4 more.");
  });

  it("says when to use something by from the digest's day", () => {
    expect(useByPhrase("2026-11-02", "2026-11-02")).toBe("today");
    expect(useByPhrase("2026-11-03", "2026-11-02")).toBe("tomorrow");
    expect(useByPhrase("2026-11-04", "2026-11-02")).toBe("Wed 4 Nov");
    expect(useByPhrase("not a date", "2026-11-02")).toBe("not a date");
  });
});

describe("kitchen.dish_posted", () => {
  it("names the cook and the dish, and links to claim", () => {
    const email = renderEmailTemplate(KITCHEN_EMAILS.DISH_POSTED, dish)!;
    expect(email.subject).toBe("Meera made egg fried rice — claim yours");
    expect(email.text).toContain("Meera made egg fried rice for Flat 4B: 4½ portions, ₹240.00 in all.");
    expect(email.text).toContain("Claim yours: https://stage.cookpool.store/dishes/dsh_0123");
    expect(email.html).toContain('href="https://stage.cookpool.store/dishes/dsh_0123"');
    expect(renderEmailTemplate(KITCHEN_EMAILS.DISH_POSTED, { ...dish, portions: "1" })!.text).toContain(": 1 portion, ");
  });

  it("falls back to plain words when the cook has no name", () => {
    const email = renderEmailTemplate(KITCHEN_EMAILS.DISH_POSTED, { ...dish, cookName: null })!;
    expect(email.subject).toBe("Someone made egg fried rice — claim yours");
  });
});

describe("kitchen.logged_for_you", () => {
  it("says who logged what, and the recipient's share, for a use", () => {
    const email = renderEmailTemplate(KITCHEN_EMAILS.LOGGED_FOR_YOU, logged)!;
    expect(email.subject).toBe("Anu logged 250 ml of milk for you");
    expect(email.text).toContain("In Flat 4B: 250 ml of milk, ₹15.00 in all.");
    expect(email.text).toContain("Your share: ₹7.50.");
    expect(email.text).not.toContain("You paid");
    expect(email.html).toContain('href="https://stage.cookpool.store/groups/flat-4b"');
  });

  it("says what the recipient paid, for an expense", () => {
    const email = renderEmailTemplate(KITCHEN_EMAILS.LOGGED_FOR_YOU, {
      ...logged,
      kind: "expense",
      actorName: "Rahul",
      what: "Groceries",
      total: "₹600.00",
      yourShare: null,
      youPaid: "₹600.00",
    })!;
    expect(email.subject).toBe("Rahul logged Groceries for you");
    expect(email.text).toContain("You paid: ₹600.00.");
    expect(email.text).toContain("logs an expense that names you");
  });
});

describe("what a kitchen template substitutes", () => {
  it("is escaped in the HTML, kept to one line in the subject, and never links anything but http(s)", () => {
    const email = renderEmailTemplate(KITCHEN_EMAILS.DISH_POSTED, {
      ...dish,
      cookName: "Meera\r\nBcc: everyone@example.com",
      dishName: "<script>alert(1)</script>",
      dishUrl: "javascript:alert(1)",
    })!;
    expect(email.subject).not.toMatch(/[\r\n]/);
    expect(email.subject).toBe("Meera Bcc: everyone@example.com made <script>alert(1)</script> — claim yours");
    expect(email.html).not.toContain("<script>");
    expect(email.html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(email.html).not.toContain("javascript:");
    expect(email.text).not.toContain("javascript:");

    const digestEmail = renderEmailTemplate(
      KITCHEN_EMAILS.USE_SOON,
      useSoonEmailData({
        recipientName: "R",
        date: "2026-11-02",
        count: 1,
        items: [{ name: "<b>Milk</b>", pantry: "My pantry", useBy: "2026-11-02" }],
        homeUrl: "data:text/html,hi",
      }),
    )!;
    expect(digestEmail.html).toContain("&lt;b&gt;Milk&lt;/b&gt;");
    expect(digestEmail.html).not.toContain("href=");
  });
});

describe("the internal-actor gate", () => {
  it("lets kitchen-worker enqueue", async () => {
    expect(NOTIFICATIONS_INTERNAL_ACTOR_VALUES).toContain("kitchen-worker");
    const env: Env = { ENVIRONMENT: "test", NOTIFICATIONS_PROVIDER: "local-debug" };
    const res = await route(
      new Request("http://nf/v1/notifications", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-internal-actor": "kitchen-worker",
          "x-actor-subject-id": "kitchen-worker",
          "x-actor-subject-type": "system",
        },
        body: JSON.stringify({
          orgId: "00000000-0000-0000-0000-000000000000",
          category: "product",
          templateKey: KITCHEN_EMAILS.USE_SOON,
          recipient: { channel: "email", address: "x@y.com" },
        }),
      }),
      env,
    );
    // Past the gate: without a database the handler answers 503, not 403.
    expect(res.status).toBe(503);
  });
});
