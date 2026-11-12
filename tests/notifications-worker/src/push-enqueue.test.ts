// Push beside the email (PW-5): an enqueue of one of the three kinds pushes
// once — after the email path, sharing its idempotency key, so a retried
// enqueue pushes nothing more — and a push can never fail the email. And the
// preferences model, extended: push per kind (default off, the person's own
// in every group), email per category as before plus an optional per-kind
// opt-out.

import crypto from "node:crypto";
import { enqueueNotification, type NotificationsServiceDeps } from "@notifications-worker/services/notifications";
import { createLocalDebugProvider } from "@notifications-worker/providers/local-debug";
import { handleGetPreferences } from "@notifications-worker/handlers/get-preferences";
import { handlePutPreferences } from "@notifications-worker/handlers/put-preferences";
import type { TemplatePush } from "@notifications-worker/push/deliver";
import type { Env } from "@notifications-worker/env";
import type {
  NotificationsRepository,
  StoredNotification,
  StoredNotificationPreference,
} from "@saas/db/notifications";
import type { EnqueueNotificationRequest } from "@saas/contracts/notifications";

if (!(globalThis as Record<string, unknown>).crypto) {
  (globalThis as Record<string, unknown>).crypto = crypto;
}

const env: Env = { ENVIRONMENT: "test", NOTIFICATIONS_PROVIDER: "local-debug" };
const NOW = new Date("2026-11-07T10:00:00.000Z");
const GROUP = "11111111-1111-4111-8111-111111111111";
const SYSTEM_ORG = "00000000-0000-0000-0000-000000000000";
const DEV = "usr_dev";

/** The repository enqueue and the preference routes use, in memory, with the real one's semantics. */
function memoryRepo(): NotificationsRepository & { notifications: StoredNotification[]; prefs: Map<string, StoredNotificationPreference> } {
  const notifications: StoredNotification[] = [];
  const prefs = new Map<string, StoredNotificationPreference>();
  return {
    notifications,
    prefs,
    async createNotification(input) {
      if (input.idempotencyKey && notifications.some((n) => n.orgId === input.orgId && n.idempotencyKey === input.idempotencyKey)) {
        return { ok: false, error: { kind: "conflict", entity: "notification" } };
      }
      const row: StoredNotification = {
        ...input,
        recipientSubjectKind: input.recipientSubjectKind ?? null,
        recipientSubjectId: input.recipientSubjectId ?? null,
        idempotencyKey: input.idempotencyKey ?? null,
        correlationId: input.correlationId ?? null,
        providerMessageId: null,
        lastError: null,
        sentAt: null,
        failedAt: null,
        updatedAt: input.queuedAt,
      };
      notifications.push(row);
      return { ok: true, value: row };
    },
    async getNotificationById(id) {
      const row = notifications.find((n) => n.id === id);
      return row ? { ok: true, value: row } : { ok: false, error: { kind: "not_found" } };
    },
    async findNotificationByIdempotencyKey(orgId, key) {
      const row = notifications.find((n) => n.orgId === orgId && n.idempotencyKey === key);
      return row ? { ok: true, value: row } : { ok: false, error: { kind: "not_found" } };
    },
    async markNotificationStatus(input) {
      const row = notifications.find((n) => n.id === input.id)!;
      Object.assign(row, { status: input.status, sentAt: input.sentAt ?? row.sentAt });
      return { ok: true, value: row };
    },
    async recordAttempt(input) {
      return { ok: true, value: { ...input, providerMessageId: null, errorReason: null } };
    },
    async listAttempts() {
      return { ok: true, value: [] };
    },
    async listPreferences(orgId, subjectKind, subjectId, channel) {
      return {
        ok: true,
        value: [...prefs.values()].filter(
          (p) => p.orgId === orgId && p.subjectKind === subjectKind && p.subjectId === subjectId && (!channel || p.channel === channel),
        ),
      };
    },
    async upsertPreference(input) {
      const key = `${input.orgId}|${input.subjectKind}|${input.subjectId}|${input.channel}`;
      const existing = prefs.get(key);
      const kinds = { ...(existing?.kinds ?? {}), ...(input.kinds ?? {}) };
      for (const [k, v] of Object.entries(kinds)) if (v === null) delete kinds[k];
      const row: StoredNotificationPreference = {
        id: existing?.id ?? input.id,
        orgId: input.orgId,
        subjectKind: input.subjectKind,
        subjectId: input.subjectId,
        channel: input.channel,
        categories: input.categories,
        kinds,
        createdAt: existing?.createdAt ?? input.updatedAt,
        updatedAt: input.updatedAt,
      };
      prefs.set(key, row);
      return { ok: true, value: row };
    },
    async isSuppressed() {
      return { ok: true, value: false };
    },
    async createSuppression() {
      throw new Error("not used");
    },
  };
}

