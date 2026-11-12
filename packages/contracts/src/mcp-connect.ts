// Connecting an assistant (Cookpool, epic cookpool-mcp: MC-3, design §2, §3).
//
// apps/mcp-worker is the MCP server assistants add, and its own OAuth 2.1
// authorization server. Its /authorize keeps the client's request for ten
// minutes and sends the browser to the console's /connect?req=<id> page
// (MC-4), which signs the person in, shows who is asking and the four scope
// switches, mints the delegated token (identity's POST /v1/auth/delegations,
// MC-2) and hands it back here:
//
//   GET  {mcp}/connect/request?req=           who is asking and for what → 200 ConnectRequestInfo;
//                                             404 not_found with details.reason "expired" once gone
//   POST {mcp}/connect/complete               Bearer <the person's session>: { req, delegationId, token }
//                                             → 200 { redirectTo }: the console sends the browser there
//   POST {mcp}/connect/deny                   Bearer <session>: { req } → 200 { redirectTo } (access_denied, back to the client)
//   POST {mcp}/connect/disconnect             Bearer <session>: { delegationId } → 200 { revokedGrants }
//                                             ends the assistant's grant here and revokes the delegation
//
// These answer the console's origin only (CORS), with the usual envelopes:
// `{ data, meta }` and `{ error: { code, message, details } }`, codes from
// errors.ts. A delegated token can never complete a connection or disconnect.

/** What a person can let an assistant do. api-edge enforces each one (MC-2's allowlist). */
export const ASSISTANT_SCOPES = ["kitchen.read", "money.read", "timers.write", "suggest.write", "money.write"] as const;
export type AssistantScope = (typeof ASSISTANT_SCOPES)[number];

/** The consent page's switches start on, except money: balances and (SE-6) Spliteco expenses (design §3). */
export const ASSISTANT_DEFAULT_SCOPES: readonly AssistantScope[] = ["kitchen.read", "timers.write", "suggest.write"];

export function isAssistantScope(value: unknown): value is AssistantScope {
  return typeof value === "string" && (ASSISTANT_SCOPES as readonly string[]).includes(value);
}

/** A pending request lives this long; then /connect/request answers 404. */
export const CONNECT_REQUEST_TTL_SECONDS = 600;

/** GET {mcp}/connect/request?req= → `data`. Every string but `req` came from the client: escape it. */
export interface ConnectRequestInfo {
  req: string;
  /** The MCP client's OAuth client id: send it as `clientId` to POST /v1/auth/delegations. */
  clientId: string;
  /** Its name as it registered it (self-asserted), or its client id when it gave none. Send it, cut to 80, as `clientName`. */
  clientName: string;
  /** For a client identified by a metadata document URL: that URL's host, which it controls. Null otherwise. */
  clientDomain: string | null;
  /** Where the access goes: the host of the client's redirect URI. The page must show it. */
  redirectHost: string;
  /** The redirect goes to an app on this computer (localhost): the page should say so. */
  redirectIsLoopback: boolean;
  /** The scopes the client asked for that Cookpool knows (it may ask for none; the page decides). */
  requestedScopes: AssistantScope[];
  /** ISO 8601: when the request lapses. */
  expiresAt: string;
}

/** POST {mcp}/connect/complete, with the person's own session as the bearer. */
export interface ConnectCompleteRequest {
  req: string;
  /** `dlg_…`, from POST /v1/auth/delegations. It must be the caller's, live, and for this client. */
  delegationId: string;
  /** The `sps_dlg_…` token minted with it. Kept only encrypted in the grant, never logged. */
  token: string;
}

/** POST {mcp}/connect/complete and …/deny → `data`. */
export interface ConnectRedirectResponse {
  /** The client's redirect URI with the code (or `error=access_denied`), `state` and `iss`. */
  redirectTo: string;
}

/** POST {mcp}/connect/deny, with the person's own session as the bearer. */
export interface ConnectDenyRequest {
  req: string;
}

/** POST {mcp}/connect/disconnect, with the person's own session as the bearer. */
export interface ConnectDisconnectRequest {
  delegationId: string;
}

/** POST {mcp}/connect/disconnect → `data`. */
export interface ConnectDisconnectResponse {
  /** How many grants here ended (0 when the assistant never finished connecting). */
  revokedGrants: number;
  /** Whether identity revoked the delegation (false when it was already gone). */
  delegationRevoked: boolean;
}
