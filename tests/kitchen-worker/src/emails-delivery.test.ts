// Cookpool's emails end to end (CP-18): kitchen-worker's enqueues reach the
// REAL notifications-worker — its router's internal-actor gate, validation,
// idempotency, suppression and preferences, its cloudflare-email provider
// and its templates — over the same SQLite database (notifications_* tables
// from 120_notifications_core), with the Email Service binding replaced by
// one that keeps what it was asked to send.

import { route as notificationsRoute } from "@notifications-worker/router";
import type { Env as NotificationsEnv } from "@notifications-worker/env";
import type { CloudflareEmailMessage } from "@notifications-worker/providers/cloudflare-email";
import type { DishResponse, KitchenItem, KitchenItemResponse } from "@saas/contracts/kitchen";
import { runUseSoonSweep } from "@kitchen-worker/sweep";
import { createHarness, envelope, newGroup, type Envelope, type Group, type Harness } from "./harness.js";

const NOW = new Date("2026-11-02T02:30:00.000Z");

const MEERA = "usr_meera";
const ANU = "usr_anu";
const RAHUL = "usr_rahul";

let h: Harness;
let flat: Group;
let outbox: CloudflareEmailMessage[];

beforeEach(() => {
  h = createHarness({ deps: { now: () => NOW } });
  flat = newGroup("Flat 4B");
  h.grant(MEERA, flat, "owner");
  h.grant(ANU, flat, "builder");
  h.grant(RAHUL, flat, "builder");
  h.profile(MEERA, { displayName: "Meera", email: "meera@example.com" });
  h.profile(ANU, { displayName: "Anu", email: "anu@example.com" });
  h.profile(RAHUL, { displayName: "Rahul", email: "rahul@example.com" });

  outbox = [];
  const notificationsEnv: NotificationsEnv = {
    ENVIRONMENT: "test",
    PLATFORM_DB: h.env.PLATFORM_DB!,
    NOTIFICATIONS_PROVIDER: "cloudflare-email",
    EMAIL_FROM_ADDRESS: "no-reply@mail.cookpool.app",
    EMAIL_FROM_NAME: "cookpool",
    EMAIL: {
      async send(message) {
        outbox.push(message);
        return { messageId: `msg_${outbox.length}` };
      },
    },
  };
  h.env.NOTIFICATIONS_WORKER = {
    fetch: (input: RequestInfo | URL, init?: RequestInit) => notificationsRoute(new Request(input, init), notificationsEnv),
    connect() {
      throw new Error("not implemented");
    },
  } as unknown as Fetcher;
});

afterEach(() => h.close());

async function call<T>(method: string, url: string, as: string, body?: unknown, headers?: Record<string, string>) {
  const res = await h.call(method, url, { as, ...(body !== undefined ? { body } : {}), ...(headers ? { headers } : {}) });
  return { status: res.status, body: (await envelope<T>(res)) as Envelope<T> };
}

const groupPath = (g: Group, rest: string) => `/v1/organizations/${g.publicId}/kitchen/${rest}`;

function rows(): Array<{ template_key: string; recipient_address: string; status: string; org_id: string }> {
  return h.db
    .prepare("SELECT template_key, recipient_address, status, org_id FROM notifications_notifications ORDER BY template_key, recipient_address")
    .all()
    .map((r) => ({ ...(r as { template_key: string; recipient_address: string; status: string; org_id: string }) }));
}