const portionSet = (overrides: Partial<EnqueueNotificationRequest> = {}): EnqueueNotificationRequest => ({
  orgId: GROUP,
  category: "product",
  templateKey: "kitchen.portion_set",
  templateData: { actorName: "Anu", dishName: "Egg fried rice", portions: "1", dishUrl: "https://cookpool.store/dishes/dsh_1" },
  recipient: { channel: "email", address: "dev@example.com", subjectKind: "user", subjectId: DEV },
  idempotencyKey: `kitchen.portion_set:dsh_1:${DEV}`,
  ...overrides,
});

function service(repo: NotificationsRepository, push: NotificationsServiceDeps["push"]): NotificationsServiceDeps {
  let n = 0;
  return {
    repo,
    provider: createLocalDebugProvider(),
    env,
    now: () => NOW,
    generateUuid: () => `22222222-2222-4222-8222-${String(++n).padStart(12, "0")}`,
    emit: async () => {},
    push,
    actorType: "user",
    actorId: "usr_anu",
    requestId: "req_push",
  };
}

describe("the push beside an enqueue", () => {
  it("is asked for once, after the email, with the email's key as its tag; a retried enqueue asks for nothing more", async () => {
    const repo = memoryRepo();
    const pushes: Array<TemplatePush & { emailStatus: string | undefined }> = [];
    const deps = service(repo, async (push) => {
      pushes.push({ ...push, emailStatus: repo.notifications[0]?.status });
    });

    const first = await enqueueNotification(deps, portionSet());
    expect("outcome" in first && first.outcome.status).toBe("created");
    expect(pushes).toEqual([
      {
        subjectId: DEV,
        templateKey: "kitchen.portion_set",
        templateData: portionSet().templateData,
        tag: `kitchen.portion_set:dsh_1:${DEV}`,
        emailStatus: "sent",
      },
    ]);

    const retried = await enqueueNotification(deps, portionSet());
    expect("outcome" in retried && retried.outcome.status).toBe("idempotent_hit");
    expect(pushes).toHaveLength(1);
    expect(repo.notifications).toHaveLength(1);
  });

  it("goes even when the email is opted out: push is its own channel", async () => {
    const repo = memoryRepo();
    await repo.upsertPreference({
      id: "p1", orgId: GROUP as never, subjectKind: "user", subjectId: DEV, channel: "email", categories: { product: false }, updatedAt: NOW,
    });
    const pushes: TemplatePush[] = [];
    const result = await enqueueNotification(service(repo, async (p) => void pushes.push(p)), portionSet());
    expect("outcome" in result && result.outcome.status).toBe("suppressed");
    expect(pushes.map((p) => p.templateKey)).toEqual(["kitchen.portion_set"]);
  });

  it("is only for the three kinds, and only for a recipient tagged as a person", async () => {
    const pushes: TemplatePush[] = [];
    const deps = service(memoryRepo(), async (p) => void pushes.push(p));
    await enqueueNotification(deps, portionSet({ templateKey: "kitchen.logged_for_you", idempotencyKey: "a" }));
    await enqueueNotification(deps, portionSet({ templateKey: "invitation.created", idempotencyKey: "b" }));
    await enqueueNotification(deps, portionSet({ recipient: { channel: "email", address: "dev@example.com" }, idempotencyKey: "c" }));
    await enqueueNotification(deps, portionSet({ templateKey: "kitchen.paid_you", idempotencyKey: "d" }));
    const unkeyed = portionSet({ templateKey: "kitchen.dish_posted" });
    delete unkeyed.idempotencyKey;
    await enqueueNotification(deps, unkeyed);
    expect(pushes.map((p) => p.templateKey)).toEqual(["kitchen.paid_you", "kitchen.dish_posted"]);
    // Without a key of its own, the tag names the notification.
    expect(pushes[1]!.tag).toMatch(/^kitchen\.dish_posted:ntf_[0-9a-f]{32}$/);
  });

  it("never sends the email of a social kind (CM-3): recorded as suppressed, pushed beside it, even with email turned on", async () => {
    const repo = memoryRepo();
    await repo.upsertPreference({
      id: "p1", orgId: SYSTEM_ORG as never, subjectKind: "user", subjectId: DEV, channel: "email",
      categories: { product: true }, kinds: { "kitchen.yum": true }, updatedAt: NOW,
    });
    const pushes: TemplatePush[] = [];
    const deps = service(repo, async (p) => void pushes.push(p));
    for (const templateKey of ["kitchen.followed", "kitchen.follow_request", "kitchen.commented", "kitchen.yum", "kitchen.cooked_yours"]) {
      const result = await enqueueNotification(
        deps,
        portionSet({ orgId: SYSTEM_ORG, templateKey, templateData: { actorName: "Meera K" }, idempotencyKey: `${templateKey}:x:${DEV}` }),
      );
      expect("outcome" in result && result.outcome.status).toBe("suppressed");
    }
    expect(repo.notifications.map((n) => n.status)).toEqual(["suppressed", "suppressed", "suppressed", "suppressed", "suppressed"]);
    expect(repo.notifications.every((n) => n.sentAt === null)).toBe(true);
    expect(pushes.map((p) => p.templateKey)).toEqual(["kitchen.followed", "kitchen.follow_request", "kitchen.commented", "kitchen.yum", "kitchen.cooked_yours"]);
    // A retried enqueue pushes nothing more.
    await enqueueNotification(deps, portionSet({ orgId: SYSTEM_ORG, templateKey: "kitchen.yum", idempotencyKey: `kitchen.yum:x:${DEV}` }));
    expect(pushes).toHaveLength(5);
  });

  it("never fails the email, whatever the push does", async () => {
    const repo = memoryRepo();
    const result = await enqueueNotification(
      service(repo, async () => {
        throw new Error("push service on fire");
      }),
      portionSet(),
    );
    expect("outcome" in result && result.outcome.response.notification.status).toBe("sent");
  });

  it("an explicit per-kind email opt-out stops that kind's email, and only that kind's", async () => {
    const repo = memoryRepo();
    await repo.upsertPreference({
      id: "p1", orgId: GROUP as never, subjectKind: "user", subjectId: DEV, channel: "email",
      categories: {}, kinds: { "kitchen.portion_set": false }, updatedAt: NOW,
    });
    const deps = service(repo, undefined);
    const portion = await enqueueNotification(deps, portionSet());
    expect("outcome" in portion && portion.outcome.status).toBe("suppressed");
    const dish = await enqueueNotification(deps, portionSet({ templateKey: "kitchen.dish_posted", idempotencyKey: "dish" }));
    expect("outcome" in dish && dish.outcome.status).toBe("created");
  });
});

