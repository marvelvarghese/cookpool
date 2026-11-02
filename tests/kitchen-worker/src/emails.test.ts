// Cookpool's emails (CP-18): the daily use-soon sweep — scheduled(), its
// window, one digest per person per day, idempotent on re-run, /health — and
// the two event emails, a dish posted for claims and a use or expense logged
// for someone else, enqueued once per transaction after the write commits.
// Through the router and the worker's entry, against real SQLite and the real
// policy grants; notifications-worker's enqueue route is the harness's
// recorder here, and the real worker in emails-delivery.test.ts.

import { readUseSoonEmail, type KitchenEmailData } from "@saas/contracts/kitchen";
import type { DishResponse, KitchenItem, KitchenItemResponse, KitchenTxn, StockMoveResponse } from "@saas/contracts/kitchen";
import type { OrganizationRole } from "@saas/contracts/policy";
import { authorize } from "@saas/policy-engine";
import worker from "@kitchen-worker/index";
import { CLAIM_ROLES, appLink, formatPortions } from "@kitchen-worker/emails";
import { SWEEP_MAX_ITEMS, runUseSoonSweep } from "@kitchen-worker/sweep";
import type { Env } from "@kitchen-worker/env";
import { createHarness, envelope, newGroup, type Envelope, type Group, type Harness, type RecordedNotification } from "./harness.js";

const NOW = new Date("2026-11-02T08:00:00.000Z");
const TODAY = "2026-11-02";
const DAY = 86_400_000;

const RAHUL = "usr_rahul"; // owner of Flat 4B, a viewer in the Lunch club
const ADMIN = "usr_admin";
const MEERA = "usr_meera";
const ANU = "usr_anu"; // member of Flat 4B, owner of the Lunch club
const VIEWER = "usr_viewer";
const KIRAN = "usr_kiran"; // the Lunch club only
const NOMAIL = "usr_nomail"; // identity does not know them

let h: Harness;
let clock: Date;
let flat: Group;
let lunch: Group;

beforeEach(() => {
  clock = NOW;
  h = createHarness({ deps: { now: () => clock } });
  flat = newGroup("Flat 4B");
  lunch = newGroup("Lunch club");
  h.grant(RAHUL, flat, "owner");
  h.grant(ADMIN, flat, "admin");
  h.grant(MEERA, flat, "builder");
  h.grant(ANU, flat, "builder");
  h.grant(VIEWER, flat, "viewer");
  h.grant(ANU, lunch, "owner");
  h.grant(KIRAN, lunch, "builder");
  h.grant(RAHUL, lunch, "viewer");
  h.profile(RAHUL, { displayName: "Rahul", email: "rahul@example.com" });
  h.profile(ADMIN, { displayName: null, email: "admin.person@example.com" });
  h.profile(MEERA, { displayName: "Meera", email: "Meera@Example.com" });
  h.profile(ANU, { displayName: "Anu", email: "anu@example.com" });
  h.profile(VIEWER, { displayName: "Vee", email: "vee@example.com" });
  h.profile(KIRAN, { displayName: "Kiran", email: "kiran@example.com" });
});

afterEach(() => h.close());

async function call<T>(
  method: string,
  url: string,
  as: string | null,
  body?: unknown,
  headers?: Record<string, string>,
): Promise<{ status: number; body: Envelope<T> }> {
  const res = await h.call(method, url, { as, ...(body !== undefined ? { body } : {}), ...(headers ? { headers } : {}) });
  return { status: res.status, body: await envelope<T>(res) };
}

const me = (rest: string) => `/v1/kitchen/me/${rest}`;
const groupPath = (g: Group, rest: string) => `/v1/organizations/${g.publicId}/kitchen/${rest}`;

function item(name: string, expiresOn: string | null, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { name, category: "Food", quantity: "1", unit: "L", priceMinor: 6000, boughtOn: "2026-10-30", expiresOn, ...extra };
}

async function myItem(as: string, body: Record<string, unknown>): Promise<KitchenItem> {
  const res = await call<KitchenItemResponse>("POST", me("items"), as, body);
  expect(res.status).toBe(201);
  return res.body.data.item;
}

