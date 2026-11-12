import type {
  HandoffCreateRequest,
  HandoffCreateResponse,
  HandoffExchangeRequest,
  HandoffExchangeResponse,
  LoginCompleteRequest,
  LoginCompleteResponse,
  LoginStartRequest,
  LoginStartResponse,
  LogoutResponse,
  OAuthProvidersResponse,
  ProfileResponse,
  SessionResponse,
  UpdateProfileRequest,
} from "@saas/contracts/auth";
import type {
  CreateDelegationRequest,
  CreateDelegationResponse,
  DelegationsListResponse,
  RevokeDelegationResponse,
  UpdateDelegationRequest,
  UpdateDelegationResponse,
} from "@saas/contracts/delegations";
import type {
  PasskeyLoginOptionsResponse,
  PasskeyLoginVerifyRequest,
  PasskeyLoginVerifyResponse,
  PasskeyRegisterOptionsResponse,
  PasskeyRegisterVerifyRequest,
  PasskeyRegisterVerifyResponse,
  PasskeysListResponse,
  RemovePasskeyResponse,
} from "@saas/contracts/passkeys";

import type { RequestOptions, Transport } from "./transport.js";

/**
 * Auth resource client (Task 0103).
 *
 * Wraps the identity-worker public auth surface exposed by the api-edge
 * `auth-facade` route table:
 *   - POST   /v1/auth/login/start
 *   - POST   /v1/auth/login/complete
 *   - GET    /v1/auth/session
 *   - POST   /v1/auth/logout
 *   - GET    /v1/auth/profile
 *   - PATCH  /v1/auth/profile
 *   - /v1/auth/delegations (MC-2) and /v1/auth/passkeys (PK-2), below
 *
 * Stripe parity: `loginStart`, `loginComplete`, and `logout` are POSTs that
 * accept a caller-owned `idempotencyKey` via `RequestOptions`. The SDK MUST
 * NOT auto-generate one — it is forwarded verbatim if present, omitted
 * otherwise.
 *
 * Note: `/v1/auth/resolve` is intentionally NOT exposed — that endpoint is
 * internal to service-binding bearer resolution. `/v1/auth/security-events`
 * is also out of scope here; it lives on `SecurityEventsClient` (Task 0099).
 */
export class AuthClient {
  constructor(private readonly transport: Transport) {}

  /** POST /v1/auth/login/start */
  loginStart(
    input: LoginStartRequest,
    opts: RequestOptions = {},
  ): Promise<LoginStartResponse> {
    return this.transport.request<LoginStartResponse>(
      {
        method: "POST",
        path: "/v1/auth/login/start",
        body: input,
      },
      opts,
    );
  }

  /** POST /v1/auth/login/complete */
  loginComplete(
    input: LoginCompleteRequest,
    opts: RequestOptions = {},
  ): Promise<LoginCompleteResponse> {
    return this.transport.request<LoginCompleteResponse>(
      {
        method: "POST",
        path: "/v1/auth/login/complete",
        body: input,
      },
      opts,
    );
  }

  /** GET /v1/auth/oauth/providers — the configured OAuth sign-in providers. */
  listOAuthProviders(opts: RequestOptions = {}): Promise<OAuthProvidersResponse> {
    return this.transport.request<OAuthProvidersResponse>(
      {
        method: "GET",
        path: "/v1/auth/oauth/providers",
      },
      opts,
    );
  }

  /**
   * Build the absolute URL that begins an OAuth login. This is NOT an XHR
   * endpoint — assign it to `window.location` so the provider redirect and the
   * state-cookie handshake run as top-level browser navigations.
   *
   * Built on the client's `oauthBaseUrl` (by default its `baseUrl`): the
   * start must be on the host the provider's callback returns to, whose
   * state cookie the callback checks.
   *
   * @param providerId provider id from {@link listOAuthProviders} (e.g. "github")
   * @param returnTo   absolute URL the user is returned to after sign-in
   *                   (must be an allow-listed console origin server-side)
   */
  oauthStartUrl(providerId: string, returnTo: string): string {
    const url = new URL(
      `${this.transport.oauthBaseUrl}/v1/auth/oauth/${encodeURIComponent(providerId)}/start`,
    );
    url.searchParams.set("return_to", returnTo);
    return url.toString();
  }

  /** GET /v1/auth/session */
  getSession(opts: RequestOptions = {}): Promise<SessionResponse> {
    return this.transport.request<SessionResponse>(
      {
        method: "GET",
        path: "/v1/auth/session",
      },
      opts,
    );
  }

  /** POST /v1/auth/logout */
  logout(opts: RequestOptions = {}): Promise<LogoutResponse> {
    return this.transport.request<LogoutResponse>(
      {
        method: "POST",
        path: "/v1/auth/logout",
      },
      opts,
    );
  }

  /** GET /v1/auth/profile */
  getProfile(opts: RequestOptions = {}): Promise<ProfileResponse> {
    return this.transport.request<ProfileResponse>(
      {
        method: "GET",
        path: "/v1/auth/profile",
      },
      opts,
    );
  }

  /** PATCH /v1/auth/profile */
  updateProfile(
    input: UpdateProfileRequest,
    opts: RequestOptions = {},
  ): Promise<ProfileResponse> {
    return this.transport.request<ProfileResponse>(
      {
        method: "PATCH",
        path: "/v1/auth/profile",
        body: input,
      },
      opts,
    );
  }