describe("preferences, per kind and per channel", () => {
  const actor = { subjectId: "api-edge", subjectType: "user", internalCaller: "api-edge" };
  // Ids of our own, not node:crypto's default export: that is undefined when
  // ts-jest compiles this file to CommonJS (jest run without
  // --experimental-vm-modules; esModuleInterop is off), and a stub that throws
  // inside the handler reads as its 500 (PW-10).
  let ids = 0;
  const put = (repo: NotificationsRepository, body: unknown) =>
    handlePutPreferences(
      new Request("http://nf/v1/notifications/preferences", { method: "PUT", body: JSON.stringify(body) }),
      env, "req_put", actor,
      { repo, now: () => NOW, generateUuid: () => `33333333-3333-4333-8333-${String(++ids).padStart(12, "0")}`, emit: async () => {} },
    );
  const get = (repo: NotificationsRepository, query: string) =>
    handleGetPreferences(env, "req_get", new URL(`http://nf/v1/notifications/preferences?${query}`), { repo });
  const data = async (res: Response) => ((await res.json()) as { data: Record<string, unknown> }).data;
  const fields = async (res: Response) => ((await res.json()) as { error: { details: { fields: Record<string, string[]> } } }).error.details.fields;

  it("push is the person's own, under the system organization, and every kind is off until turned on", async () => {
    const repo = memoryRepo();
    expect(await data(await get(repo, `subjectKind=user&subjectId=${DEV}&channel=push`))).toEqual({ preferences: [] });

    const on = await put(repo, { subjectKind: "user", subjectId: DEV, channel: "push", kinds: { "kitchen.portion_set": true } });
    expect(on.status).toBe(200);
    expect((await data(on)).preference).toMatchObject({
      orgId: SYSTEM_ORG, channel: "push", categories: {}, kinds: { "kitchen.portion_set": true },
    });

    // Merged key by key: turning a second kind on leaves the first; null clears one.
    await put(repo, { subjectKind: "user", subjectId: DEV, channel: "push", kinds: { "kitchen.paid_you": true } });
    await put(repo, { subjectKind: "user", subjectId: DEV, channel: "push", kinds: { "kitchen.portion_set": null, "kitchen.dish_posted": false } });
    const read = await data(await get(repo, `subjectKind=user&subjectId=${DEV}&channel=push`));
    expect(read.preferences).toEqual([
      expect.objectContaining({ orgId: SYSTEM_ORG, channel: "push", kinds: { "kitchen.paid_you": true, "kitchen.dish_posted": false } }),
    ]);
    // The system organization's own id is accepted for push too.
    expect((await get(repo, `orgId=${SYSTEM_ORG}&subjectKind=user&subjectId=${DEV}&channel=push`)).status).toBe(200);
  });

  it("email is unchanged: per group, categories required and replaced; kinds optional", async () => {
    const repo = memoryRepo();
    const email = await put(repo, { orgId: GROUP, subjectKind: "user", subjectId: DEV, channel: "email", categories: { product: false } });
    expect(email.status).toBe(200);
    expect((await data(email)).preference).toMatchObject({ orgId: GROUP, channel: "email", categories: { product: false }, kinds: {} });
    const listed = await data(await get(repo, `orgId=${GROUP}&subjectKind=user&subjectId=${DEV}`));
    expect(listed.preferences).toHaveLength(1);

    // A push row never shows in a group's email read, and the reverse.
    await put(repo, { subjectKind: "user", subjectId: DEV, channel: "push", kinds: { "kitchen.portion_set": true } });
    expect((await data(await get(repo, `orgId=${GROUP}&subjectKind=user&subjectId=${DEV}&channel=email`))).preferences).toHaveLength(1);
    expect((await data(await get(repo, `orgId=${GROUP}&subjectKind=user&subjectId=${DEV}`))).preferences).toHaveLength(1);

    expect(await fields(await put(repo, { orgId: GROUP, subjectKind: "user", subjectId: DEV, channel: "email" }))).toHaveProperty(["categories"]);
    expect(await fields(await put(repo, { subjectKind: "user", subjectId: DEV, channel: "email", categories: {} }))).toHaveProperty(["orgId"]);
  });

  it.each([
    ["categories on push", { channel: "push", kinds: {}, categories: { product: true } }, "categories"],
    ["no kinds on push", { channel: "push" }, "kinds"],
    ["a group's org on push", { channel: "push", orgId: GROUP, kinds: {} }, "orgId"],
    ["an unknown kind", { channel: "push", kinds: { "kitchen.use_soon": true } }, "kinds.kitchen.use_soon"],
    ["a kind that is not on/off", { channel: "push", kinds: { "kitchen.paid_you": "yes" } }, "kinds.kitchen.paid_you"],
    ["push for an organization", { channel: "push", kinds: {}, subjectKind: "organization" }, "subjectKind"],
    ["an unknown channel", { channel: "sms", kinds: {} }, "channel"],
  ])("is 422 for %s", async (_name, body, field) => {
    const repo = memoryRepo();
    const res = await put(repo, { subjectKind: "user", subjectId: DEV, ...body });
    expect(res.status).toBe(422);
    expect(await fields(res)).toHaveProperty([field]);
    expect(repo.prefs.size).toBe(0);
  });

  it("a push read names no group and a bad channel is 422", async () => {
    const repo = memoryRepo();
    expect(await fields(await get(repo, `orgId=${GROUP}&subjectKind=user&subjectId=${DEV}&channel=push`))).toHaveProperty(["orgId"]);
    expect(await fields(await get(repo, `orgId=${GROUP}&subjectKind=user&subjectId=${DEV}&channel=sms`))).toHaveProperty(["channel"]);
    expect(await fields(await get(repo, `subjectKind=user&subjectId=${DEV}`))).toHaveProperty(["orgId"]);
  });
});

