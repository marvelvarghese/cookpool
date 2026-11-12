import {
  ACTOR_DELEGATION_CLIENT_HEADER,
  ACTOR_DELEGATION_ID_HEADER,
  ACTOR_SCOPES_HEADER,
  DELEGATION_CLIENT_ID_MAX,
  DELEGATION_CLIENT_NAME_MAX,
  DELEGATION_ERROR_REASONS,
  DELEGATION_INTERNAL_ACTOR_HEADER,
  DELEGATION_INTERNAL_ACTORS,
  DELEGATION_LAST_USED_INTERVAL_SECONDS,
  DELEGATION_SCOPES,
  DELEGATION_TOKEN_PREFIX,
  DELEGATION_TTL_DAYS,
  ERROR_CODES,
  isDelegationScope,
  type ActorContext,
  type CreateDelegationResponse,
} from "@saas/contracts";
import * as direct from "@saas/contracts/delegations";

describe("contracts: delegated tokens (cookpool-mcp MC-2)", () => {
  it("has exactly the five scopes, in order (money.write is cookpool-spliteco SE-6's)", () => {
    expect(DELEGATION_SCOPES).toEqual(["kitchen.read", "money.read", "timers.write", "suggest.write", "money.write"]);
    expect(direct.DELEGATION_SCOPES).toBe(DELEGATION_SCOPES);
  });

  it("knows a scope from anything else", () => {
    for (const s of DELEGATION_SCOPES) expect(isDelegationScope(s)).toBe(true);
    for (const s of ["kitchen.write", "money.settle", "MONEY.WRITE", "KITCHEN.READ", "", "admin", 1, null, undefined]) {
      expect(isDelegationScope(s)).toBe(false);
    }
  });

  it("pins the token shape, the lifetime and the limits", () => {
    expect(DELEGATION_TOKEN_PREFIX).toBe("sps_dlg_");
    expect(DELEGATION_TTL_DAYS).toBe(90);
    expect(DELEGATION_LAST_USED_INTERVAL_SECONDS).toBe(3600);
    expect(DELEGATION_CLIENT_NAME_MAX).toBe(80);
    expect(DELEGATION_CLIENT_ID_MAX).toBe(128);
  });

  it("names the headers: the internal caller, and the delegation forwarded by the edge", () => {
    expect(DELEGATION_INTERNAL_ACTOR_HEADER).toBe("x-internal-actor");
    expect(DELEGATION_INTERNAL_ACTORS).toEqual(["mcp-worker"]);
    expect(ACTOR_DELEGATION_ID_HEADER).toBe("x-actor-delegation-id");
    expect(ACTOR_SCOPES_HEADER).toBe("x-actor-scopes");
    expect(ACTOR_DELEGATION_CLIENT_HEADER).toBe("x-actor-delegation-client");
  });

  it("carries each refusal as a reason on an existing, pinned error code", () => {
    expect(DELEGATION_ERROR_REASONS).toEqual({
      SCOPE: "scope",
      SESSION_REQUIRED: "session_required",
      REVOKED: "revoked",
      EXPIRED: "expired",
    });
    const codes: string[] = Object.values(ERROR_CODES);
    expect(codes).toEqual(expect.arrayContaining(["forbidden", "precondition_failed"]));
    for (const reason of Object.values(DELEGATION_ERROR_REASONS)) expect(codes).not.toContain(reason);
  });

  it("types a delegated actor and a minted delegation", () => {
    const actor: ActorContext = {
      actorType: "user",
      actorId: "usr_1",
      delegation: { id: "dlg_1", scopes: ["kitchen.read"], clientName: "Claude" },
    };
    const minted: CreateDelegationResponse = {
      delegation: {
        id: "dlg_1",
        scopes: ["kitchen.read"],
        grantedScopes: ["kitchen.read", "money.write"],
        clientName: "Claude",
        clientId: "cli_1",
        createdAt: "2026-11-09T12:00:00.000Z",
        expiresAt: "2027-02-07T12:00:00.000Z",
        lastUsedAt: null,
      },
      token: "sps_dlg_x.y",
    };
    expect(actor.delegation?.scopes).toEqual(minted.delegation.scopes);
  });
});