describe("kitchen emails through notifications-worker", () => {
  it("sends the day's digest once, rendered, however often the sweep runs", async () => {
    const res = await call<KitchenItemResponse>("POST", "/v1/kitchen/me/items", RAHUL, {
      name: "Milk",
      category: "Dairy",
      quantity: "1",
      unit: "L",
      priceMinor: 6000,
      expiresOn: "2026-11-03",
    });
    expect(res.status).toBe(201);

    expect(await runUseSoonSweep(h.env, { now: () => NOW })).toMatchObject({ people: 1, sent: 1, failed: 0 });
    expect(await runUseSoonSweep(h.env, { now: () => NOW })).toMatchObject({ people: 1, sent: 1, failed: 0 });

    expect(outbox).toHaveLength(1);
    const [mail] = outbox;
    expect(mail!.to).toBe("rahul@example.com");
    expect(mail!.from).toBe("cookpool <no-reply@mail.cookpool.app>");
    expect(mail!.subject).toBe("1 thing to use soon");
    expect(mail!.text).toContain("Milk — My pantry — use by tomorrow");
    expect(mail!.text).toContain("https://cookpool.test/home");
    expect(mail!.html).toContain('href="https://cookpool.test/home"');
    expect(rows()).toEqual([
      { template_key: "kitchen.use_soon", recipient_address: "rahul@example.com", status: "sent", org_id: "00000000-0000-0000-0000-000000000000" },
    ]);
  });

  it("emails a dish posted for claims to the group, and respects a member's opt-out of product email there", async () => {
    // Anu has turned off product email for Flat 4B (the console's notification settings).
    h.db
      .prepare(
        `INSERT INTO notifications_notification_preferences (id, org_id, subject_kind, subject_id, channel, categories)
         VALUES (?, ?, 'user', ?, 'email', ?)`,
      )
      .run("pref_anu", flat.id, ANU, JSON.stringify({ product: false }));

    const rice = await call<KitchenItemResponse>("POST", groupPath(flat, "items"), MEERA, {
      name: "Rice",
      category: "Grains",
      quantity: "1",
      unit: "kg",
      priceMinor: 8000,
    });
    const item: KitchenItem = rice.body.data.item;
    const cooked = await call<DishResponse>(
      "POST",
      "/v1/kitchen/me/dishes",
      MEERA,
      {
        name: "Egg fried rice",
        orgId: flat.publicId,
        portionsHalf: 8,
        splitMode: "claims",
        ingredients: [{ itemId: item.id, quantity: "500", unit: "g" }],
      },
      { "idempotency-key": "cook-once" },
    );
    expect(cooked.status).toBe(201);
    const dish = cooked.body.data.dish;

    expect(outbox.map((m) => m.to)).toEqual(["rahul@example.com"]);
    expect(outbox[0]!.subject).toBe("Meera made Egg fried rice — claim yours");
    expect(outbox[0]!.text).toContain("Meera made Egg fried rice for Flat 4B: 4 portions, ₹40.00 in all.");
    expect(outbox[0]!.html).toContain(`href="https://cookpool.test/dishes/${dish.id}"`);
    expect(rows()).toEqual([
      { template_key: "kitchen.dish_posted", recipient_address: "anu@example.com", status: "suppressed", org_id: flat.id },
      { template_key: "kitchen.dish_posted", recipient_address: "rahul@example.com", status: "sent", org_id: flat.id },
    ]);
  });

  it("emails a use logged for someone else once, however often the request is retried", async () => {
    const milk = await call<KitchenItemResponse>("POST", groupPath(flat, "items"), MEERA, {
      name: "Milk",
      category: "Dairy",
      quantity: "1",
      unit: "L",
      priceMinor: 6000,
    });
    const use = () =>
      call("POST", groupPath(flat, `items/${milk.body.data.item.id}/uses`), ANU, { quantity: "250", unit: "ml", consumers: [ANU, RAHUL] }, {
        "idempotency-key": "use-once",
      });
    expect((await use()).status).toBe(201);
    expect((await use()).status).toBe(201);

    expect(outbox).toHaveLength(1);
    expect(outbox[0]!.to).toBe("rahul@example.com");
    expect(outbox[0]!.subject).toBe("Anu logged 250 ml of Milk for you");
    expect(outbox[0]!.text).toContain("Your share: ₹7.50.");
    expect(outbox[0]!.html).toContain(`href="https://cookpool.test/groups/${flat.slug}"`);
    expect(rows()).toHaveLength(1);
  });
});