  // ── Delegated tokens for assistants (cookpool-mcp MC-2) ──────────────
  // A signed-in session only: the console's consent page mints one for an
  // MCP client, and Connected assistants lists and disconnects them. A
  // delegated token calling these is refused (`ForbiddenError`, reason
  // "session_required" at identity, "scope" at the edge).

  /** GET /v1/auth/delegations — your live delegations, newest first. */
  delegations(opts: RequestOptions = {}): Promise<DelegationsListResponse> {
    return this.transport.request<DelegationsListResponse>(
      { method: "GET", path: "/v1/auth/delegations" },
      opts,
    );
  }

  /** POST /v1/auth/delegations — mint one; the token in the answer is shown this once. */
  createDelegation(
    input: CreateDelegationRequest,
    opts: RequestOptions = {},
  ): Promise<CreateDelegationResponse> {
    return this.transport.request<CreateDelegationResponse>(
      { method: "POST", path: "/v1/auth/delegations", body: input },
      opts,
    );
  }

  /**
   * PATCH /v1/auth/delegations/:id — change what an assistant may do (Look
   * only / Add & edit, cookpool-spliteco SE-6), within what was allowed when
   * it was connected; in force at the edge within its 30 s actor cache.
   */
  updateDelegation(id: string, input: UpdateDelegationRequest, opts: RequestOptions = {}): Promise<UpdateDelegationResponse> {
    return this.transport.request<UpdateDelegationResponse>(
      { method: "PATCH", path: `/v1/auth/delegations/${encodeURIComponent(id)}`, body: input },
      opts,
    );
  }

  /** DELETE /v1/auth/delegations/:id — disconnect: the token stops working within the edge's 30 s actor cache. */
  revokeDelegation(id: string, opts: RequestOptions = {}): Promise<RevokeDelegationResponse> {
    return this.transport.request<RevokeDelegationResponse>(
      { method: "DELETE", path: `/v1/auth/delegations/${encodeURIComponent(id)}` },
      opts,
    );
  }

  // ── Passkeys (cookpool-passkeys PK-2) ────────────────────────────────
  // Register, list and remove take a signed-in session; login options and
  // verify take nobody. Every passkey route answers 404 (reason
  // "passkeys_off") where the environment has no RP ID, and a delegated token
  // is refused on all of them. A failed passkey sign-in is a bare 401
  // (reason "passkey_failed"): fall back to the email code or Google.

  /** POST /v1/auth/passkeys/register/options — creation options for `navigator.credentials.create`. 409 at 10 passkeys. */
  passkeyRegisterOptions(opts: RequestOptions = {}): Promise<PasskeyRegisterOptionsResponse> {
    return this.transport.request<PasskeyRegisterOptionsResponse>(
      { method: "POST", path: "/v1/auth/passkeys/register/options", body: {} },
      opts,
    );
  }

  /** POST /v1/auth/passkeys/register/verify — stores the new passkey (201). */
  passkeyRegisterVerify(
    input: PasskeyRegisterVerifyRequest,
    opts: RequestOptions = {},
  ): Promise<PasskeyRegisterVerifyResponse> {
    return this.transport.request<PasskeyRegisterVerifyResponse>(
      { method: "POST", path: "/v1/auth/passkeys/register/verify", body: input },
      opts,
    );
  }

  /** GET /v1/auth/passkeys — your passkeys, newest first. */
  passkeys(opts: RequestOptions = {}): Promise<PasskeysListResponse> {
    return this.transport.request<PasskeysListResponse>(
      { method: "GET", path: "/v1/auth/passkeys" },
      opts,
    );
  }

  /** DELETE /v1/auth/passkeys/:id — it stops signing you in at once. */
  removePasskey(id: string, opts: RequestOptions = {}): Promise<RemovePasskeyResponse> {
    return this.transport.request<RemovePasskeyResponse>(
      { method: "DELETE", path: `/v1/auth/passkeys/${encodeURIComponent(id)}` },
      opts,
    );
  }

  /** POST /v1/auth/passkeys/login/options — request options with an empty allowCredentials. */
  passkeyLoginOptions(opts: RequestOptions = {}): Promise<PasskeyLoginOptionsResponse> {
    return this.transport.request<PasskeyLoginOptionsResponse>(
      { method: "POST", path: "/v1/auth/passkeys/login/options", body: {} },
      opts,
    );
  }

  /** POST /v1/auth/passkeys/login/verify — the same session body as `loginComplete`. */
  passkeyLoginVerify(
    input: PasskeyLoginVerifyRequest,
    opts: RequestOptions = {},
  ): Promise<PasskeyLoginVerifyResponse> {
    return this.transport.request<PasskeyLoginVerifyResponse>(
      { method: "POST", path: "/v1/auth/passkeys/login/verify", body: input },
      opts,
    );
  }

  /**
   * POST /v1/auth/handoff — a one-time, 60-second code that signs this person
   * into another of the product's apps (cookpool-spliteco SE-4), bound to
   * that app's origin. A session only.
   */
  createHandoff(input: HandoffCreateRequest, opts: RequestOptions = {}): Promise<HandoffCreateResponse> {
    return this.transport.request<HandoffCreateResponse>({ method: "POST", path: "/v1/auth/handoff", body: input }, opts);
  }

  /** POST /v1/auth/handoff/exchange — the code for a session of this app's own (the same body as `loginComplete`). */
  exchangeHandoff(input: HandoffExchangeRequest, opts: RequestOptions = {}): Promise<HandoffExchangeResponse> {
    return this.transport.request<HandoffExchangeResponse>({ method: "POST", path: "/v1/auth/handoff/exchange", body: input }, opts);
  }
}