describe("Spliteco's kinds (SE-3)", () => {
  it("email the reminder and the payment, and push each beside its email under the email's key", async () => {
    const repo = memoryRepo();
    const pushes: TemplatePush[] = [];
    const deps = service(repo, async (p) => void pushes.push(p));
    const reminder = portionSet({
      templateKey: "spliteco.reminder",
      templateData: { fromName: "Anu", amount: "₹620.00", groupName: "Goa Trip", payUrl: "https://spliteco.test/settle?group=org_1&to=usr_anu" },
      idempotencyKey: `spliteco.reminder:rmd_1:${DEV}`,
    });
    const paid = portionSet({
      templateKey: "spliteco.paid_you",
      templateData: { payerName: "Anu", amount: "₹300.00", method: "UPI", groupName: "Goa Trip", personUrl: "https://spliteco.test/friend?id=usr_anu" },
      idempotencyKey: `spliteco.paid_you:txn_1:${DEV}`,
    });
    for (const request of [reminder, paid]) {
      const result = await enqueueNotification(deps, request);
      expect("outcome" in result && result.outcome.status).toBe("created");
    }
    expect(repo.notifications.map((n) => [n.templateKey, n.status])).toEqual([
      ["spliteco.reminder", "sent"],
      ["spliteco.paid_you", "sent"],
    ]);
    expect(pushes.map((p) => [p.templateKey, p.tag])).toEqual([
      ["spliteco.reminder", `spliteco.reminder:rmd_1:${DEV}`],
      ["spliteco.paid_you", `spliteco.paid_you:txn_1:${DEV}`],
    ]);
  });
});
