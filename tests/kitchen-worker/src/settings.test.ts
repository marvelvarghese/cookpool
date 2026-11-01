// Group settings: GET for every member, PATCH for owners and admins, the
// currency fixed once set — through the router, against real SQLite and the
// real policy grants.

import type { KitchenSettings } from "@saas/contracts/kitchen";
import { createHarness, envelope, newGroup, type Group, type Harness } from "./harness.js";

const NOW = new Date("2026-11-02T08:00:00.000Z");

const settingsPath = (group: Group) => `/v1/organizations/${group.publicId}/kitchen/settings`;

let h: Harness;
let group: Group;

beforeEach(() => {
  h = createHarness({ deps: { now: () => NOW } });
  group = newGroup();
  h.grant("usr_owner", group, "owner");
  h.grant("usr_admin", group, "admin");
  h.grant("usr_member", group, "builder");
  h.grant("usr_viewer", group, "viewer");
});

afterEach(() => h.close());

function storedRows(): Array<Record<string, unknown>> {
  return h.db.prepare("SELECT * FROM kitchen_group_settings").all() as Array<Record<string, unknown>>;
}

async function patch(as: string, body: unknown) {
  const res = await h.call("PATCH", settingsPath(group), { as, body });
  return { status: res.status, body: await envelope<KitchenSettings>(res) };
}

describe("GET /v1/organizations/{org}/kitchen/settings", () => {
  it.each(["usr_owner", "usr_admin", "usr_member", "usr_viewer"])(
    "gives %s the defaults while the group has saved none",
    async (as) => {
      const res = await h.call("GET", settingsPath(group), { as });
      expect(res.status).toBe(200);
      const body = await envelope<KitchenSettings>(res);
      expect(body.data).toEqual({ currency: "INR", wastePolicy: "split_equally", updatedAt: null });
      expect(body.meta).toEqual({ requestId: "req_test", cursor: null });
    },
  );

  it("does not write a row to answer a read", async () => {
    await h.call("GET", settingsPath(group), { as: "usr_member" });
    expect(storedRows()).toHaveLength(0);
  });

  it("asks policy for kitchen.pantry.read", async () => {
    await h.call("GET", settingsPath(group), { as: "usr_viewer" });
    expect(h.decisions.map((d) => d.request.action)).toEqual(["kitchen.pantry.read"]);
  });

  it("is the opaque 404 for someone outside the group", async () => {
    const res = await h.call("GET", settingsPath(group), { as: "usr_outsider" });
    expect(res.status).toBe(404);
    expect((await envelope(res)).error).toMatchObject({ code: "not_found", message: "Not found", details: {} });
  });

  it.each(["grp_123", "org_xyz", "org_0123"])("is the opaque 404 for the malformed org id %s", async (org) => {
    const res = await h.call("GET", `/v1/organizations/${org}/kitchen/settings`, { as: "usr_owner" });
    expect(res.status).toBe(404);
    expect((await envelope(res)).error.message).toBe("Not found");
    expect(h.decisions).toHaveLength(0);
  });

  it("reads what the group saved", async () => {
    await patch("usr_admin", { wastePolicy: "buyer_absorbs", currency: "EUR" });
    const body = await envelope<KitchenSettings>(await h.call("GET", settingsPath(group), { as: "usr_viewer" }));
    expect(body.data).toEqual({ currency: "EUR", wastePolicy: "buyer_absorbs", updatedAt: NOW.toISOString() });
  });

  it("is a 503 when the database is not bound", async () => {
    h.close();
    h = createHarness({ env: { PLATFORM_DB: undefined } });
    h.grant("usr_owner", group, "owner");
    expect((await h.call("GET", settingsPath(group), { as: "usr_owner" })).status).toBe(503);
  });
});

