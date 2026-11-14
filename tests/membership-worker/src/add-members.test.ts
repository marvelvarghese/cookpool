// POST /v1/organizations/:org/members (MY-17): add people by subject id from a
// Spliteco group the caller shares. In-memory repository with the same rules
// the D1 one keeps; policy granted by role; billing injected.

import crypto from "node:crypto";
import { asUuid } from "@saas/db";
import { route } from "@membership-worker/router";
import { handleAddMembers } from "@membership-worker/handlers/add-members";
import type { JoinLinkDeps, JoinLinkRepo } from "@membership-worker/handlers/join";
import { orgPublicId } from "@membership-worker/ids";
import type { checkBillingEntitlement } from "@membership-worker/billing-client";
import type { AddMembersResponse } from "@saas/contracts/membership";
import type { Organization, OrganizationMember, RoleAssignment } from "@saas/db/membership";
import type { AppendEventWithAuditInput } from "@saas/db/events";
import type { Env } from "@membership-worker/env";

if (!(globalThis as Record<string, unknown>).crypto) (globalThis as Record<string, unknown>).crypto = crypto;

const TARGET = asUuid("aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee");
const SOURCE = asUuid("11111111-2222-4333-8444-555555555555");
const OTHER = asUuid("99999999-2222-4333-8444-555555555555");
const NOW = new Date("2026-11-14T10:00:00.000Z");
const T = orgPublicId(TARGET);
const S = orgPublicId(SOURCE);

function world() {
  const orgs = new Map<string, Organization>();
  const members: OrganizationMember[] = [];
  const roles: RoleAssignment[] = [];
  const org = (id: string, slug: string, madeIn: string): void => {
    orgs.set(id, { id, name: slug, slug, slugLower: slug, status: "active", parentOrgId: null, joinCode: null, createdAt: NOW, updatedAt: NOW, madeIn, kind: "kitchen" } as Organization);
  };
  const person = (orgId: string, subjectId: string, role = "builder") => {
    members.push({ id: crypto.randomUUID(), orgId, subjectId, subjectType: "user", status: "active", createdAt: NOW, updatedAt: NOW });
    roles.push({ id: crypto.randomUUID(), orgId, subjectId, subjectType: "user", role, scopeKind: "organization", scopeRef: null, createdAt: NOW, revokedAt: null });
  };
  const active = (orgId: string, subjectId: string) => members.find((m) => m.orgId === orgId && m.subjectId === subjectId && m.status === "active");
  const repo = {
    async listRoleAssignments(orgId: string, subjectId: string) {
      return { ok: true as const, value: roles.filter((r) => r.orgId === orgId && r.subjectId === subjectId && r.revokedAt === null) };
    },
    async getOrganizationById(id: string) {
      const o = orgs.get(id);
      return o ? { ok: true as const, value: o } : { ok: false as const, error: { kind: "not_found" as const } };
    },
    async getActiveMemberBySubject(orgId: string, subjectId: string) {
      const m = active(orgId, subjectId);
      return m ? { ok: true as const, value: m } : { ok: false as const, error: { kind: "not_found" as const } };
    },
    async countBillableMembers(orgId: string) {
      return { ok: true as const, value: members.filter((m) => m.orgId === orgId && m.status === "active").length };
    },
    async listOrganizationsForSubject(subjectId: string) {
      const ids = new Set(members.filter((m) => m.subjectId === subjectId && m.status === "active").map((m) => m.orgId));
      return { ok: true as const, value: [...ids].map((id) => orgs.get(id)!) };
    },
    async joinOrganization(input: { orgId: string; memberId: string; roleAssignmentId: string; subjectId: string; subjectType: string; role: string; joinedAt: Date }) {
      if (active(input.orgId, input.subjectId)) return { ok: false as const, error: { kind: "conflict" as const, entity: "organization_member" } };
      person(input.orgId, input.subjectId, input.role);
      return { ok: true as const, value: { member: members.at(-1)!, roleAssignment: roles.at(-1)! } };
    },
  } as unknown as JoinLinkRepo;
  org(TARGET, "flat-4b", "cookpool");
  org(SOURCE, "goa-trip", "spliteco");
  return { repo, orgs, members, roles, person, org, active };
}

