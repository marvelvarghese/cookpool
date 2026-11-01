// kitchen-worker's skeleton: health, routing, the actor, and the authorization
// hop every group route takes (membership authorization-context → policy).

import { requireOrgAction, resolveActor } from "@kitchen-worker/authz";
import { createHarness, envelope, newGroup, type Harness } from "./harness.js";

const OWNER = "usr_owner";
const OUTSIDER = "usr_outsider";

let h: Harness;

afterEach(() => h?.close());

describe("GET /health", () => {
  it("answers ok with every binding it needs configured", async () => {
    h = createHarness();
    const res = await h.call("GET", "/health", { as: null });
    expect(res.status).toBe(200);
    const body = await envelope<{ status: string; service: string; checks: Record<string, { configured: boolean }> }>(res);
    expect(body.data.status).toBe("ok");
    expect(body.data.service).toBe("kitchen-worker");
    expect(body.data.checks).toEqual({
      database: { configured: true },
      membership: { configured: true },
      policy: { configured: true },
      notifications: { configured: true },
    });
    expect(body.meta.requestId).toBe("req_test");
  });

  it("reports a missing binding instead of failing", async () => {
    h = createHarness({ env: { NOTIFICATIONS_WORKER: undefined } });
    const body = await envelope<{ checks: Record<string, { configured: boolean }> }>(
      await h.call("GET", "/health", { as: null }),
    );
    expect(body.data.checks.notifications).toEqual({ configured: false });
  });

  it("405s any other method", async () => {
    h = createHarness();
    expect((await h.call("POST", "/health", { as: null })).status).toBe(405);
  });
});

describe("routing", () => {
  it("404s a path no route answers, naming it", async () => {
    h = createHarness();
    const group = newGroup();
    for (const path of [
      "/",
      "/v1/kitchen/me/pantries",
      `/v1/organizations/${group.publicId}/kitchen`,
      `/v1/organizations/${group.publicId}/kitchen/settings/extra`,
    ]) {
      const res = await h.call("GET", path, { as: OWNER });
      expect(res.status).toBe(404);
      const body = await envelope(res);
      expect(body.error.code).toBe("not_found");
      expect(body.error.message).toBe(`Route not found: ${path}`);
    }
  });

  it.each(["POST", "PUT", "DELETE"])("405s %s on the settings route before anything else", async (method) => {
    h = createHarness();
    const res = await h.call(method, `/v1/organizations/${newGroup().publicId}/kitchen/settings`, { as: null });
    expect(res.status).toBe(405);
    expect((await envelope(res)).error.code).toBe("unsupported");
    expect(h.decisions).toHaveLength(0);
  });

  it.each(["constructor", "hasOwnProperty", "toString"])(
    "does not treat the inherited object key %s as a method",
    async (method) => {
      h = createHarness();
      const res = await h.call(method, `/v1/organizations/${newGroup().publicId}/kitchen/settings`, { as: OWNER });
      expect(res.status).toBe(405);
    },
  );

  it("echoes a well-formed x-request-id and mints one otherwise", async () => {
    h = createHarness();
    const minted = await envelope(
      await h.call("GET", "/v1/nowhere", { as: OWNER, headers: { "x-request-id": "bad id with spaces" } }),
    );
    expect(minted.error.requestId).toMatch(/^req_[0-9a-f]{24}$/);
  });

  it("sends a Server-Timing header with the authz and db phases", async () => {
    h = createHarness();
    const group = newGroup();
    h.grant(OWNER, group, "owner");
    const res = await h.call("GET", `/v1/organizations/${group.publicId}/kitchen/settings`, { as: OWNER });
    expect(res.status).toBe(200);
    const timing = res.headers.get("server-timing") ?? "";
    expect(timing).toContain("total");
    expect(timing).toContain("authz");
    expect(timing).toContain("db");
  });
});

describe("the actor", () => {
  it("401s a group route without actor headers, before any hop", async () => {
    h = createHarness();
    const res = await h.call("GET", `/v1/organizations/${newGroup().publicId}/kitchen/settings`, { as: null });
    expect(res.status).toBe(401);
    expect((await envelope(res)).error.code).toBe("unauthenticated");
    expect(h.decisions).toHaveLength(0);
  });

  it("needs both the subject id and its type", () => {
    const only = (headers: Record<string, string>) =>
      resolveActor(new Request("https://kitchen.internal/", { headers }));
    expect(only({ "x-actor-subject-id": "usr_a" })).toBeNull();
    expect(only({ "x-actor-subject-type": "user" })).toBeNull();
    expect(only({ "x-actor-subject-id": "usr_a", "x-actor-subject-type": "user" })).toEqual({
      subjectId: "usr_a",
      subjectType: "user",
    });
  });
});

describe("requireOrgAction", () => {
  const actor = { subjectId: OWNER, subjectType: "user" };

  it("is null for a role holding the action, asking policy about the group's UUID", async () => {
    h = createHarness();
    const group = newGroup();
    h.grant(OWNER, group, "owner");
    expect(await requireOrgAction(h.env, "req_t", actor, group.id, "kitchen.settings.manage")).toBeNull();
    expect(h.decisions).toHaveLength(1);
    expect(h.decisions[0]!.request.action).toBe("kitchen.settings.manage");
    expect(h.decisions[0]!.request.resource).toEqual({ kind: "organization", orgId: group.id });
    expect(h.decisions[0]!.request.subject).toEqual({ type: "user", id: OWNER });
  });

  it("is the opaque 404 for a role without it, and for a non-member", async () => {
    h = createHarness();
    const group = newGroup();
    h.grant("usr_viewer", group, "viewer");
    for (const subjectId of ["usr_viewer", OUTSIDER]) {
      const denied = await requireOrgAction(h.env, "req_t", { subjectId, subjectType: "user" }, group.id, "kitchen.item.create");
      expect(denied?.status).toBe(404);
      const body = (await denied!.json()) as { error: { code: string; message: string } };
      expect(body.error).toMatchObject({ code: "not_found", message: "Not found" });
    }
  });

  it("is the opaque 404 when the membership hop fails", async () => {
    const failing = {
      fetch: () => Promise.resolve(Response.json({ error: { code: "internal_error" } }, { status: 500 })),
      connect() {
        throw new Error("not implemented");
      },
    };
    h = createHarness({ env: { MEMBERSHIP_WORKER: failing } });
    const group = newGroup();
    h.grant(OWNER, group, "owner");
    expect((await requireOrgAction(h.env, "req_t", actor, group.id, "kitchen.pantry.read"))?.status).toBe(404);
    expect(h.decisions).toHaveLength(0);
  });

  it("is a 503 when a binding is missing", async () => {
    for (const missing of ["MEMBERSHIP_WORKER", "POLICY_WORKER"] as const) {
      h = createHarness({ env: { [missing]: undefined } });
      const group = newGroup();
      h.grant(OWNER, group, "owner");
      expect((await requireOrgAction(h.env, "req_t", actor, group.id, "kitchen.pantry.read"))?.status).toBe(503);
      h.close();
    }
  });

  it("keeps groups apart: an owner of one group is a stranger to another", async () => {
    h = createHarness();
    const mine = newGroup();
    const theirs = newGroup();
    h.grant(OWNER, mine, "owner");
    expect((await requireOrgAction(h.env, "req_t", actor, theirs.id, "kitchen.pantry.read"))?.status).toBe(404);
  });
});