describe("PATCH /v1/organizations/{org}/kitchen/settings", () => {
  it.each(["usr_owner", "usr_admin"])("lets %s change the waste rule", async (as) => {
    const { status, body } = await patch(as, { wastePolicy: "buyer_absorbs" });
    expect(status).toBe(200);
    expect(body.data).toEqual({ currency: "INR", wastePolicy: "buyer_absorbs", updatedAt: NOW.toISOString() });
    expect(storedRows()).toEqual([
      {
        org_id: group.id,
        currency: "INR",
        waste_policy: "buyer_absorbs",
        created_at: NOW.toISOString(),
        updated_at: NOW.toISOString(),
      },
    ]);
  });

  it("asks policy for kitchen.settings.manage", async () => {
    await patch("usr_admin", { wastePolicy: "buyer_absorbs" });
    expect(h.decisions.map((d) => d.request.action)).toEqual(["kitchen.settings.manage"]);
  });

  it.each(["usr_member", "usr_viewer", "usr_outsider"])(
    "is the opaque 404 for %s, and writes nothing",
    async (as) => {
      const { status, body } = await patch(as, { wastePolicy: "buyer_absorbs" });
      expect(status).toBe(404);
      expect(body.error).toMatchObject({ code: "not_found", message: "Not found" });
      expect(storedRows()).toHaveLength(0);
    },
  );

  it("refuses a non-member before reading the body, so a bad body tells them nothing", async () => {
    const res = await h.call("PATCH", settingsPath(group), { as: "usr_outsider", rawBody: "{not json" });
    expect(res.status).toBe(404);
  });

  it("keeps the other setting when one changes", async () => {
    await patch("usr_owner", { currency: "USD", wastePolicy: "buyer_absorbs" });
    const { body } = await patch("usr_owner", { wastePolicy: "split_equally" });
    expect(body.data).toEqual({ currency: "USD", wastePolicy: "split_equally", updatedAt: NOW.toISOString() });
  });

  it("keeps each group's settings to itself", async () => {
    const other = newGroup();
    h.grant("usr_owner", other, "owner");
    await patch("usr_owner", { currency: "USD", wastePolicy: "buyer_absorbs" });
    const res = await h.call("GET", settingsPath(other), { as: "usr_owner" });
    expect((await envelope<KitchenSettings>(res)).data).toEqual({
      currency: "INR",
      wastePolicy: "split_equally",
      updatedAt: null,
    });
    // An admin of one group is a stranger to the next.
    h.grant("usr_admin_elsewhere", other, "admin");
    const denied = await h.call("PATCH", settingsPath(group), {
      as: "usr_admin_elsewhere",
      body: { wastePolicy: "split_equally" },
    });
    expect(denied.status).toBe(404);
  });

  it("keeps created_at and moves updated_at on a later change", async () => {
    let now = NOW;
    h.close();
    h = createHarness({ deps: { now: () => now } });
    h.grant("usr_owner", group, "owner");
    await patch("usr_owner", { wastePolicy: "buyer_absorbs" });
    now = new Date("2026-11-05T10:00:00.000Z");
    const { body } = await patch("usr_owner", { wastePolicy: "split_equally" });
    expect(body.data.updatedAt).toBe(now.toISOString());
    expect(storedRows()[0]).toMatchObject({ created_at: NOW.toISOString(), updated_at: now.toISOString() });
  });

  describe("the currency lock", () => {
    it("sets the currency while the group has no settings yet", async () => {
      const { status, body } = await patch("usr_owner", { currency: "USD" });
      expect(status).toBe(200);
      expect(body.data).toMatchObject({ currency: "USD", wastePolicy: "split_equally" });
    });

    it("accepts the current currency again, alongside another change", async () => {
      await patch("usr_owner", { currency: "USD" });
      const { status, body } = await patch("usr_admin", { currency: "USD", wastePolicy: "buyer_absorbs" });
      expect(status).toBe(200);
      expect(body.data).toMatchObject({ currency: "USD", wastePolicy: "buyer_absorbs" });
    });

    it("refuses a different currency once set: 409 currency_locked, nothing changes", async () => {
      await patch("usr_owner", { currency: "USD" });
      const { status, body } = await patch("usr_owner", { currency: "EUR", wastePolicy: "buyer_absorbs" });
      expect(status).toBe(409);
      expect(body.error.code).toBe("conflict");
      expect(body.error.details).toEqual({ reason: "currency_locked", currency: "USD" });
      expect(storedRows()[0]).toMatchObject({ currency: "USD", waste_policy: "split_equally" });
    });

    it("fixes the default currency when the first save changes only the waste rule", async () => {
      await patch("usr_owner", { wastePolicy: "buyer_absorbs" });
      const { status, body } = await patch("usr_owner", { currency: "USD" });
      expect(status).toBe(409);
      expect(body.error.details).toEqual({ reason: "currency_locked", currency: "INR" });
    });
  });

  describe("validation", () => {
    it.each([
      [{ wastePolicy: "everyone_pays" }, "wastePolicy"],
      [{ wastePolicy: null }, "wastePolicy"],
      [{ currency: "inr" }, "currency"],
      [{ currency: "RUPEE" }, "currency"],
      [{ currency: 356 }, "currency"],
      [{}, "body"],
      [{ waste_policy: "buyer_absorbs" }, "body"],
    ])("422s %j on %s", async (body, field) => {
      const res = await patch("usr_admin", body);
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe("validation_failed");
      expect(Object.keys(res.body.error.details.fields as object)).toEqual([field]);
      expect(storedRows()).toHaveLength(0);
    });

    it("reports every bad field at once", async () => {
      const res = await patch("usr_admin", { wastePolicy: "x", currency: "x" });
      expect(res.status).toBe(422);
      expect(Object.keys(res.body.error.details.fields as object).sort()).toEqual(["currency", "wastePolicy"]);
    });

    it.each([
      ["not JSON", "{nope"],
      ["an array", "[]"],
      ["a string", '"buyer_absorbs"'],
      ["null", "null"],
    ])("422s a body that is %s", async (_what, rawBody) => {
      const res = await h.call("PATCH", settingsPath(group), { as: "usr_admin", rawBody });
      expect(res.status).toBe(422);
      expect((await envelope(res)).error.details).toEqual({ fields: { body: ["Must be a JSON object"] } });
    });
  });
});
