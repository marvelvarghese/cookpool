// Tests for the 9 fanned-out resource clients added in Task 0099.
//
// Coverage strategy per resource (mirrors the orgs/projects pilot in
// `sdk.test.ts`): one URL-shape test, one idempotency-key passthrough test
// (when the resource has a POST that accepts one), and one error-decoding
// test that the typed error subclass propagates.

import { describe, expect, it, vi } from "vitest";

import { Cookpool } from "../index.js";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  RateLimitError,
  ValidationError,
} from "../errors.js";

interface CapturedCall {
  url: string;
  init: RequestInit;
}

function captureFetch(response: Response): {
  fetch: typeof fetch;
  calls: CapturedCall[];
} {
  const calls: CapturedCall[] = [];
  const fn: typeof fetch = vi.fn(async (input, init) => {
    calls.push({ url: String(input), init: init ?? {} });
    return response.clone();
  });
  return { fetch: fn, calls };
}

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init.headers ?? {}),
    },
  });
}

function envelope<T>(data: T): { data: T; meta: { requestId: string; cursor: null } } {
  return { data, meta: { requestId: "req_test", cursor: null } };
}

function errorResponse(code: string, status: number): Response {
  return jsonResponse(
    {
      error: {
        code,
        message: `synthetic ${code}`,
        details: { fields: { foo: ["bar"] } },
        requestId: "req_err",
      },
    },
    { status },
  );
}

type FetchImpl = typeof fetch;

function client(fetchImpl: FetchImpl): Cookpool {
  return new Cookpool({ baseUrl: "https://api.test", fetch: fetchImpl });
}

// ---------------------------------------------------------------------------
// Memberships
// ---------------------------------------------------------------------------