const events: AppendEventWithAuditInput[] = [];
const eventsRepo = {
  appendEventWithAudit: async (input: AppendEventWithAuditInput) => {
    events.push(input);
    return { ok: true as const, value: { event: {}, audit: {} } };
  },
} as unknown as NonNullable<JoinLinkDeps["eventsRepo"]>;

const policy = {
  fetch: async (_u: string, init: RequestInit) => {
    const b = JSON.parse(init.body as string) as { action: string; context: { memberships: { role: string }[] } };
    const allow = b.action === "organization.invitation.create" && b.context.memberships.some((m) => m.role === "owner" || m.role === "admin");
    return Response.json({ data: { allow, reason: allow ? "granted" : "no_matching_role", policyVersion: 1, derivedScope: {} } });
  },
} as unknown as Fetcher;

const limit = (limitValue: number | null): typeof checkBillingEntitlement =>
  (async (_b: Fetcher, orgId: string, key: string) => ({
    kind: "decision" as const,
    decision: { allowed: true, orgId, entitlementKey: key, valueType: "quantity", limitValue, source: "plan", subscriptionId: null },
  })) as unknown as typeof checkBillingEntitlement;

const env = (extra: Partial<Env> = {}): Env => ({ POLICY_WORKER: policy, PLATFORM_DB: {} as D1Database, ENVIRONMENT: "test", ...extra }) as Env;
const actor = (subjectId: string) => ({ subjectId, subjectType: "user" });
const post = (body: unknown) =>
  new Request(`https://membership.internal/v1/organizations/${T}/members`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const call = (w: ReturnType<typeof world>, as: string, body: unknown, over: Partial<JoinLinkDeps> = {}, e: Env = env()) =>
  handleAddMembers(post(body), e, "req_1", actor(as), T, { repo: w.repo, eventsRepo, now: () => NOW, checkEntitlement: limit(null), ...over });
const data = async (res: Response) => ((await res.json()) as { data: AddMembersResponse; error: { details: { reason?: string } } });

/** Dev owns the flat and is in Goa with Anu, Meera and Kit. */
function standard() {
  const w = world();
  w.person(TARGET, "usr_dev", "owner");
  for (const id of ["usr_dev", "usr_anu", "usr_meera", "usr_kit"]) w.person(SOURCE, id);
  return w;
}

describe("POST /v1/organizations/:org/members", () => {
  beforeEach(() => void (events.length = 0));

  it("adds people from the source group as members, visible at once, and audits each", async () => {
    const w = standard();
    const res = await call(w, "usr_dev", { sourceGroupId: S, subjectIds: ["usr_anu", "usr_meera"] });
    expect(res.status).toBe(200);
    const { data: d } = await data(res);
    expect(d).toMatchObject({ orgId: T, skipped: [] });
    expect(d.added.map((a) => a.subjectId)).toEqual(["usr_anu", "usr_meera"]);
    expect(d.added[0]!.memberId).toMatch(/^mem_/);
    expect(w.active(TARGET, "usr_anu")).toBeDefined();
    expect(w.roles.find((r) => r.orgId === TARGET && r.subjectId === "usr_meera")!.role).toBe("builder");
    expect(events.map((e) => [e.event.type, e.event.orgId, e.event.actorId])).toEqual([
      ["membership.member_added", TARGET, "usr_dev"],
      ["membership.member_added", TARGET, "usr_dev"],
    ]);
  });

  it("is for owners and admins of the target only; an admin may", async () => {
    const w = standard();
    w.person(TARGET, "usr_anu", "builder");
    const member = await call(w, "usr_anu", { sourceGroupId: S, subjectIds: ["usr_kit"] });
    expect(member.status).toBe(404);
    const stranger = await call(w, "usr_zed", { sourceGroupId: S, subjectIds: ["usr_kit"] });
    expect(stranger.status).toBe(404);
    expect(w.active(TARGET, "usr_kit")).toBeUndefined();
    w.person(TARGET, "usr_meera", "admin");
    expect((await call(w, "usr_meera", { sourceGroupId: S, subjectIds: ["usr_kit"] })).status).toBe(200);
  });

  it("refuses a caller who is not in the source group, and a source that is not a Spliteco group", async () => {
    const w = standard();
    w.person(TARGET, "usr_boss", "owner"); // owns the target, never in Goa
    const out = await call(w, "usr_boss", { sourceGroupId: S, subjectIds: ["usr_anu"] });
    expect(out.status).toBe(403);
    expect((await data(out)).error.details.reason).toBe("not_in_source_group");
    expect(w.active(TARGET, "usr_anu")).toBeUndefined();
    w.org(OTHER, "kitchen", "cookpool");
    w.person(OTHER, "usr_dev");
    w.person(OTHER, "usr_anu");
    expect((await call(w, "usr_dev", { sourceGroupId: orgPublicId(OTHER), subjectIds: ["usr_anu"] })).status).toBe(403);
    expect((await call(w, "usr_dev", { sourceGroupId: orgPublicId(asUuid("00000000-0000-4000-8000-000000000000")), subjectIds: ["usr_anu"] })).status).toBe(403);
  });

  it("skips, with reasons, anyone not in the source group or already a member — without failing the call", async () => {
    const w = standard();
    w.person(TARGET, "usr_anu");
    const res = await call(w, "usr_dev", { sourceGroupId: S, subjectIds: ["usr_anu", "usr_nobody", "usr_kit", "usr_kit"] });
    expect(res.status).toBe(200);
    const { data: d } = await data(res);
    expect(d.added.map((a) => a.subjectId)).toEqual(["usr_kit"]);
    expect(d.skipped).toEqual([
      { subjectId: "usr_anu", reason: "already_member" },
      { subjectId: "usr_nobody", reason: "not_in_source_group" },
    ]);
  });

  it("skips a person already in the most groups allowed, and a full group, others still added", async () => {
    const w = standard();
    for (let i = 0; i < 50; i++) {
      const id = `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`;
      w.org(id, `g${i}`, "cookpool");
      w.person(id, "usr_anu");
    }
    const open = env({ OPEN_GROUPS: "true" });
    const res = await call(w, "usr_dev", { sourceGroupId: S, subjectIds: ["usr_anu", "usr_meera"] }, {}, open);
    expect((await data(res)).data).toMatchObject({
      added: [{ subjectId: "usr_meera" }],
      skipped: [{ subjectId: "usr_anu", reason: "groups_per_person" }],
    });
    // 2 members now; a limit of 3 leaves room for one more.
    const full = await call(w, "usr_dev", { sourceGroupId: S, subjectIds: ["usr_kit", "usr_anu"] }, { checkEntitlement: limit(3) }, env());
    expect((await data(full)).data).toMatchObject({ added: [{ subjectId: "usr_kit" }], skipped: [{ subjectId: "usr_anu", reason: "group_full" }] });
  });

  it("answers the same on a retry: nobody is added twice, and the edge replays by key", async () => {
    const w = standard();
    const body = { sourceGroupId: S, subjectIds: ["usr_anu", "usr_kit"] };
    await call(w, "usr_dev", body);
    const again = await data(await call(w, "usr_dev", body));
    expect(again.data.added).toEqual([]);
    expect(again.data.skipped.map((s) => s.reason)).toEqual(["already_member", "already_member"]);
    expect(w.members.filter((m) => m.orgId === TARGET && m.subjectId === "usr_anu")).toHaveLength(1);
    expect(events).toHaveLength(2);
  });

  it("rejects a bad body", async () => {
    const w = standard();
    for (const body of [{}, { sourceGroupId: S }, { sourceGroupId: S, subjectIds: [] }, { sourceGroupId: "nope", subjectIds: ["usr_a"] }, { sourceGroupId: S, subjectIds: [1] }]) {
      expect((await call(w, "usr_dev", body)).status).toBe(422);
    }
    expect((await call(w, "usr_dev", { sourceGroupId: S, subjectIds: Array.from({ length: 51 }, (_, i) => `usr_${i}`) })).status).toBe(422);
  });

  it("is routed: POST on a group's members reaches it, signed in only", async () => {
    const unsigned = await route(new Request(`https://membership.internal/v1/organizations/${T}/members`, { method: "POST", body: "{}" }), env());
    expect(unsigned.status).toBe(401);
  });
});