async function groupItem(as: string, g: Group, body: Record<string, unknown>): Promise<KitchenItem> {
  const res = await call<KitchenItemResponse>("POST", groupPath(g, "items"), as, body);
  expect(res.status).toBe(201);
  return res.body.data.item;
}

const sent = (template: string): RecordedNotification[] => h.notifications.filter((n) => n.request.templateKey === template);
const firstSends = (template: string): RecordedNotification[] => sent(template).filter((n) => !n.replayed);
const to = (n: RecordedNotification) => n.request.recipient.subjectId;

/** A pantry of things, some close to their use-by date and some not, across every kind of pantry. */
async function stockUp(): Promise<void> {
  await myItem(RAHUL, item("Milk", TODAY)); // in
  await myItem(RAHUL, item("Bread", "2026-11-05")); // three days out: not yet
  await myItem(RAHUL, item("Oats", null)); // no use-by date
  await myItem(RAHUL, item("Yogurt", "2026-11-01")); // already past it
  await groupItem(MEERA, flat, item("Tomatoes", "2026-11-03"));
  await groupItem(MEERA, flat, item("Paneer", "2026-11-04")); // the window's last day
  const spinach = await groupItem(MEERA, flat, item("Spinach", "2026-11-03"));
  const eggs = await groupItem(MEERA, flat, item("Eggs", "2026-11-03"));
  const gone = await groupItem(MEERA, flat, item("Curd", "2026-11-03"));
  await groupItem(ANU, lunch, item("Rice", TODAY));
  await myItem(NOMAIL, item("Butter", TODAY));
  // Used up, wasted and removed are not in anyone's digest.
  expect((await call("POST", groupPath(flat, `items/${eggs.id}/uses`), MEERA, { quantity: "1" })).status).toBe(201);
  expect((await call("POST", groupPath(flat, `items/${spinach.id}/waste`), MEERA)).status).toBe(201);
  expect((await call("DELETE", groupPath(flat, `items/${gone.id}`), MEERA)).status).toBe(200);
  h.notifications.length = 0;
}