describe("MembershipsClient", () => {
  it("listMembers hits the org-scoped members path", async () => {
    const { fetch, calls } = captureFetch(jsonResponse(envelope({ members: [] })));
    await client(fetch).memberships.listMembers("org_1");
    expect(calls[0]!.url).toBe("https://api.test/v1/organizations/org_1/members");
    expect(calls[0]!.init.method).toBe("GET");
  });

  it("createInvitation propagates idempotency-key", async () => {
    const { fetch, calls } = captureFetch(
      jsonResponse(envelope({ invitation: {} }), { status: 201 }),
    );
    await client(fetch).memberships.createInvitation(
      "org_1",
      { email: "a@b.test", role: "viewer" },
      { idempotencyKey: "ikey_inv_1" },
    );
    const headers = new Headers(calls[0]!.init.headers as HeadersInit);
    expect(headers.get("idempotency-key")).toBe("ikey_inv_1");
    expect(calls[0]!.url).toBe(
      "https://api.test/v1/organizations/org_1/invitations",
    );
    expect(calls[0]!.init.method).toBe("POST");
  });

  it("acceptInvitation issues POST on the accept path", async () => {
    const { fetch, calls } = captureFetch(
      jsonResponse(envelope({ invitation: {}, membership: {} })),
    );
    await client(fetch).memberships.acceptInvitation("org_1", { token: "tok_x" });
    expect(calls[0]!.url).toBe(
      "https://api.test/v1/organizations/org_1/invitations/accept",
    );
    expect(calls[0]!.init.method).toBe("POST");
  });

  it("removeMember surfaces ForbiddenError on 403", async () => {
    const { fetch } = captureFetch(errorResponse("forbidden", 403));
    await expect(
      client(fetch).memberships.removeMember("org_1", "mem_1"),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  // Join links (Cookpool CP-3)

  it("getJoinCode and rotateJoinCode hit the org's join-code paths", async () => {
    const { fetch, calls } = captureFetch(jsonResponse(envelope({ code: "KTCH2345" })));
    const memberships = client(fetch).memberships;
    expect(await memberships.getJoinCode("org_1")).toEqual({ code: "KTCH2345" });
    await memberships.rotateJoinCode("org_1", { idempotencyKey: "ikey_rot_1" });
    expect(calls[0]!.url).toBe("https://api.test/v1/organizations/org_1/join-code");
    expect(calls[0]!.init.method).toBe("GET");
    expect(calls[1]!.url).toBe("https://api.test/v1/organizations/org_1/join-code/rotate");
    expect(calls[1]!.init.method).toBe("POST");
    expect(new Headers(calls[1]!.init.headers as HeadersInit).get("idempotency-key")).toBe("ikey_rot_1");
  });

  it("previewJoin encodes the code into the path", async () => {
    const preview = { orgId: "org_1", name: "Flat 4B", slug: "flat-4b", memberCount: 3, alreadyMember: false };
    const { fetch, calls } = captureFetch(jsonResponse(envelope(preview)));
    expect(await client(fetch).memberships.previewJoin("KTCH 2345")).toEqual(preview);
    expect(calls[0]!.url).toBe("https://api.test/v1/join/KTCH%202345");
    expect(calls[0]!.init.method).toBe("GET");
  });

  // The signed-out join preview (Cookpool SI-4)

  it("previewJoinPublic reads /v1/join/:code/preview with no token", async () => {
    const preview = { groupName: "Flat 4B", inviterFirstName: "Anu", memberCount: 5 };
    const { fetch, calls } = captureFetch(jsonResponse(envelope(preview)));
    expect(await client(fetch).memberships.previewJoinPublic("KTCH2345")).toEqual(preview);
    expect(calls[0]!.url).toBe("https://api.test/v1/join/KTCH2345/preview");
    expect(calls[0]!.init.method).toBe("GET");
    const headers = new Headers(calls[0]!.init.headers as HeadersInit);
    expect(headers.get("authorization")).toBeNull();
    expect(headers.has("x-request-id")).toBe(true);
  });

  it("previewJoinPublic sends no credential even from a signed-in client, and other calls still do", async () => {
    const preview = { groupName: "Flat 4B", inviterFirstName: null, memberCount: 1 };
    const { fetch, calls } = captureFetch(jsonResponse(envelope(preview)));
    const signedIn = new Cookpool({
      baseUrl: "https://api.test",
      fetch,
      auth: { kind: "bearer", token: "sps_ses_abc.secret" },
      defaultHeaders: { cookie: "session=abc", authorization: "Bearer default", "x-client": "console" },
    });
    await signedIn.memberships.previewJoinPublic("KTCH2345");
    await signedIn.memberships.previewJoin("KTCH2345");

    const anonymous = new Headers(calls[0]!.init.headers as HeadersInit);
    expect(anonymous.get("authorization")).toBeNull();
    expect(anonymous.get("cookie")).toBeNull();
    expect(anonymous.get("x-client")).toBe("console");
    const authed = new Headers(calls[1]!.init.headers as HeadersInit);
    expect(authed.get("authorization")).toBe("Bearer sps_ses_abc.secret");
  });

  it("previewJoinPublic encodes the code into one path segment", async () => {
    const { fetch, calls } = captureFetch(jsonResponse(envelope({ groupName: "x", inviterFirstName: null, memberCount: 0 })));
    await client(fetch).memberships.previewJoinPublic("KTCH/23 45");
    expect(calls[0]!.url).toBe("https://api.test/v1/join/KTCH%2F23%2045/preview");
  });

  it("previewJoinPublic surfaces an unknown code as NotFoundError and a flood as RateLimitError", async () => {
    const missing = captureFetch(errorResponse("not_found", 404));
    await expect(client(missing.fetch).memberships.previewJoinPublic("ZZZZ2345")).rejects.toBeInstanceOf(NotFoundError);
    const limited = captureFetch(errorResponse("rate_limited", 429));
    await expect(client(limited.fetch).memberships.previewJoinPublic("ZZZZ2345")).rejects.toBeInstanceOf(RateLimitError);
  });

  it("join posts the code with the caller's idempotency key", async () => {
    const joined = { orgId: "org_1", slug: "flat-4b", memberId: "mem_1", alreadyMember: false };
    const { fetch, calls } = captureFetch(jsonResponse(envelope(joined), { status: 201 }));
    expect(await client(fetch).memberships.join("KTCH2345", { idempotencyKey: "ikey_join_1" })).toEqual(joined);
    expect(calls[0]!.url).toBe("https://api.test/v1/join");
    expect(calls[0]!.init.method).toBe("POST");
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({ code: "KTCH2345" });
    expect(new Headers(calls[0]!.init.headers as HeadersInit).get("idempotency-key")).toBe("ikey_join_1");
  });

  it("join surfaces an unknown code as NotFoundError", async () => {
    const { fetch } = captureFetch(errorResponse("not_found", 404));
    await expect(client(fetch).memberships.join("NOPE2345")).rejects.toBeInstanceOf(NotFoundError);
  });

  it("leave posts to the org's leave path and surfaces last_owner as ConflictError", async () => {
    const { fetch, calls } = captureFetch(jsonResponse(envelope({ orgId: "org_1", memberId: "mem_1", left: true })));
    expect(await client(fetch).memberships.leave("org_1")).toEqual({ orgId: "org_1", memberId: "mem_1", left: true });
    expect(calls[0]!.url).toBe("https://api.test/v1/organizations/org_1/leave");
    expect(calls[0]!.init.method).toBe("POST");

    const refused = captureFetch(errorResponse("conflict", 409));
    await expect(client(refused.fetch).memberships.leave("org_1")).rejects.toBeInstanceOf(ConflictError);
  });

  it("leave surfaces balance_not_settled as ConflictError with the balance (Cookpool CP-19)", async () => {
    const details = { reason: "balance_not_settled", balanceMinor: -1250, currency: "INR" };
    const { fetch } = captureFetch(
      jsonResponse({ error: { code: "conflict", message: "Settle up first", details, requestId: "req_err" } }, { status: 409 }),
    );
    const failure = await client(fetch).memberships.leave("org_1").catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(ConflictError);
    expect((failure as ConflictError).details).toEqual(details);
  });
});

// ---------------------------------------------------------------------------
// API keys
// ---------------------------------------------------------------------------

describe("ApiKeysClient", () => {
  it("list hits the org-scoped api-keys path", async () => {
    const { fetch, calls } = captureFetch(jsonResponse(envelope({ apiKeys: [] })));
    await client(fetch).apiKeys.list("org_1");
    expect(calls[0]!.url).toBe("https://api.test/v1/organizations/org_1/api-keys");
  });

  it("create propagates idempotency-key", async () => {
    const { fetch, calls } = captureFetch(
      jsonResponse(envelope({ apiKey: {} }), { status: 201 }),
    );
    await client(fetch).apiKeys.create(
      "org_1",
      { label: "ci", role: "viewer" },
      { idempotencyKey: "ikey_ak_1" },
    );
    const headers = new Headers(calls[0]!.init.headers as HeadersInit);
    expect(headers.get("idempotency-key")).toBe("ikey_ak_1");
  });

  it("revoke issues DELETE on the scoped path", async () => {
    const { fetch, calls } = captureFetch(jsonResponse(envelope({ apiKey: {} })));
    await client(fetch).apiKeys.revoke("org_1", "ak_42");
    expect(calls[0]!.init.method).toBe("DELETE");
    expect(calls[0]!.url).toBe(
      "https://api.test/v1/organizations/org_1/api-keys/ak_42",
    );
  });

  it("get surfaces NotFoundError on 404", async () => {
    const { fetch } = captureFetch(errorResponse("not_found", 404));
    await expect(client(fetch).apiKeys.get("org_1", "ak_x")).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });
});

// ---------------------------------------------------------------------------
// Webhooks
// ---------------------------------------------------------------------------

describe("WebhooksClient", () => {
  it("listEndpoints hits the org-scoped endpoints path", async () => {
    const { fetch, calls } = captureFetch(
      jsonResponse(envelope({ endpoints: [], nextCursor: null })),
    );
    await client(fetch).webhooks.listEndpoints("org_1");
    expect(calls[0]!.url).toBe(
      "https://api.test/v1/organizations/org_1/webhooks/endpoints",
    );
  });

  it("listProjectEndpoints hits the project-scoped surface", async () => {
    const { fetch, calls } = captureFetch(
      jsonResponse(envelope({ endpoints: [], nextCursor: null })),
    );
    await client(fetch).webhooks.listProjectEndpoints("org_1", "proj_1");
    expect(calls[0]!.url).toBe(
      "https://api.test/v1/organizations/org_1/projects/proj_1/webhooks/endpoints",
    );
  });

  it("createEndpoint propagates idempotency-key on org scope", async () => {
    const { fetch, calls } = captureFetch(
      jsonResponse(envelope({ endpoint: {} }), { status: 201 }),
    );
    await client(fetch).webhooks.createEndpoint(
      "org_1",
      { url: "https://hook.test" },
      { idempotencyKey: "ikey_wh_1" },
    );
    const headers = new Headers(calls[0]!.init.headers as HeadersInit);
    expect(headers.get("idempotency-key")).toBe("ikey_wh_1");
    expect(calls[0]!.init.method).toBe("POST");
  });

  it("rotateSecret hits the rotate-secret subpath as POST", async () => {
    const { fetch, calls } = captureFetch(jsonResponse(envelope({ endpoint: {} })));
    await client(fetch).webhooks.rotateSecret("org_1", "wh_1");
    expect(calls[0]!.url).toBe(
      "https://api.test/v1/organizations/org_1/webhooks/endpoints/wh_1/rotate-secret",
    );
    expect(calls[0]!.init.method).toBe("POST");
  });

  it("enableEndpoint hits the enable subpath as POST with empty body", async () => {
    const { fetch, calls } = captureFetch(jsonResponse(envelope({ endpoint: { status: "active" } })));
    await client(fetch).webhooks.enableEndpoint("org_1", "wh_1");
    expect(calls[0]!.url).toBe(
      "https://api.test/v1/organizations/org_1/webhooks/endpoints/wh_1/enable",
    );
    expect(calls[0]!.init.method).toBe("POST");
  });

  it("enableEndpoint surfaces NotFoundError on 404 (already-active or missing)", async () => {
    const { fetch } = captureFetch(errorResponse("not_found", 404));
    await expect(
      client(fetch).webhooks.enableEndpoint("org_1", "wh_missing"),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("getDeliveryAttempt surfaces NotFoundError on 404", async () => {
    const { fetch } = captureFetch(errorResponse("not_found", 404));
    await expect(
      client(fetch).webhooks.getDeliveryAttempt("org_1", "att_x"),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("listDeliveryAttempts hits the endpoint-scoped path with no query when none given", async () => {
    const { fetch, calls } = captureFetch(
      jsonResponse(envelope({ deliveryAttempts: [], nextCursor: null })),
    );
    await client(fetch).webhooks.listDeliveryAttempts("org_1", "wh_1");
    expect(calls[0]!.url).toBe(
      "https://api.test/v1/organizations/org_1/webhooks/endpoints/wh_1/delivery-attempts",
    );
    expect(calls[0]!.init.method).toBe("GET");
  });

  it("listDeliveryAttempts threads limit + cursor into the query string", async () => {
    const { fetch, calls } = captureFetch(
      jsonResponse(envelope({ deliveryAttempts: [], nextCursor: null })),
    );
    await client(fetch).webhooks.listDeliveryAttempts("org_1", "wh_1", {
      limit: 25,
      cursor: "CURSOR_TOKEN_ABC",
    });
    const url = new URL(calls[0]!.url);
    expect(url.pathname).toBe(
      "/v1/organizations/org_1/webhooks/endpoints/wh_1/delivery-attempts",
    );
    expect(url.searchParams.get("limit")).toBe("25");
    expect(url.searchParams.get("cursor")).toBe("CURSOR_TOKEN_ABC");
  });

  it("listDeliveryAttempts omits limit/cursor when only one is supplied", async () => {
    const { fetch, calls } = captureFetch(
      jsonResponse(envelope({ deliveryAttempts: [], nextCursor: null })),
    );
    await client(fetch).webhooks.listDeliveryAttempts("org_1", "wh_1", {
      limit: 10,
    });
    const url = new URL(calls[0]!.url);
    expect(url.searchParams.get("limit")).toBe("10");
    expect(url.searchParams.has("cursor")).toBe(false);
  });

  it("listDeliveryAttemptsPage round-trips meta.cursor as nextCursor", async () => {
    const { fetch } = captureFetch(
      jsonResponse({
        data: { deliveryAttempts: [{ id: "att_1" }], nextCursor: null },
        meta: { requestId: "req_test", cursor: "NEXT_PAGE_CURSOR" },
      }),
    );
    const page = await client(fetch).webhooks.listDeliveryAttemptsPage(
      "org_1",
      "wh_1",
      { limit: 1 },
    );
    expect(page.deliveryAttempts).toHaveLength(1);
    expect(page.nextCursor).toBe("NEXT_PAGE_CURSOR");
  });

  it("listDeliveryAttemptsPage returns nextCursor null on the last page", async () => {
    const { fetch, calls } = captureFetch(
      jsonResponse(envelope({ deliveryAttempts: [], nextCursor: null })),
    );
    const page = await client(fetch).webhooks.listDeliveryAttemptsPage(
      "org_1",
      "wh_1",
      { cursor: "PREV_CURSOR" },
    );
    expect(page.nextCursor).toBeNull();
    // The supplied cursor was forwarded as the request query param.
    expect(new URL(calls[0]!.url).searchParams.get("cursor")).toBe("PREV_CURSOR");
  });

  it("replayDelivery hits the replay subpath as POST with empty body", async () => {
    const { fetch, calls } = captureFetch(
      jsonResponse(
        envelope({ deliveryAttempt: { id: "whd_new", status: "success" } }),
        { status: 201 },
      ),
    );
    const res = await client(fetch).webhooks.replayDelivery("org_1", "whd_old");
    expect(calls[0]!.url).toBe(
      "https://api.test/v1/organizations/org_1/webhooks/delivery-attempts/whd_old/replay",
    );
    expect(calls[0]!.init.method).toBe("POST");
    expect(res.deliveryAttempt.id).toBe("whd_new");
  });

  it("replayDelivery propagates an idempotency-key when supplied", async () => {
    const { fetch, calls } = captureFetch(
      jsonResponse(envelope({ deliveryAttempt: { id: "whd_new" } }), {
        status: 201,
      }),
    );
    await client(fetch).webhooks.replayDelivery("org_1", "whd_old", {
      idempotencyKey: "ikey_replay_1",
    });
    const headers = new Headers(calls[0]!.init.headers as HeadersInit);
    expect(headers.get("idempotency-key")).toBe("ikey_replay_1");
  });

  it("replayDelivery surfaces NotFoundError on 404", async () => {
    const { fetch } = captureFetch(errorResponse("not_found", 404));
    await expect(
      client(fetch).webhooks.replayDelivery("org_1", "whd_missing"),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

// ---------------------------------------------------------------------------
// Metering
// ---------------------------------------------------------------------------

describe("MeteringClient", () => {
  it("recordUsage hits the org-scoped usage path", async () => {
    const { fetch, calls } = captureFetch(
      jsonResponse(envelope({ usageRecord: {} }), { status: 201 }),
    );
    await client(fetch).metering.recordUsage("org_1", {
      metric: "api_requests",
      idempotencyKey: "u_1",
    });
    expect(calls[0]!.url).toBe(
      "https://api.test/v1/organizations/org_1/usage",
    );
    expect(calls[0]!.init.method).toBe("POST");
  });

  it("ingestUsageBatch propagates idempotency-key header", async () => {
    const { fetch, calls } = captureFetch(jsonResponse(envelope({ results: [] })));
    await client(fetch).metering.ingestUsageBatch(
      "org_1",
      { records: [] },
      { idempotencyKey: "ikey_batch_1" },
    );
    const headers = new Headers(calls[0]!.init.headers as HeadersInit);
    expect(headers.get("idempotency-key")).toBe("ikey_batch_1");
    expect(calls[0]!.url).toBe(
      "https://api.test/v1/organizations/org_1/usage/batch",
    );
  });

  it("getUsageSummary builds query string from filters", async () => {
    const { fetch, calls } = captureFetch(
      jsonResponse(
        envelope({
          metric: "api_requests",
          totalQuantity: 0,
          totalRecords: 0,
          rollups: [],
        }),
      ),
    );
    await client(fetch).metering.getUsageSummary("org_1", {
      metric: "api_requests",
      bucketType: "day",
      projectId: "proj_1",
    });
    expect(calls[0]!.url).toContain("/usage/summary");
    expect(calls[0]!.url).toContain("metric=api_requests");
    expect(calls[0]!.url).toContain("bucketType=day");
    expect(calls[0]!.url).toContain("projectId=proj_1");
  });

  it("checkQuota surfaces ValidationError on 422", async () => {
    const { fetch } = captureFetch(errorResponse("validation_failed", 422));
    await expect(
      client(fetch).metering.checkQuota("org_1", { metric: "x" }),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});

// ---------------------------------------------------------------------------
// Billing
// ---------------------------------------------------------------------------

describe("BillingClient", () => {
  it("listPlans hits the org-scoped plans path", async () => {
    const { fetch, calls } = captureFetch(jsonResponse(envelope({ plans: [] })));
    await client(fetch).billing.listPlans("org_1");
    expect(calls[0]!.url).toBe(
      "https://api.test/v1/organizations/org_1/billing/plans",
    );
  });

  it("listInvoices forwards cursor and status filters", async () => {
    const { fetch, calls } = captureFetch(
      jsonResponse(envelope({ invoices: [], nextCursor: null })),
    );
    await client(fetch).billing.listInvoices("org_1", {
      status: "open",
      limit: 25,
    });
    expect(calls[0]!.url).toContain("status=open");
    expect(calls[0]!.url).toContain("limit=25");
  });

  it("checkEntitlement issues POST on the entitlements/check path", async () => {
    const { fetch, calls } = captureFetch(
      jsonResponse(
        envelope({
          allowed: false,
          orgId: "org_1",
          entitlementKey: "feature.x",
          reason: "not_configured",
        }),
      ),
    );
    await client(fetch).billing.checkEntitlement("org_1", {
      entitlementKey: "feature.x",
    });
    expect(calls[0]!.url).toBe(
      "https://api.test/v1/organizations/org_1/billing/entitlements/check",
    );
    expect(calls[0]!.init.method).toBe("POST");
  });

  it("getSummary surfaces ForbiddenError on 403", async () => {
    const { fetch } = captureFetch(errorResponse("forbidden", 403));
    await expect(client(fetch).billing.getSummary("org_1")).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });
});

// ---------------------------------------------------------------------------
// Events (audit)
// ---------------------------------------------------------------------------

describe("EventsClient", () => {
  it("listAuditEntries (by:org) hits the org-scoped audit path", async () => {
    const { fetch, calls } = captureFetch(
      jsonResponse(envelope({ auditEntries: [] })),
    );
    await client(fetch).events.listAuditEntries("org_1", {
      by: "org",
      category: "authz",
      limit: 50,
    });
    expect(calls[0]!.url).toContain(
      "https://api.test/v1/organizations/org_1/audit",
    );
    expect(calls[0]!.url).toContain("category=authz");
    expect(calls[0]!.url).toContain("limit=50");
  });

  it("listAuditEntries (by:target) sends subjectKind+subjectId", async () => {
    const { fetch, calls } = captureFetch(
      jsonResponse(envelope({ auditEntries: [] })),
    );
    await client(fetch).events.listAuditEntries("org_1", {
      by: "target",
      subjectKind: "project",
      subjectId: "proj_1",
    });
    expect(calls[0]!.url).toContain("subjectKind=project");
    expect(calls[0]!.url).toContain("subjectId=proj_1");
  });

  it("listAuditEntries surfaces NotFoundError on 404", async () => {
    const { fetch } = captureFetch(errorResponse("not_found", 404));
    await expect(
      client(fetch).events.listAuditEntries("org_x"),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

// ---------------------------------------------------------------------------
// Security events
// ---------------------------------------------------------------------------

describe("SecurityEventsClient", () => {
  it("list hits /v1/auth/security-events", async () => {
    const { fetch, calls } = captureFetch(
      jsonResponse(envelope({ securityEvents: [] })),
    );
    await client(fetch).securityEvents.list();
    expect(calls[0]!.url).toBe("https://api.test/v1/auth/security-events");
    expect(calls[0]!.init.method).toBe("GET");
  });

  it("list threads limit + opaque cursor into the query verbatim", async () => {
    const { fetch, calls } = captureFetch(
      jsonResponse(envelope({ securityEvents: [] })),
    );
    const opaque = "eyJjcm...2In0=";
    await client(fetch).securityEvents.list({ limit: 25, cursor: opaque });
    expect(calls[0]!.url).toContain("limit=25");
    expect(calls[0]!.url).toContain(`cursor=${encodeURIComponent(opaque)}`);
  });

  it("listPage surfaces meta.cursor as nextCursor", async () => {
    const { fetch } = captureFetch(
      jsonResponse({
        data: { securityEvents: [{ id: "se_1" }] },
        meta: { requestId: "req_1", cursor: "CUR_NEXT" },
      }),
    );
    const page = await client(fetch).securityEvents.listPage();
    expect(page.securityEvents).toHaveLength(1);
    expect(page.nextCursor).toBe("CUR_NEXT");
  });

  it("listPage returns nextCursor null when the server omits meta.cursor", async () => {
    const { fetch } = captureFetch(
      jsonResponse({
        data: { securityEvents: [] },
        meta: { requestId: "req_1" },
      }),
    );
    const page = await client(fetch).securityEvents.listPage();
    expect(page.nextCursor).toBeNull();
  });

  it("listPage forwards the opaque cursor verbatim on the follow-up page", async () => {
    const { fetch, calls } = captureFetch(
      jsonResponse({
        data: { securityEvents: [] },
        meta: { requestId: "req_1", cursor: null },
      }),
    );
    const opaque = "eyJvZmZzZXQ...In0=";
    await client(fetch).securityEvents.listPage({ cursor: opaque });
    expect(calls[0]!.url).toContain(`cursor=${encodeURIComponent(opaque)}`);
  });

  it("surfaces ForbiddenError on 403", async () => {
    const { fetch } = captureFetch(errorResponse("forbidden", 403));
    await expect(client(fetch).securityEvents.list()).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });
});

// ---------------------------------------------------------------------------
// Config (settings / feature-flags / secrets across 3 scopes)
// ---------------------------------------------------------------------------

describe("ConfigClient", () => {
  it("listSettings (organization scope) hits org config path", async () => {
    const { fetch, calls } = captureFetch(jsonResponse(envelope({ settings: [] })));
    await client(fetch).config.listSettings({ kind: "organization", orgId: "org_1" });
    expect(calls[0]!.url).toBe(
      "https://api.test/v1/organizations/org_1/config/settings",
    );
  });

  it("listSettings (project scope) hits project config path", async () => {
    const { fetch, calls } = captureFetch(jsonResponse(envelope({ settings: [] })));
    await client(fetch).config.listSettings({
      kind: "project",
      orgId: "org_1",
      projectId: "proj_1",
    });
    expect(calls[0]!.url).toBe(
      "https://api.test/v1/organizations/org_1/projects/proj_1/config/settings",
    );
  });

  it("listSettings (environment scope) hits env config path", async () => {
    const { fetch, calls } = captureFetch(jsonResponse(envelope({ settings: [] })));
    await client(fetch).config.listSettings({
      kind: "environment",
      orgId: "org_1",
      projectId: "proj_1",
      environmentId: "env_1",
    });
    expect(calls[0]!.url).toBe(
      "https://api.test/v1/organizations/org_1/projects/proj_1/environments/env_1/config/settings",
    );
  });

  it("createFeatureFlag propagates idempotency-key", async () => {
    const { fetch, calls } = captureFetch(
      jsonResponse(envelope({ featureFlag: {} }), { status: 201 }),
    );
    await client(fetch).config.createFeatureFlag(
      { kind: "organization", orgId: "org_1" },
      { flagKey: "x", enabled: true },
      { idempotencyKey: "ikey_ff_1" },
    );
    const headers = new Headers(calls[0]!.init.headers as HeadersInit);
    expect(headers.get("idempotency-key")).toBe("ikey_ff_1");
    expect(calls[0]!.url).toBe(
      "https://api.test/v1/organizations/org_1/config/feature-flags",
    );
  });

  it("rotateSecret hits the rotate subpath as POST (env scope)", async () => {
    const { fetch, calls } = captureFetch(jsonResponse(envelope({ secret: {} })));
    await client(fetch).config.rotateSecret(
      {
        kind: "environment",
        orgId: "org_1",
        projectId: "proj_1",
        environmentId: "env_1",
      },
      "DATABASE_URL",
      { value: "new-value-redacted-from-test" },
    );
    expect(calls[0]!.url).toBe(
      "https://api.test/v1/organizations/org_1/projects/proj_1/environments/env_1/config/secrets/DATABASE_URL/rotate",
    );
    expect(calls[0]!.init.method).toBe("POST");
  });

  it("revokeSecret issues DELETE on the scoped secret path", async () => {
    const { fetch, calls } = captureFetch(jsonResponse(envelope({ secret: {} })));
    await client(fetch).config.revokeSecret(
      { kind: "organization", orgId: "org_1" },
      "API_KEY",
    );
    expect(calls[0]!.url).toBe(
      "https://api.test/v1/organizations/org_1/config/secrets/API_KEY",
    );
    expect(calls[0]!.init.method).toBe("DELETE");
  });

  it("createSetting surfaces ConflictError on 409", async () => {
    const { fetch } = captureFetch(errorResponse("conflict", 409));
    await expect(
      client(fetch).config.createSetting(
        { kind: "organization", orgId: "org_1" },
        { key: "x", value: 1 },
      ),
    ).rejects.toBeInstanceOf(ConflictError);
  });
});

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

describe("NotificationsClient", () => {
  it("enqueue hits /v1/notifications as POST", async () => {
    const { fetch, calls } = captureFetch(
      jsonResponse(envelope({ notification: {} }), { status: 201 }),
    );
    await client(fetch).notifications.enqueue({
      orgId: "org_1",
      category: "billing",
      templateKey: "billing.receipt",
      recipient: { channel: "email", address: "a@b.test" },
    });
    expect(calls[0]!.url).toBe("https://api.test/v1/notifications");
    expect(calls[0]!.init.method).toBe("POST");
  });

  it("enqueue propagates idempotency-key", async () => {
    const { fetch, calls } = captureFetch(
      jsonResponse(envelope({ notification: {} }), { status: 201 }),
    );
    await client(fetch).notifications.enqueue(
      {
        orgId: "org_1",
        category: "invitation",
        templateKey: "invitation.created",
        recipient: { channel: "email", address: "a@b.test" },
      },
      { idempotencyKey: "ikey_n_1" },
    );
    const headers = new Headers(calls[0]!.init.headers as HeadersInit);
    expect(headers.get("idempotency-key")).toBe("ikey_n_1");
  });

  it("get fetches a notification by id", async () => {
    const { fetch, calls } = captureFetch(
      jsonResponse(envelope({ notification: {} })),
    );
    await client(fetch).notifications.get("notif_42");
    expect(calls[0]!.url).toBe("https://api.test/v1/notifications/notif_42");
    expect(calls[0]!.init.method).toBe("GET");
  });

  it("updatePreferences issues PUT on preferences path", async () => {
    const { fetch, calls } = captureFetch(
      jsonResponse(envelope({ preference: {} })),
    );
    await client(fetch).notifications.updatePreferences({
      orgId: "org_1",
      subjectKind: "user",
      subjectId: "user_1",
      channel: "email",
      categories: { billing: true },
    });
    expect(calls[0]!.url).toBe("https://api.test/v1/notifications/preferences");
    expect(calls[0]!.init.method).toBe("PUT");
  });

  it("suppressRecipient hits the recipients suppress path", async () => {
    const { fetch, calls } = captureFetch(
      jsonResponse(envelope({ suppression: {} })),
    );
    await client(fetch).notifications.suppressRecipient(
      "a@b.test",
      { orgId: "org_1", channel: "email", reason: "bounce" },
    );
    expect(calls[0]!.url).toBe(
      "https://api.test/v1/notifications/recipients/a%40b.test/suppress",
    );
    expect(calls[0]!.init.method).toBe("POST");
  });

  it("get surfaces NotFoundError on 404", async () => {
    const { fetch } = captureFetch(errorResponse("not_found", 404));
    await expect(
      client(fetch).notifications.get("missing"),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  // Web Push (Cookpool PW-5).
  const body = (call: CapturedCall): unknown => JSON.parse(String(call.init.body));

  it("pushKey reads the VAPID public key", async () => {
    const { fetch, calls } = captureFetch(jsonResponse(envelope({ publicKey: "BKey" })));
    expect(await client(fetch).notifications.pushKey()).toEqual({ publicKey: "BKey" });
    expect(calls[0]!.url).toBe("https://api.test/v1/notifications/push-key");
    expect(calls[0]!.init.method).toBe("GET");
  });

  it("subscribePush sends a subscription's endpoint and keys, as toJSON() gives them", async () => {
    const { fetch, calls } = captureFetch(jsonResponse(envelope({ subscription: { endpoint: "https://push.test/1" } })));
    await client(fetch).notifications.subscribePush({
      endpoint: "https://push.test/1",
      expirationTime: null,
      keys: { p256dh: "BKey", auth: "secret" },
    });
    expect(calls[0]!.url).toBe("https://api.test/v1/notifications/push-subscriptions");
    expect(calls[0]!.init.method).toBe("POST");
    expect(body(calls[0]!)).toEqual({ endpoint: "https://push.test/1", keys: { p256dh: "BKey", auth: "secret" } });
  });

  it("unsubscribePush sends DELETE with the endpoint", async () => {
    const { fetch, calls } = captureFetch(jsonResponse(envelope({ removed: true })));
    expect(await client(fetch).notifications.unsubscribePush("https://push.test/1")).toEqual({ removed: true });
    expect(calls[0]!.url).toBe("https://api.test/v1/notifications/push-subscriptions");
    expect(calls[0]!.init.method).toBe("DELETE");
    expect(body(calls[0]!)).toEqual({ endpoint: "https://push.test/1" });
  });

  it("sendTestPush posts to push-test, for one device or all", async () => {
    const { fetch, calls } = captureFetch(jsonResponse(envelope({ devices: 1, sent: 1, gone: 0, failed: 0 })));
    await client(fetch).notifications.sendTestPush();
    await client(fetch).notifications.sendTestPush("https://push.test/1");
    expect(calls.map((c) => [c.url, c.init.method])).toEqual([
      ["https://api.test/v1/notifications/push-test", "POST"],
      ["https://api.test/v1/notifications/push-test", "POST"],
    ]);
    expect(body(calls[0]!)).toEqual({});
    expect(body(calls[1]!)).toEqual({ endpoint: "https://push.test/1" });
  });

  it("push preferences: read with channel=push and no orgId; setPushKinds merges kinds", async () => {
    const { fetch, calls } = captureFetch(jsonResponse(envelope({ preferences: [] })));
    await client(fetch).notifications.getPreferences({ channel: "push" });
    expect(calls[0]!.url).toBe("https://api.test/v1/notifications/preferences?channel=push");
    await client(fetch).notifications.setPushKinds({ "kitchen.portion_set": true, "kitchen.paid_you": null });
    expect(calls[1]!.url).toBe("https://api.test/v1/notifications/preferences");
    expect(calls[1]!.init.method).toBe("PUT");
    expect(body(calls[1]!)).toEqual({ channel: "push", kinds: { "kitchen.portion_set": true, "kitchen.paid_you": null } });
  });
});

// ---------------------------------------------------------------------------
// Kitchen (Cookpool CP-4)
// ---------------------------------------------------------------------------

describe("KitchenClient", () => {
  const settings = { currency: "INR", wastePolicy: "split_equally", updatedAt: null };

  it("getSettings reads the group's settings path", async () => {
    const { fetch, calls } = captureFetch(jsonResponse(envelope(settings)));
    expect(await client(fetch).kitchen.getSettings("org_1")).toEqual(settings);
    expect(calls[0]!.url).toBe("https://api.test/v1/organizations/org_1/kitchen/settings");
    expect(calls[0]!.init.method).toBe("GET");
  });

  it("updateSettings PATCHes the body with the caller's idempotency key", async () => {
    const saved = { currency: "INR", wastePolicy: "buyer_absorbs", updatedAt: "2026-11-02T08:00:00.000Z" };
    const { fetch, calls } = captureFetch(jsonResponse(envelope(saved)));
    expect(
      await client(fetch).kitchen.updateSettings(
        "org_1",
        { wastePolicy: "buyer_absorbs" },
        { idempotencyKey: "ikey_settings_1" },
      ),
    ).toEqual(saved);
    expect(calls[0]!.url).toBe("https://api.test/v1/organizations/org_1/kitchen/settings");
    expect(calls[0]!.init.method).toBe("PATCH");
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({ wastePolicy: "buyer_absorbs" });
    expect(new Headers(calls[0]!.init.headers as HeadersInit).get("idempotency-key")).toBe("ikey_settings_1");
  });

  it("surfaces a locked currency as ConflictError carrying the reason", async () => {
    const { fetch } = captureFetch(
      jsonResponse(
        {
          error: {
            code: "conflict",
            message: "The group's currency is INR and cannot be changed",
            details: { reason: "currency_locked", currency: "INR" },
            requestId: "req_err",
          },
        },
        { status: 409 },
      ),
    );
    const failure = await client(fetch).kitchen.updateSettings("org_1", { currency: "USD" }).catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(ConflictError);
    expect((failure as ConflictError).details).toEqual({ reason: "currency_locked", currency: "INR" });
  });

  it("surfaces a member's PATCH as NotFoundError (the opaque deny)", async () => {
    const { fetch } = captureFetch(errorResponse("not_found", 404));
    await expect(
      client(fetch).kitchen.updateSettings("org_1", { wastePolicy: "buyer_absorbs" }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("KitchenClient — the ledger (Cookpool CP-7)", () => {
  const txn = {
    id: "txn_1",
    orgId: "org_1",
    kind: "expense",
    title: "Dinner",
    totalMinor: 1000,
    currency: "INR",
    occurredAt: "2026-11-02T08:00:00.000Z",
    createdBy: "usr_rahul",
    createdAt: "2026-11-02T08:00:00.000Z",
    sourceKind: null,
    sourceId: null,
    reverses: null,
    reversed: false,
    reversedBy: null,
    method: null,
    note: null,
    splits: [
      { subjectId: "usr_rahul", paidMinor: 1000, owedMinor: 500 },
      { subjectId: "usr_anu", paidMinor: 0, owedMinor: 500 },
    ],
  };

  function sent(call: CapturedCall): { method: string | undefined; body: unknown; key: string | null } {
    return {
      method: call.init.method,
      body: call.init.body === undefined ? undefined : JSON.parse(String(call.init.body)),
      key: new Headers(call.init.headers as HeadersInit).get("idempotency-key"),
    };
  }

  it("createExpense POSTs the expense with the caller's idempotency key", async () => {
    const { fetch, calls } = captureFetch(jsonResponse(envelope({ txn }), { status: 201 }));
    const body = {
      title: "Dinner",
      totalMinor: 1000,
      payers: [{ subjectId: "usr_rahul", amountMinor: 1000 }],
      mode: "equal" as const,
      participants: [{ subjectId: "usr_rahul" }, { subjectId: "usr_anu" }],
    };
    expect(await client(fetch).kitchen.createExpense("org_1", body, { idempotencyKey: "exp-1" })).toEqual({ txn });
    expect(calls[0]!.url).toBe("https://api.test/v1/organizations/org_1/kitchen/expenses");
    expect(sent(calls[0]!)).toEqual({ method: "POST", body, key: "exp-1" });
  });

  it("createSettlement POSTs the payment", async () => {
    const { fetch, calls } = captureFetch(jsonResponse(envelope({ txn }), { status: 201 }));
    const body = { fromSubjectId: "usr_anu", toSubjectId: "usr_rahul", amountMinor: 500, method: "upi" as const };
    await client(fetch).kitchen.createSettlement("org_1", body, { idempotencyKey: "pay-1" });
    expect(calls[0]!.url).toBe("https://api.test/v1/organizations/org_1/kitchen/settlements");
    expect(sent(calls[0]!)).toEqual({ method: "POST", body, key: "pay-1" });
  });

  it("reverseTxn and flagTxn POST under the transaction", async () => {
    const reversed = captureFetch(jsonResponse(envelope({ txn }), { status: 201 }));
    await client(reversed.fetch).kitchen.reverseTxn("org_1", "txn_1");
    expect(reversed.calls[0]!.url).toBe("https://api.test/v1/organizations/org_1/kitchen/txns/txn_1/reverse");
    expect(sent(reversed.calls[0]!)).toEqual({ method: "POST", body: {}, key: null });

    const flag = { id: "flg_1", txnId: "txn_1", orgId: "org_1", subjectId: "usr_anu", reason: "Not me", state: "open" };
    const flagged = captureFetch(jsonResponse(envelope({ flag }), { status: 201 }));
    expect(await client(flagged.fetch).kitchen.flagTxn("org_1", "txn_1", { reason: "Not me" })).toEqual({ flag });
    expect(flagged.calls[0]!.url).toBe("https://api.test/v1/organizations/org_1/kitchen/txns/txn_1/flags");
  });

  it("activity passes the cursor and limit, and balances and settlePlan read their paths", async () => {
    const page = { items: [txn], nextCursor: "abc" };
    const activity = captureFetch(jsonResponse(envelope(page)));
    expect(await client(activity.fetch).kitchen.activity("org_1", { cursor: "xyz", limit: 10 })).toEqual(page);
    expect(activity.calls[0]!.url).toBe("https://api.test/v1/organizations/org_1/kitchen/activity?cursor=xyz&limit=10");

    const first = captureFetch(jsonResponse(envelope(page)));
    await client(first.fetch).kitchen.activity("org_1");
    expect(first.calls[0]!.url).toBe("https://api.test/v1/organizations/org_1/kitchen/activity");

    const balances = { currency: "INR", balances: [{ subjectId: "usr_rahul", balanceMinor: 500 }] };
    const b = captureFetch(jsonResponse(envelope(balances)));
    expect(await client(b.fetch).kitchen.balances("org_1")).toEqual(balances);
    expect(b.calls[0]!.url).toBe("https://api.test/v1/organizations/org_1/kitchen/balances");

    const plan = {
      currency: "INR",
      payments: [{ fromSubjectId: "usr_anu", toSubjectId: "usr_rahul", amountMinor: 500 }],
      working: { debts: 1, pairs: 1, payments: 1 },
    };
    const p = captureFetch(jsonResponse(envelope(plan)));
    expect(await client(p.fetch).kitchen.settlePlan("org_1")).toEqual(plan);
    expect(p.calls[0]!.url).toBe("https://api.test/v1/organizations/org_1/kitchen/settle-plan");
  });

  it("surfaces already_reversed as ConflictError and not_a_party as ForbiddenError", async () => {
    const reason = (code: string, status: number, detail: string) =>
      jsonResponse({ error: { code, message: code, details: { reason: detail }, requestId: "req_err" } }, { status });
    const again = await client(captureFetch(reason("conflict", 409, "already_reversed")).fetch)
      .kitchen.reverseTxn("org_1", "txn_1")
      .catch((e: unknown) => e);
    expect(again).toBeInstanceOf(ConflictError);
    expect((again as ConflictError).details).toEqual({ reason: "already_reversed" });
    await expect(
      client(captureFetch(reason("forbidden", 403, "not_a_party")).fetch).kitchen.createSettlement("org_1", {
        fromSubjectId: "usr_anu",
        toSubjectId: "usr_rahul",
        amountMinor: 1,
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      client(captureFetch(reason("validation_failed", 422, "not_in_group")).fetch).kitchen.createExpense("org_1", {
        title: "x",
        totalMinor: 1,
        payers: [],
        mode: "equal",
        participants: [],
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});

describe("KitchenClient — pantries (Cookpool CP-10)", () => {
  const item = { id: "itm_1", name: "Rice", pantry: { kind: "personal", name: "My pantry" } };

  function sent(call: CapturedCall): { method: string | undefined; body: unknown; key: string | null } {
    return {
      method: call.init.method,
      body: call.init.body === undefined ? undefined : JSON.parse(String(call.init.body)),
      key: new Headers(call.init.headers as HeadersInit).get("idempotency-key"),
    };
  }

  it("pantries, items and searchItems read the caller's paths with their queries", async () => {
    const pantries = { pantries: [{ kind: "personal", name: "My pantry", itemCount: 0 }] };
    const p = captureFetch(jsonResponse(envelope(pantries)));
    expect(await client(p.fetch).kitchen.pantries()).toEqual(pantries);
    expect(p.calls[0]!.url).toBe("https://api.test/v1/kitchen/me/pantries");

    const page = { items: [item], nextCursor: null };
    const all = captureFetch(jsonResponse(envelope(page)));
    expect(await client(all.fetch).kitchen.items()).toEqual(page);
    expect(all.calls[0]!.url).toBe("https://api.test/v1/kitchen/me/items");
    const some = captureFetch(jsonResponse(envelope(page)));
    await client(some.fetch).kitchen.items({ pantry: "org_1", q: "rice", filter: "soon", cursor: "abc", limit: 10 });
    expect(some.calls[0]!.url).toBe("https://api.test/v1/kitchen/me/items?pantry=org_1&q=rice&filter=soon&cursor=abc&limit=10");

    const found = captureFetch(jsonResponse(envelope({ items: [item] })));
    expect(await client(found.fetch).kitchen.searchItems("ri ce", { limit: 5 })).toEqual({ items: [item] });
    expect(found.calls[0]!.url).toBe("https://api.test/v1/kitchen/me/search?q=ri+ce&limit=5");
  });

  it("creates, reads, edits and removes a personal item", async () => {
    const body = { name: "Rice", category: "Grains", quantity: "1.25", unit: "kg", priceMinor: 12500 };
    const created = captureFetch(jsonResponse(envelope({ item }), { status: 201 }));
    expect(await client(created.fetch).kitchen.createPersonalItem(body, { idempotencyKey: "add-1" })).toEqual({ item });
    expect(created.calls[0]!.url).toBe("https://api.test/v1/kitchen/me/items");
    expect(sent(created.calls[0]!)).toEqual({ method: "POST", body, key: "add-1" });

    const read = captureFetch(jsonResponse(envelope({ item })));
    await client(read.fetch).kitchen.getPersonalItem("itm_1");
    expect(read.calls[0]!.url).toBe("https://api.test/v1/kitchen/me/items/itm_1");
    expect(read.calls[0]!.init.method).toBe("GET");

    const edited = captureFetch(jsonResponse(envelope({ item })));
    await client(edited.fetch).kitchen.updatePersonalItem("itm_1", { name: "Basmati", version: 1 });
    expect(edited.calls[0]!.url).toBe("https://api.test/v1/kitchen/me/items/itm_1");
    expect(sent(edited.calls[0]!)).toEqual({ method: "PATCH", body: { name: "Basmati", version: 1 }, key: null });

    const removed = captureFetch(jsonResponse(envelope({ item })));
    await client(removed.fetch).kitchen.removePersonalItem("itm_1");
    expect(removed.calls[0]!.url).toBe("https://api.test/v1/kitchen/me/items/itm_1");
    expect(removed.calls[0]!.init.method).toBe("DELETE");
  });

  it("lists, creates, reads, edits and removes a group item", async () => {
    const page = { items: [item], nextCursor: "next" };
    const listed = captureFetch(jsonResponse(envelope(page)));
    expect(await client(listed.fetch).kitchen.groupItems("org_1", { filter: "expired" })).toEqual(page);
    expect(listed.calls[0]!.url).toBe("https://api.test/v1/organizations/org_1/kitchen/items?filter=expired");

    const body = { name: "Milk", category: "Dairy", quantity: 1, unit: "L", priceMinor: 6000, paidBy: "usr_anu" };
    const created = captureFetch(jsonResponse(envelope({ item }), { status: 201 }));
    await client(created.fetch).kitchen.createGroupItem("org_1", body, { idempotencyKey: "add-2" });
    expect(created.calls[0]!.url).toBe("https://api.test/v1/organizations/org_1/kitchen/items");
    expect(sent(created.calls[0]!)).toEqual({ method: "POST", body, key: "add-2" });

    const read = captureFetch(jsonResponse(envelope({ item })));
    await client(read.fetch).kitchen.getGroupItem("org_1", "itm_1");
    expect(read.calls[0]!.url).toBe("https://api.test/v1/organizations/org_1/kitchen/items/itm_1");

    const edited = captureFetch(jsonResponse(envelope({ item })));
    await client(edited.fetch).kitchen.updateGroupItem("org_1", "itm_1", { wastePolicy: "buyer_absorbs" });
    expect(sent(edited.calls[0]!)).toEqual({ method: "PATCH", body: { wastePolicy: "buyer_absorbs" }, key: null });

    const removed = captureFetch(jsonResponse(envelope({ item })));
    await client(removed.fetch).kitchen.removeGroupItem("org_1", "itm_1");
    expect(removed.calls[0]!.url).toBe("https://api.test/v1/organizations/org_1/kitchen/items/itm_1");
    expect(removed.calls[0]!.init.method).toBe("DELETE");
  });

  it("surfaces item_used as ConflictError and not_buyer as ForbiddenError", async () => {
    const reason = (code: string, status: number, detail: string) =>
      jsonResponse({ error: { code, message: code, details: { reason: detail }, requestId: "req_err" } }, { status });
    const used = await client(captureFetch(reason("conflict", 409, "item_used")).fetch)
      .kitchen.removePersonalItem("itm_1")
      .catch((e: unknown) => e);
    expect(used).toBeInstanceOf(ConflictError);
    expect((used as ConflictError).details).toEqual({ reason: "item_used" });
    await expect(
      client(captureFetch(reason("forbidden", 403, "not_buyer")).fetch).kitchen.updateGroupItem("org_1", "itm_1", { name: "x" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("KitchenClient — using things (Cookpool CP-11)", () => {
  const moved = {
    item: { id: "itm_1", name: "Milk" },
    move: { id: "mov_1", kind: "use", qtyMilli: 250_000 },
    txn: null,
  };

  function sent(call: CapturedCall): { method: string | undefined; body: unknown; key: string | null } {
    return {
      method: call.init.method,
      body: call.init.body === undefined ? undefined : JSON.parse(String(call.init.body)),
      key: new Headers(call.init.headers as HeadersInit).get("idempotency-key"),
    };
  }

  it("uses and wastes a group item, reads its history and undoes a move", async () => {
    const body = { quantity: "250", unit: "ml", consumers: ["usr_rahul", "usr_anu"] };
    const used = captureFetch(jsonResponse(envelope(moved), { status: 201 }));
    expect(await client(used.fetch).kitchen.useGroupItem("org_1", "itm_1", body, { idempotencyKey: "use-1" })).toEqual(moved);
    expect(used.calls[0]!.url).toBe("https://api.test/v1/organizations/org_1/kitchen/items/itm_1/uses");
    expect(sent(used.calls[0]!)).toEqual({ method: "POST", body, key: "use-1" });

    const wasted = captureFetch(jsonResponse(envelope(moved), { status: 201 }));
    await client(wasted.fetch).kitchen.wasteGroupItem("org_1", "itm_1");
    expect(wasted.calls[0]!.url).toBe("https://api.test/v1/organizations/org_1/kitchen/items/itm_1/waste");
    expect(sent(wasted.calls[0]!)).toEqual({ method: "POST", body: {}, key: null });

    const moves = { moves: [moved.move] };
    const history = captureFetch(jsonResponse(envelope(moves)));
    expect(await client(history.fetch).kitchen.groupItemMoves("org_1", "itm_1", { limit: 20 })).toEqual(moves);
    expect(history.calls[0]!.url).toBe("https://api.test/v1/organizations/org_1/kitchen/items/itm_1/moves?limit=20");

    const undone = captureFetch(jsonResponse(envelope(moved), { status: 201 }));
    await client(undone.fetch).kitchen.undoGroupMove("org_1", "mov_1", { idempotencyKey: "undo-1" });
    expect(undone.calls[0]!.url).toBe("https://api.test/v1/organizations/org_1/kitchen/moves/mov_1/undo");
    expect(sent(undone.calls[0]!)).toEqual({ method: "POST", body: {}, key: "undo-1" });
  });

  it("uses, wastes, moves and undoes a personal item, and reads its history and the usuals", async () => {
    const used = captureFetch(jsonResponse(envelope(moved), { status: 201 }));
    await client(used.fetch).kitchen.usePersonalItem("itm_1", { quantity: 0.5 });
    expect(used.calls[0]!.url).toBe("https://api.test/v1/kitchen/me/items/itm_1/uses");
    expect(sent(used.calls[0]!)).toEqual({ method: "POST", body: { quantity: 0.5 }, key: null });

    const wasted = captureFetch(jsonResponse(envelope(moved), { status: 201 }));
    await client(wasted.fetch).kitchen.wastePersonalItem("itm_1", { quantity: "100", unit: "g" });
    expect(wasted.calls[0]!.url).toBe("https://api.test/v1/kitchen/me/items/itm_1/waste");

    const transferred = captureFetch(jsonResponse(envelope(moved), { status: 201 }));
    await client(transferred.fetch).kitchen.transferPersonalItem("itm_1", { orgId: "org_1" }, { idempotencyKey: "move-1" });
    expect(transferred.calls[0]!.url).toBe("https://api.test/v1/kitchen/me/items/itm_1/transfer");
    expect(sent(transferred.calls[0]!)).toEqual({ method: "POST", body: { orgId: "org_1" }, key: "move-1" });

    const history = captureFetch(jsonResponse(envelope({ moves: [] })));
    await client(history.fetch).kitchen.personalItemMoves("itm_1");
    expect(history.calls[0]!.url).toBe("https://api.test/v1/kitchen/me/items/itm_1/moves");

    const undone = captureFetch(jsonResponse(envelope(moved), { status: 201 }));
    await client(undone.fetch).kitchen.undoPersonalMove("mov_1");
    expect(undone.calls[0]!.url).toBe("https://api.test/v1/kitchen/me/moves/mov_1/undo");
    expect(undone.calls[0]!.init.method).toBe("POST");

    const usuals = { usuals: [{ itemId: "itm_1", name: "Milk", usedCount: 3 }] };
    const read = captureFetch(jsonResponse(envelope(usuals)));
    expect(await client(read.fetch).kitchen.usuals({ limit: 5 })).toEqual(usuals);
    expect(read.calls[0]!.url).toBe("https://api.test/v1/kitchen/me/usuals?limit=5");
  });

  it("asks items and searchItems for usable items only with usable=1", async () => {
    const page = { items: [{ ...moved.item, canUse: true }], nextCursor: null };
    const all = captureFetch(jsonResponse(envelope(page)));
    expect(await client(all.fetch).kitchen.items({ usable: true })).toEqual(page);
    expect(all.calls[0]!.url).toBe("https://api.test/v1/kitchen/me/items?usable=1");
    const unrestricted = captureFetch(jsonResponse(envelope(page)));
    await client(unrestricted.fetch).kitchen.items({ usable: false });
    expect(unrestricted.calls[0]!.url).toBe("https://api.test/v1/kitchen/me/items");
    const found = captureFetch(jsonResponse(envelope({ items: page.items })));
    await client(found.fetch).kitchen.searchItems("milk", { usable: true });
    expect(found.calls[0]!.url).toBe("https://api.test/v1/kitchen/me/search?q=milk&usable=1");
  });

  it("surfaces insufficient_stock and not_latest as ConflictError, not_in_group as ValidationError", async () => {
    const reason = (code: string, status: number, details: Record<string, unknown>) =>
      jsonResponse({ error: { code, message: code, details, requestId: "req_err" } }, { status });
    const over = await client(captureFetch(reason("conflict", 409, { reason: "insufficient_stock", qtyLeftMilli: 0 })).fetch)
      .kitchen.useGroupItem("org_1", "itm_1", { quantity: "1" })
      .catch((e: unknown) => e);
    expect(over).toBeInstanceOf(ConflictError);
    expect((over as ConflictError).details).toEqual({ reason: "insufficient_stock", qtyLeftMilli: 0 });
    await expect(
      client(captureFetch(reason("conflict", 409, { reason: "not_latest" })).fetch).kitchen.undoPersonalMove("mov_1"),
    ).rejects.toBeInstanceOf(ConflictError);
    await expect(
      client(captureFetch(reason("validation_failed", 422, { reason: "not_in_group" })).fetch).kitchen.useGroupItem(
        "org_1",
        "itm_1",
        { quantity: "1", consumers: ["usr_x"] },
      ),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});

describe("KitchenClient — Home's inbox (Cookpool CP-19)", () => {
  it("inbox reads the caller's inbox path", async () => {
    const inbox = {
      items: [],
      counts: { total: 0, claim_dish: 0, finalize_dish: 0, use_soon: 0, payment_due: 0, flag: 0 },
    };
    const { fetch, calls } = captureFetch(jsonResponse(envelope(inbox)));
    expect(await client(fetch).kitchen.inbox()).toEqual(inbox);
    expect(calls[0]!.url).toBe("https://api.test/v1/kitchen/me/inbox");
    expect(calls[0]!.init.method).toBe("GET");
  });
});

describe("KitchenClient — from before (Cookpool SM-8)", () => {
  it("itemHistory and recipes read the caller's paths with the text typed and the limit", async () => {
    const history = { items: [{ name: "Milk", times: 6 }] };
    const h = captureFetch(jsonResponse(envelope(history)));
    expect(await client(h.fetch).kitchen.itemHistory("mi", { limit: 5 })).toEqual(history);
    expect(h.calls[0]!.url).toBe("https://api.test/v1/kitchen/me/items/history?q=mi&limit=5");
    expect(h.calls[0]!.init.method).toBe("GET");

    const recipes = { recipes: [{ name: "Egg fried rice", times: 3, ingredients: [] }] };
    const r = captureFetch(jsonResponse(envelope(recipes)));
    expect(await client(r.fetch).kitchen.recipes("egg fried")).toEqual(recipes);
    expect(r.calls[0]!.url).toBe("https://api.test/v1/kitchen/me/dishes/recipes?q=egg+fried");

    // Nothing typed yet: the most recent, with no empty q on the URL.
    const recent = captureFetch(jsonResponse(envelope({ items: [] })));
    await client(recent.fetch).kitchen.itemHistory();
    expect(recent.calls[0]!.url).toBe("https://api.test/v1/kitchen/me/items/history");
    const cooked = captureFetch(jsonResponse(envelope({ recipes: [] })));
    await client(cooked.fetch).kitchen.recipes("", { limit: 20 });
    expect(cooked.calls[0]!.url).toBe("https://api.test/v1/kitchen/me/dishes/recipes?limit=20");
  });
});

describe("KitchenClient — dishes (Cookpool CP-14)", () => {
  const dish = { id: "dsh_1", name: "Paneer butter masala", state: "open", totalMinor: 21100 };

  function sent(call: CapturedCall): { method: string | undefined; body: unknown; key: string | null } {
    return {
      method: call.init.method,
      body: call.init.body === undefined ? undefined : JSON.parse(String(call.init.body)),
      key: new Headers(call.init.headers as HeadersInit).get("idempotency-key"),
    };
  }

  it("cooks with an idempotency key, reads one dish and cancels it", async () => {
    const body = {
      name: "Paneer butter masala",
      orgId: "org_1",
      portionsHalf: 8,
      extrasMinor: 1500,
      splitMode: "claims" as const,
      ingredients: [{ itemId: "itm_1", quantity: "300", unit: "g" }],
      newItems: [{ name: "Cream", quantity: "200", unit: "ml", priceMinor: 3000 }],
    };
    const cooked = captureFetch(jsonResponse(envelope({ dish }), { status: 201 }));
    expect(await client(cooked.fetch).kitchen.cookDish(body, { idempotencyKey: "cook-1" })).toEqual({ dish });
    expect(cooked.calls[0]!.url).toBe("https://api.test/v1/kitchen/me/dishes");
    expect(sent(cooked.calls[0]!)).toEqual({ method: "POST", body, key: "cook-1" });

    const read = captureFetch(jsonResponse(envelope({ dish })));
    expect(await client(read.fetch).kitchen.getDish("dsh_1")).toEqual({ dish });
    expect(read.calls[0]!.url).toBe("https://api.test/v1/kitchen/me/dishes/dsh_1");
    expect(read.calls[0]!.init.method).toBe("GET");

    const canceled = captureFetch(jsonResponse(envelope({ dish: { ...dish, state: "canceled" } })));
    await client(canceled.fetch).kitchen.cancelDish("dsh_1", { idempotencyKey: "cancel-1" });
    expect(canceled.calls[0]!.url).toBe("https://api.test/v1/kitchen/me/dishes/dsh_1/cancel");
    expect(sent(canceled.calls[0]!)).toEqual({ method: "POST", body: {}, key: "cancel-1" });
  });

  it("lists the caller's dishes and a group's, with state, cursor and limit", async () => {
    const page = { dishes: [dish], nextCursor: null };
    const mine = captureFetch(jsonResponse(envelope(page)));
    expect(await client(mine.fetch).kitchen.myDishes()).toEqual(page);
    expect(mine.calls[0]!.url).toBe("https://api.test/v1/kitchen/me/dishes");
    const some = captureFetch(jsonResponse(envelope(page)));
    await client(some.fetch).kitchen.myDishes({ state: "open", cursor: "abc", limit: 10 });
    expect(some.calls[0]!.url).toBe("https://api.test/v1/kitchen/me/dishes?state=open&cursor=abc&limit=10");
    const shared = captureFetch(jsonResponse(envelope(page)));
    expect(await client(shared.fetch).kitchen.groupDishes("org_1", { state: "draft" })).toEqual(page);
    expect(shared.calls[0]!.url).toBe("https://api.test/v1/organizations/org_1/kitchen/dishes?state=draft");
  });

  it("surfaces a refused dish as NotFoundError, ConflictError and ValidationError", async () => {
    const reason = (code: string, status: number, details: Record<string, unknown>) =>
      jsonResponse({ error: { code, message: code, details, requestId: "req_err" } }, { status });
    const body = { name: "Dal", portionsHalf: 2, splitMode: "assign" as const, ingredients: [{ itemId: "itm_1", quantity: "1" }] };
    await expect(
      client(captureFetch(reason("not_found", 404, {})).fetch).kitchen.cookDish(body),
    ).rejects.toBeInstanceOf(NotFoundError);
    const short = await client(captureFetch(reason("conflict", 409, { reason: "insufficient_stock", itemId: "itm_1", qtyLeftMilli: 0 })).fetch)
      .kitchen.cookDish(body)
      .catch((e: unknown) => e);
    expect(short).toBeInstanceOf(ConflictError);
    expect((short as ConflictError).details).toEqual({ reason: "insufficient_stock", itemId: "itm_1", qtyLeftMilli: 0 });
    await expect(
      client(captureFetch(reason("validation_failed", 422, { reason: "currency_mismatch", currency: "INR" })).fetch).kitchen.cookDish(body),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      client(captureFetch(reason("conflict", 409, { reason: "dish_not_open", state: "finalized" })).fetch).kitchen.cancelDish("dsh_1"),
    ).rejects.toBeInstanceOf(ConflictError);
  });
});

describe("KitchenClient — anyone's portion (Cookpool SM-6)", () => {
  const dish = {
    id: "dsh_1",
    state: "open",
    shares: [{ id: "dsr_1", subjectId: "usr_dev", portionsHalf: 2, exactMinor: null, source: "self", setBy: "usr_anu" }],
  };

  it("PUTs anyone's half portions to claims/{subjectId}, and the caller's to claims/me", async () => {
    const set = captureFetch(jsonResponse(envelope({ dish })));
    expect(await client(set.fetch).kitchen.setPortion("org_1", "dsh_1", "usr_dev", { portionsHalf: 2 })).toEqual({ dish });
    expect(set.calls[0]!.url).toBe("https://api.test/v1/organizations/org_1/kitchen/dishes/dsh_1/claims/usr_dev");
    expect(set.calls[0]!.init.method).toBe("PUT");
    expect(JSON.parse(String(set.calls[0]!.init.body))).toEqual({ portionsHalf: 2 });

    const mine = captureFetch(jsonResponse(envelope({ dish })));
    await client(mine.fetch).kitchen.setPortion("org_1", "dsh_1", "me", { portionsHalf: 0 });
    expect(mine.calls[0]!.url).toBe("https://api.test/v1/organizations/org_1/kitchen/dishes/dsh_1/claims/me");
  });

  it("surfaces the portions limit as ConflictError and someone outside the group as ValidationError", async () => {
    const reason = (code: string, status: number, details: Record<string, unknown>) =>
      jsonResponse({ error: { code, message: code, details, requestId: "req_err" } }, { status });
    const over = await client(captureFetch(reason("conflict", 409, { reason: "claims_exceed_portions", portionsHalf: 8, availableHalf: 2 })).fetch)
      .kitchen.setPortion("org_1", "dsh_1", "usr_dev", { portionsHalf: 6 })
      .catch((e: unknown) => e);
    expect(over).toBeInstanceOf(ConflictError);
    expect((over as ConflictError).details).toEqual({ reason: "claims_exceed_portions", portionsHalf: 8, availableHalf: 2 });
    await expect(
      client(captureFetch(reason("validation_failed", 422, { reason: "not_in_group", subjectIds: ["usr_x"] })).fetch)
        .kitchen.setPortion("org_1", "dsh_1", "usr_x", { portionsHalf: 2 }),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});

describe("KitchenClient — your measures (Cookpool SM-13)", () => {
  const measures = [{ id: "msr_1", one: "onion", many: "onions", count: 1, amountMilli: 150_000 }];
  const onion = { one: "onion", many: "onions", count: 1, amountMilli: 150_000 };

  it("PUTs a group item's measures under the group, and the caller's own under /me — scope is an item's pantry", async () => {
    const group = captureFetch(jsonResponse(envelope({ measures })));
    const pantry = { kind: "group", orgId: "org_1", slug: "flat-4b", name: "Flat 4B" } as const;
    expect(await client(group.fetch).kitchen.setMeasures(pantry, "itm_1", [onion])).toEqual({ measures });
    expect(group.calls[0]!.url).toBe("https://api.test/v1/organizations/org_1/kitchen/items/itm_1/measures");
    expect(group.calls[0]!.init.method).toBe("PUT");
    expect(JSON.parse(String(group.calls[0]!.init.body))).toEqual({ measures: [onion] });

    const mine = captureFetch(jsonResponse(envelope({ measures: [] })));
    expect(await client(mine.fetch).kitchen.setMeasures({ kind: "personal" }, "itm_2", [])).toEqual({ measures: [] });
    expect(mine.calls[0]!.url).toBe("https://api.test/v1/kitchen/me/items/itm_2/measures");
    expect(JSON.parse(String(mine.calls[0]!.init.body))).toEqual({ measures: [] });
  });

  it("sends a use in a measure as it is, and surfaces bad measures as ValidationError and a viewer as NotFoundError", async () => {
    const used = captureFetch(jsonResponse(envelope({ item: {}, move: { label: "2 onions" }, txn: null }), { status: 201 }));
    await client(used.fetch).kitchen.useGroupItem("org_1", "itm_1", { quantity: 2, measure: "onion" });
    expect(JSON.parse(String(used.calls[0]!.init.body))).toEqual({ quantity: 2, measure: "onion" });

    await expect(
      client(captureFetch(errorResponse("validation_failed", 422)).fetch).kitchen.setMeasures({ kind: "personal" }, "itm_1", [onion]),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      client(captureFetch(errorResponse("not_found", 404)).fetch).kitchen.setMeasures({ kind: "group", orgId: "org_1" }, "itm_1", [onion]),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("KitchenClient — item notes (Cookpool RC-3)", () => {
  it("sends a note on the add and on an edit, as it is, under /me and under the group", async () => {
    const item = { id: "itm_1", note: "For Sunday's curry" };
    const body = { name: "Paneer", category: "dairy", quantity: "200", unit: "g", priceMinor: 9000, note: "For Sunday's curry" };
    const mine = captureFetch(jsonResponse(envelope({ item }), { status: 201 }));
    expect(await client(mine.fetch).kitchen.createPersonalItem(body, { idempotencyKey: "add-note" })).toEqual({ item });
    expect(mine.calls[0]!.url).toBe("https://api.test/v1/kitchen/me/items");
    expect(JSON.parse(String(mine.calls[0]!.init.body))).toEqual(body);

    const shared = captureFetch(jsonResponse(envelope({ item }), { status: 201 }));
    await client(shared.fetch).kitchen.createGroupItem("org_1", { ...body, paidBy: "usr_anu" });
    expect(JSON.parse(String(shared.calls[0]!.init.body))).toMatchObject({ note: "For Sunday's curry", paidBy: "usr_anu" });

    const cleared = captureFetch(jsonResponse(envelope({ item: { ...item, note: null } })));
    await client(cleared.fetch).kitchen.updatePersonalItem("itm_1", { note: null, version: 2 });
    expect(cleared.calls[0]!.url).toBe("https://api.test/v1/kitchen/me/items/itm_1");
    expect(cleared.calls[0]!.init.method).toBe("PATCH");
    expect(JSON.parse(String(cleared.calls[0]!.init.body))).toEqual({ note: null, version: 2 });

    const edited = captureFetch(jsonResponse(envelope({ item })));
    await client(edited.fetch).kitchen.updateGroupItem("org_1", "itm_1", { note: "Top shelf" });
    expect(edited.calls[0]!.url).toBe("https://api.test/v1/organizations/org_1/kitchen/items/itm_1");
    expect(JSON.parse(String(edited.calls[0]!.init.body))).toEqual({ note: "Top shelf" });
  });

  it("surfaces a note that is too long as ValidationError", async () => {
    await expect(
      client(captureFetch(errorResponse("validation_failed", 422)).fetch).kitchen.updatePersonalItem("itm_1", { note: "x".repeat(81) }),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});

describe("KitchenClient — foods and recipes (Cookpool RC-4)", () => {
  const recipe = { id: "rcp_1", name: "Chicken curry", linkCode: null };

  it("reads the food list and Always have, answers 'Is Kanda onion?' and saves Always have", async () => {
    const foods = captureFetch(jsonResponse(envelope({ foods: [] })));
    await client(foods.fetch).kitchen.foods({ q: "pyaz", limit: 5 });
    expect(foods.calls[0]!.url).toBe("https://api.test/v1/kitchen/foods?q=pyaz&limit=5");
    const all = captureFetch(jsonResponse(envelope({ foods: [] })));
    await client(all.fetch).kitchen.foods();
    expect(all.calls[0]!.url).toBe("https://api.test/v1/kitchen/foods");

    const answer = captureFetch(jsonResponse(envelope({ answer: { nameKey: "kanda", foodKey: "onion", orgId: "org_1" }, linkedItems: 2 })));
    await client(answer.fetch).kitchen.setFoodAnswer({ nameKey: "kanda", foodKey: "onion", orgId: "org_1" });
    expect(answer.calls[0]!.url).toBe("https://api.test/v1/kitchen/me/food-answers");
    expect(answer.calls[0]!.init.method).toBe("PUT");
    expect(JSON.parse(String(answer.calls[0]!.init.body))).toEqual({ nameKey: "kanda", foodKey: "onion", orgId: "org_1" });

    const always = captureFetch(jsonResponse(envelope({ foods: [], isDefault: true })));
    expect(await client(always.fetch).kitchen.alwaysHave()).toEqual({ foods: [], isDefault: true });
    expect(always.calls[0]!.url).toBe("https://api.test/v1/kitchen/me/always-have");
    const saved = captureFetch(jsonResponse(envelope({ foods: [], isDefault: false })));
    await client(saved.fetch).kitchen.setAlwaysHave(["salt", "turmeric"]);
    expect(saved.calls[0]!.init.method).toBe("PUT");
    expect(JSON.parse(String(saved.calls[0]!.init.body))).toEqual({ foodKeys: ["salt", "turmeric"] });
  });

  it("writes, reads, edits and deletes a recipe on the design's paths", async () => {
    const calls: Array<[string, string | undefined]> = [];
    const respond = async (run: (c: Cookpool) => Promise<unknown>, status = 200) => {
      const f = captureFetch(jsonResponse(envelope({ recipe, lastCook: null }), { status }));
      await run(client(f.fetch));
      calls.push([`${f.calls[0]!.init.method} ${f.calls[0]!.url}`, f.calls[0]!.init.body as string | undefined]);
    };
    await respond((c) => c.kitchen.createRecipe({ name: "Chicken curry", servesHalf: 8, lines: [{ name: "Chicken", quantity: "1", unit: "kg" }] }), 201);
    await respond((c) => c.kitchen.createRecipe({ fromDishId: "dsh_1" }), 201);
    await respond((c) => c.kitchen.getRecipe("rcp_1"));
    await respond((c) => c.kitchen.getRecipe("rcp_1", { code: "AbCdEfGhJk" }));
    await respond((c) => c.kitchen.updateRecipe("rcp_1", { visibility: "only_me" }));
    await respond((c) => c.kitchen.deleteRecipe("rcp_1"));
    await respond((c) => c.kitchen.shareRecipeLink("rcp_1"));
    await respond((c) => c.kitchen.stopRecipeLink("rcp_1"));
    await respond((c) => c.kitchen.recipeByLink("AbCdEfGhJk"));
    await respond((c) => c.kitchen.copyRecipe({ linkCode: "AbCdEfGhJk" }), 201);
    expect(calls.map(([call]) => call)).toEqual([
      "POST https://api.test/v1/kitchen/me/recipes",
      "POST https://api.test/v1/kitchen/me/recipes",
      "GET https://api.test/v1/kitchen/recipes/rcp_1",
      "GET https://api.test/v1/kitchen/recipes/rcp_1?code=AbCdEfGhJk",
      "PATCH https://api.test/v1/kitchen/me/recipes/rcp_1",
      "DELETE https://api.test/v1/kitchen/me/recipes/rcp_1",
      "POST https://api.test/v1/kitchen/me/recipes/rcp_1/link",
      "DELETE https://api.test/v1/kitchen/me/recipes/rcp_1/link",
      "GET https://api.test/v1/kitchen/recipe-links/AbCdEfGhJk",
      "POST https://api.test/v1/kitchen/me/recipes/copies",
    ]);
    expect(JSON.parse(calls[1]![1]!)).toEqual({ fromDishId: "dsh_1" });
    expect(JSON.parse(calls[9]![1]!)).toEqual({ linkCode: "AbCdEfGhJk" });
  });

  it("reads lists, the match, a person's recipes, Explore and Cook now — and a refusal is a NotFoundError", async () => {
    const urls: string[] = [];
    const get = async (run: (c: Cookpool) => Promise<unknown>, data: unknown) => {
      const f = captureFetch(jsonResponse(envelope(data)));
      await run(client(f.fetch));
      urls.push(f.calls[0]!.url);
    };
    await get((c) => c.kitchen.myRecipes(), { recipes: [] });
    await get((c) => c.kitchen.recipeMatch("rcp_1", { f: 450 }), { lines: [] });
    await get((c) => c.kitchen.recipeMatch("rcp_1"), { lines: [] });
    await get((c) => c.kitchen.personRecipes("usr_anu"), { recipes: [] });
    await get((c) => c.kitchen.exploreRecipes({ source: "groups", q: "dal", kind: "dal_curry" }), { recipes: [] });
    await get((c) => c.kitchen.exploreRecipes(), { recipes: [] });
    await get((c) => c.kitchen.cookNow(), { recipes: [] });
    expect(urls).toEqual([
      "https://api.test/v1/kitchen/me/recipes",
      "https://api.test/v1/kitchen/me/recipes/rcp_1/match?f=450",
      "https://api.test/v1/kitchen/me/recipes/rcp_1/match",
      "https://api.test/v1/kitchen/people/usr_anu/recipes",
      "https://api.test/v1/kitchen/recipes?source=groups&q=dal&kind=dal_curry",
      "https://api.test/v1/kitchen/recipes",
      "https://api.test/v1/kitchen/me/cook-now",
    ]);
    await expect(client(captureFetch(errorResponse("not_found", 404)).fetch).kitchen.getRecipe("rcp_1")).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      client(captureFetch(errorResponse("validation_failed", 422)).fetch).kitchen.createRecipe({ name: "", servesHalf: 0, lines: [] }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("cooks from a recipe with the dish write's new fields, as they are", async () => {
    const cooked = captureFetch(jsonResponse(envelope({ dish: { id: "dsh_1", recipeId: "rcp_1" } }), { status: 201 }));
    await client(cooked.fetch).kitchen.cookDish({
      name: "Chicken curry",
      portionsHalf: 4,
      splitMode: "claims",
      orgId: "org_1",
      recipeId: "rcp_1",
      recipeFactorMilli: 450,
      ingredients: [{ itemId: "itm_1", quantity: "450", unit: "g", recipeLine: 0 }],
    });
    expect(JSON.parse(String(cooked.calls[0]!.init.body))).toMatchObject({ recipeId: "rcp_1", recipeFactorMilli: 450, ingredients: [{ recipeLine: 0 }] });
  });
});