describe("the daily sweep", () => {
  it("sends each person one digest of what they can use within two days, soonest first", async () => {
    await stockUp();
    const outcome = await runUseSoonSweep(h.env, { now: () => clock });
    expect(outcome).toEqual({ date: TODAY, items: 5, people: 6, sent: 5, failed: 1 });

    const digests = sent("kitchen.use_soon");
    expect(digests.map(to).sort()).toEqual([ADMIN, ANU, KIRAN, MEERA, RAHUL]);
    const listed = Object.fromEntries(
      digests.map((n) => [to(n), readUseSoonEmail(n.request.templateData as KitchenEmailData).items.map((i) => `${i.name}@${i.pantry}@${i.useBy}`)]),
    );
    expect(listed).toEqual({
      [RAHUL]: ["Milk@My pantry@2026-11-02", "Tomatoes@Flat 4B@2026-11-03", "Paneer@Flat 4B@2026-11-04"],
      [ANU]: ["Rice@Lunch club@2026-11-02", "Tomatoes@Flat 4B@2026-11-03", "Paneer@Flat 4B@2026-11-04"],
      [MEERA]: ["Tomatoes@Flat 4B@2026-11-03", "Paneer@Flat 4B@2026-11-04"],
      [ADMIN]: ["Tomatoes@Flat 4B@2026-11-03", "Paneer@Flat 4B@2026-11-04"],
      [KIRAN]: ["Rice@Lunch club@2026-11-02"],
    });
    // A viewer cannot use a group's items: no digest for Vee, and none of the
    // Lunch club's rice for Rahul, who only views it.
    expect(digests.map(to)).not.toContain(VIEWER);
  });

  it("enqueues through the notifications client, under the system org, tagged for preferences, keyed per person and day", async () => {
    await stockUp();
    await runUseSoonSweep(h.env, { now: () => clock });
    const rahul = sent("kitchen.use_soon").find((n) => to(n) === RAHUL)!;
    expect(rahul.internalActor).toBe("kitchen-worker");
    expect(rahul.request).toMatchObject({
      orgId: "00000000-0000-0000-0000-000000000000",
      category: "product",
      templateKey: "kitchen.use_soon",
      recipient: { channel: "email", address: "rahul@example.com", subjectKind: "user", subjectId: RAHUL },
      idempotencyKey: `kitchen.use_soon:${RAHUL}:${TODAY}`,
    });
    expect(readUseSoonEmail(rahul.request.templateData as KitchenEmailData)).toMatchObject({
      recipientName: "Rahul",
      date: TODAY,
      count: 3,
      homeUrl: "https://cookpool.test/home",
    });
    // Addresses go out lower-cased; a person with no name is greeted by their email up to the @.
    const meera = sent("kitchen.use_soon").find((n) => to(n) === MEERA)!;
    expect(meera.request.recipient.address).toBe("meera@example.com");
    const admin = sent("kitchen.use_soon").find((n) => to(n) === ADMIN)!;
    expect(admin.request.templateData!.recipientName).toBe("admin.person");
  });

  it("sends nothing twice when it runs again the same day, and again the next day", async () => {
    await stockUp();
    await runUseSoonSweep(h.env, { now: () => clock });
    clock = new Date(NOW.getTime() + 60_000);
    const again = await runUseSoonSweep(h.env, { now: () => clock });
    expect(again).toMatchObject({ date: TODAY, people: 6, sent: 5, failed: 1 });
    expect(firstSends("kitchen.use_soon")).toHaveLength(5);
    expect(sent("kitchen.use_soon").filter((n) => n.replayed)).toHaveLength(5);

    // The next day is a new digest: tomorrow's window (Milk and the rice are past their date now).
    clock = new Date(NOW.getTime() + DAY);
    const tomorrow = await runUseSoonSweep(h.env, { now: () => clock });
    expect(tomorrow).toMatchObject({ date: "2026-11-03", items: 3 });
    const fresh = firstSends("kitchen.use_soon").filter((n) => n.request.idempotencyKey!.endsWith(":2026-11-03"));
    expect(fresh.map(to).sort()).toEqual([ADMIN, ANU, MEERA, RAHUL]);
    expect(readUseSoonEmail(fresh.find((n) => to(n) === RAHUL)!.request.templateData as KitchenEmailData).items.map((i) => i.name)).toEqual([
      "Tomatoes",
      "Paneer",
      "Bread",
    ]);
  });

  it("records every run, and /health reports the last one", async () => {
    const before = await envelope<{ lastSweepAt: string | null; lastSweep: unknown }>(await h.call("GET", "/health", { as: null }));
    expect(before.data.lastSweepAt).toBeNull();
    expect(before.data.lastSweep).toBeNull();

    await stockUp();
    await runUseSoonSweep(h.env, { now: () => clock });
    clock = new Date(NOW.getTime() + 5 * 60_000);
    await runUseSoonSweep(h.env, { now: () => clock });

    const after = await envelope<{ lastSweepAt: string | null; lastSweep: Record<string, unknown> }>(
      await h.call("GET", "/health", { as: null }),
    );
    expect(after.data.lastSweepAt).toBe(clock.toISOString());
    expect(after.data.lastSweep).toEqual({ date: TODAY, items: 5, people: 6, sent: 5, failed: 1, runs: 2 });
    expect(h.db.prepare("SELECT COUNT(*) AS n FROM kitchen_sweeps").get()).toEqual({ n: 1 });
  });

  it("reads every pantry's items in one query, however many people and groups", async () => {
    await stockUp();
    const rosters = h.rosterCalls;
    const lookups = h.identityCalls;
    const queries: string[] = [];
    const db = h.env.PLATFORM_DB!;
    const counting = {
      prepare(query: string) {
        queries.push(query.replace(/\s+/g, " ").trim());
        return db.prepare(query);
      },
      batch: db.batch.bind(db),
    } as unknown as D1Database;
    await runUseSoonSweep({ ...h.env, PLATFORM_DB: counting }, { now: () => clock });
    expect(queries).toHaveLength(2);
    expect(queries[0]).toMatch(/^SELECT .* FROM kitchen_items WHERE state = 'active'/);
    expect(queries[0]).toMatch(/ORDER BY expires_on, lower\(name\), id LIMIT \?$/);
    expect(queries[1]).toMatch(/^INSERT INTO kitchen_sweeps/);
    expect(SWEEP_MAX_ITEMS).toBeGreaterThanOrEqual(1000);
    // One roster per group with items in the window; one identity lookup for everyone.
    expect(h.rosterCalls - rosters).toBe(2);
    expect(h.identityCalls - lookups).toBe(1);
  });

  it("still records the run, counting each digest as failed, when notifications-worker is down", async () => {
    await stockUp();
    h.failNotifications = true;
    const outcome = await runUseSoonSweep(h.env, { now: () => clock });
    expect(outcome).toEqual({ date: TODAY, items: 5, people: 6, sent: 0, failed: 6 });
    // The next run (a retry) sends them.
    h.failNotifications = false;
    expect(await runUseSoonSweep(h.env, { now: () => clock })).toMatchObject({ sent: 5, failed: 1 });
  });

  it("runs on the worker's scheduled() for the trigger's day", async () => {
    await stockUp();
    expect(typeof worker.scheduled).toBe("function");
    const controller = { scheduledTime: Date.parse("2026-11-02T02:30:00.000Z"), cron: "30 2 * * *", noRetry() {} };
    const ctx = { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext;
    await worker.scheduled!(controller as unknown as ScheduledController, h.env, ctx);
    expect(firstSends("kitchen.use_soon").map((n) => n.request.idempotencyKey)).toContain(`kitchen.use_soon:${RAHUL}:${TODAY}`);
  });

  it("fails the scheduled invocation, loudly, when there is no database to read", async () => {
    const env: Env = { ...h.env };
    delete env.PLATFORM_DB;
    const controller = { scheduledTime: NOW.getTime(), cron: "30 2 * * *", noRetry() {} };
    await expect(
      worker.scheduled!(controller as unknown as ScheduledController, env, {} as ExecutionContext),
    ).rejects.toThrow(/kitchen sweep/);
  });
});

describe("a dish posted for claims", () => {
  async function cookFor(g: Group | null, splitMode: "claims" | "assign", key: string) {
    const rice = await myItem(MEERA, { ...item("Rice", null), unit: "kg", quantity: "1" });
    return call<DishResponse>(
      "POST",
      me("dishes"),
      MEERA,
      {
        name: "Egg fried rice",
        ...(g ? { orgId: g.publicId } : {}),
        portionsHalf: 9,
        extrasMinor: 1000,
        splitMode,
        ingredients: [{ itemId: rice.id, quantity: "500", unit: "g" }],
      },
      { "idempotency-key": key },
    );
  }

  it("emails the group's members who can claim — not the cook, not a viewer — once per dish", async () => {
    const res = await cookFor(flat, "claims", "cook-rice");
    expect(res.status).toBe(201);
    const dish = res.body.data.dish;
    const mails = firstSends("kitchen.dish_posted");
    expect(mails.map(to).sort()).toEqual([ADMIN, ANU, RAHUL].sort());
    const anu = mails.find((n) => to(n) === ANU)!;
    expect(anu.request).toMatchObject({
      orgId: flat.publicId,
      category: "product",
      recipient: { address: "anu@example.com", subjectKind: "user", subjectId: ANU },
      idempotencyKey: `kitchen.dish_posted:${dish.id}:${ANU}`,
      templateData: {
        cookName: "Meera",
        dishName: "Egg fried rice",
        groupName: "Flat 4B",
        portions: "4½",
        total: "₹40.00",
        dishUrl: `https://cookpool.test/dishes/${dish.id}`,
      },
    });

    // The same request again (a retry): the same emails asked for, none sent twice.
    const again = await cookFor(flat, "claims", "cook-rice");
    expect(again.body.data.dish.id).toBe(dish.id);
    expect(firstSends("kitchen.dish_posted")).toHaveLength(3);
    expect(sent("kitchen.dish_posted").filter((n) => n.replayed)).toHaveLength(3);
  });

  it("emails nobody for a dish the cook assigns, or one just for the cook", async () => {
    expect((await cookFor(flat, "assign", "cook-assign")).status).toBe(201);
    expect((await cookFor(null, "assign", "cook-alone")).status).toBe(201);
    expect(sent("kitchen.dish_posted")).toEqual([]);
  });

  it("emails only the viewer-free roles: the claim roles are the ones the policy engine grants kitchen.dish.claim", () => {
    for (const role of ["owner", "admin", "builder", "viewer", "billing_admin"] as OrganizationRole[]) {
      const decision = authorize({
        subject: { type: "user", id: "usr_x" },
        action: "kitchen.dish.claim",
        resource: { kind: "organization", orgId: "org" },
        context: { memberships: [{ kind: "role_assignment", role, scope: { kind: "organization", orgId: "org" } }] },
      });
      expect([role, CLAIM_ROLES.has(role)]).toEqual([role, decision.allow]);
    }
    expect([1, 2, 3, 8, 9].map(formatPortions)).toEqual(["½", "1", "1½", "4", "4½"]);
  });

  it("still cooks the dish when notifications-worker is down", async () => {
    h.failNotifications = true;
    const res = await cookFor(flat, "claims", "cook-down");
    expect(res.status).toBe(201);
    expect(res.body.data.dish.state).toBe("open");
  });
});

describe("logged for you", () => {
  async function milk(): Promise<KitchenItem> {
    return groupItem(MEERA, flat, { ...item("Milk", null), quantity: "1", unit: "L", priceMinor: 6000 });
  }

  it("emails each person a use was logged for — not whoever logged it — with their share", async () => {
    const m = await milk();
    const res = await call<StockMoveResponse>(
      "POST",
      groupPath(flat, `items/${m.id}/uses`),
      ANU,
      { quantity: "250", unit: "ml", consumers: [ANU, RAHUL, ADMIN] },
      { "idempotency-key": "use-milk" },
    );
    expect(res.status).toBe(201);
    const txn = res.body.data.txn!;
    const mails = firstSends("kitchen.logged_for_you");
    expect(mails.map(to).sort()).toEqual([ADMIN, RAHUL].sort());
    expect(mails.find((n) => to(n) === RAHUL)!.request).toMatchObject({
      orgId: flat.publicId,
      category: "product",
      idempotencyKey: `kitchen.logged_for_you:${txn.id}:${RAHUL}`,
      templateData: {
        kind: "use",
        actorName: "Anu",
        what: "250 ml of Milk",
        groupName: "Flat 4B",
        total: "₹15.00",
        yourShare: "₹5.00",
        youPaid: null,
        groupUrl: `https://cookpool.test/groups/${flat.slug}`,
      },
    });

    // Retried: nothing new.
    const again = await call<StockMoveResponse>(
      "POST",
      groupPath(flat, `items/${m.id}/uses`),
      ANU,
      { quantity: "250", unit: "ml", consumers: [ANU, RAHUL, ADMIN] },
      { "idempotency-key": "use-milk" },
    );
    expect(again.status).toBe(201);
    expect(firstSends("kitchen.logged_for_you")).toHaveLength(2);
  });

  it("emails the buyer too when they are among those who had it", async () => {
    const m = await milk();
    await call("POST", groupPath(flat, `items/${m.id}/uses`), ANU, { quantity: "500", unit: "ml", consumers: [MEERA, RAHUL] });
    expect(firstSends("kitchen.logged_for_you").map(to).sort()).toEqual([MEERA, RAHUL].sort());
    expect(firstSends("kitchen.logged_for_you").find((n) => to(n) === MEERA)!.request.templateData).toMatchObject({
      yourShare: "₹15.00",
      youPaid: null,
    });
  });

  it("emails nobody for a use you logged for yourself, one that moves no money, or waste split equally", async () => {
    const m = await milk();
    await call("POST", groupPath(flat, `items/${m.id}/uses`), ANU, { quantity: "100", unit: "ml" });
    // Anu logs some for Meera alone, who bought it: no money moves, no transaction.
    await call("POST", groupPath(flat, `items/${m.id}/uses`), ANU, { quantity: "100", unit: "ml", consumers: [MEERA] });
    await call("POST", groupPath(flat, `items/${m.id}/waste`), ANU);
    expect(sent("kitchen.logged_for_you")).toEqual([]);
  });

  it("emails everyone an expense names, payers and sharers, but not its creator", async () => {
    const res = await call<{ txn: KitchenTxn }>(
      "POST",
      groupPath(flat, "expenses"),
      RAHUL,
      {
        title: "Groceries",
        totalMinor: 60000,
        payers: [{ subjectId: MEERA, amountMinor: 60000 }],
        mode: "equal",
        participants: [{ subjectId: RAHUL }, { subjectId: ANU }, { subjectId: ADMIN }],
      },
      { "idempotency-key": "groceries" },
    );
    expect(res.status).toBe(201);
    const txn = res.body.data.txn;
    const mails = firstSends("kitchen.logged_for_you");
    expect(mails.map(to).sort()).toEqual([ADMIN, ANU, MEERA].sort());
    expect(mails.find((n) => to(n) === MEERA)!.request.templateData).toMatchObject({
      kind: "expense",
      actorName: "Rahul",
      what: "Groceries",
      total: "₹600.00",
      yourShare: null,
      youPaid: "₹600.00",
    });
    expect(mails.find((n) => to(n) === ANU)!.request).toMatchObject({
      idempotencyKey: `kitchen.logged_for_you:${txn.id}:${ANU}`,
      templateData: { yourShare: "₹200.00", youPaid: null },
    });

    // The same request again: answered the same, nothing sent twice.
    await call(
      "POST",
      groupPath(flat, "expenses"),
      RAHUL,
      {
        title: "Groceries",
        totalMinor: 60000,
        payers: [{ subjectId: MEERA, amountMinor: 60000 }],
        mode: "equal",
        participants: [{ subjectId: RAHUL }, { subjectId: ANU }, { subjectId: ADMIN }],
      },
      { "idempotency-key": "groceries" },
    );
    expect(firstSends("kitchen.logged_for_you")).toHaveLength(3);
  });

  it("emails nobody for an expense its creator paid and shared alone", async () => {
    await call("POST", groupPath(flat, "expenses"), RAHUL, {
      title: "Snacks",
      totalMinor: 1000,
      payers: [{ subjectId: RAHUL, amountMinor: 1000 }],
      mode: "equal",
      participants: [{ subjectId: RAHUL }],
    });
    expect(sent("kitchen.logged_for_you")).toEqual([]);
  });

  it("never fails the write: notifications-worker down, or identity unreadable", async () => {
    const m = await milk();
    h.failNotifications = true;
    expect((await call("POST", groupPath(flat, `items/${m.id}/uses`), ANU, { quantity: "100", unit: "ml", consumers: [RAHUL] })).status).toBe(201);
    h.failNotifications = false;
    h.failIdentity = true;
    expect((await call("POST", groupPath(flat, `items/${m.id}/uses`), ANU, { quantity: "100", unit: "ml", consumers: [RAHUL] })).status).toBe(201);
    // Neither was sent (the first refused, the second had no address to send to).
    expect(h.notifications).toEqual([]);
  });

  it("hands the email to waitUntil, after the write, when the runtime offers one", async () => {
    const deferred: Promise<unknown>[] = [];
    h.close();
    h = createHarness({ deps: { now: () => clock, waitUntil: (work) => deferred.push(work) } });
    h.grant(MEERA, flat, "builder");
    h.grant(ANU, flat, "builder");
    h.grant(RAHUL, flat, "owner");
    h.profile(RAHUL, { displayName: "Rahul", email: "rahul@example.com" });
    h.profile(ANU, { displayName: "Anu", email: "anu@example.com" });
    const m = await milk();
    const res = await call("POST", groupPath(flat, `items/${m.id}/uses`), ANU, { quantity: "100", unit: "ml", consumers: [RAHUL] });
    expect(res.status).toBe(201);
    expect(deferred).toHaveLength(1);
    await Promise.all(deferred);
    expect(firstSends("kitchen.logged_for_you").map(to)).toEqual([RAHUL]);
  });
});

describe("links", () => {
  it("start at APP_URL, and are left out when it is not an http(s) origin", () => {
    expect(appLink({ APP_URL: "https://stage.cookpool.app" }, "/home")).toBe("https://stage.cookpool.app/home");
    expect(appLink({ APP_URL: "https://stage.cookpool.app/" }, "/dishes/dsh_1")).toBe("https://stage.cookpool.app/dishes/dsh_1");
    expect(appLink({}, "/home")).toBe("");
    expect(appLink({ APP_URL: "javascript:alert(1)" }, "/home")).toBe("");
    expect(appLink({ APP_URL: "not a url" }, "/home")).toBe("");
  });
});
