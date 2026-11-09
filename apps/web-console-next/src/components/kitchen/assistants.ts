/**
 * Your assistant, connected (cookpool-mcp MC-4, design §3; the canvas's
 * `McpConsent` and `McpConnect`).
 *
 * - **`/connect?req=<id>`**: mcp-worker's `/authorize` sends the browser
 *   here. Signed in (the kitchen frame signs a visitor in and brings them
 *   back), the page reads who is asking (`GET {mcp}/connect/request`), shows
 *   the four scope switches — on, but for balances — and Cancel · Allow.
 *   Allow mints a delegated token (identity, MC-2) and hands it to
 *   mcp-worker (`POST {mcp}/connect/complete`), which answers where to send
 *   the browser back to the assistant. Cancel tells mcp-worker to deny.
 * - **You → Connected assistants** (`/you/assistants`): the connector URL for
 *   this environment with Copy, the short steps per assistant, the
 *   delegations with Disconnect, and what an assistant can and can't do.
 *
 * Pure (no React, no SDK): the calls are passed in, so the flows are
 * unit-testable. mcp-worker's `/connect/*` is another origin, reached with
 * plain `fetch` and the person's session as the bearer (its CORS allows the
 * console's origin only). Assistants are named in plain text: no logos.
 */

import { agoText, dayText, localDayOffset } from "./when";

// ── Scopes and the consent switches ────────────────────────────────

/** The scopes an assistant can be given (MC-2's DELEGATION_SCOPES, in order). */
export const ASSISTANT_SCOPES = ["kitchen.read", "money.read", "timers.write", "suggest.write"] as const;
export type AssistantScope = (typeof ASSISTANT_SCOPES)[number];

export interface ScopeRow {
  scope: AssistantScope;
  label: string;
  sub: string;
  /** Its switch's state when the page opens (design §3: all on but balances). */
  on: boolean;
}

export const SCOPE_ROWS: readonly ScopeRow[] = [
  { scope: "kitchen.read", label: "Read your kitchen", sub: "Pantries, recipes, what you can cook, shopping list", on: true },
  { scope: "money.read", label: "See your balances", sub: "Who owes whom, read only", on: false },
  { scope: "timers.write", label: "Set cooking timers", sub: "They ring on your phone", on: true },
  { scope: "suggest.write", label: "Suggest uses and purchases", sub: "They wait on Home for you to confirm", on: true },
];

export type ScopeSwitches = Readonly<Record<AssistantScope, boolean>>;

/** The switches as the page opens. */
export function defaultSwitches(): ScopeSwitches {
  return Object.fromEntries(SCOPE_ROWS.map((r) => [r.scope, r.on])) as Record<AssistantScope, boolean>;
}

export function flipScope(switches: ScopeSwitches, scope: AssistantScope): ScopeSwitches {
  return { ...switches, [scope]: !switches[scope] };
}

/** The scopes switched on, in their stored order. */
export function chosenScopes(switches: ScopeSwitches): AssistantScope[] {
  return ASSISTANT_SCOPES.filter((s) => switches[s]);
}

/** Allow needs at least one thing allowed (identity refuses an empty list). */
export function canAllow(switches: ScopeSwitches): boolean {
  return chosenScopes(switches).length > 0;
}

// ── The request mcp-worker keeps ───────────────────────────────────

/** mcp-worker's request ids: 32–64 URL-safe characters. */
const REQ_RE = /^[A-Za-z0-9_-]{32,64}$/;

/** The `req` in the address, or null when there is none or it can't be one (then the page says it expired). */
export function connectReqFrom(raw: string | null | undefined): string | null {
  const value = (raw ?? "").trim();
  return REQ_RE.test(value) ? value : null;
}

/** `GET {mcp}/connect/request?req=` → `data` (MC-3's ConnectRequestInfo; every string but `req` is the client's). */
export interface ConnectRequestInfo {
  req: string;
  clientId: string;
  clientName: string;
  clientDomain: string | null;
  redirectHost: string;
  redirectIsLoopback: boolean;
  requestedScopes: string[];
  expiresAt: string;
}

/** identity keeps a client name of at most this many characters. */
export const CLIENT_NAME_MAX = 80;

/** The client's name as the page shows it and identity stores it: trimmed, at most 80, never empty. */
export function clientNameOf(info: Pick<ConnectRequestInfo, "clientName" | "clientId">): string {
  const name = (info.clientName ?? "").replace(/\s+/g, " ").trim() || (info.clientId ?? "").trim() || "An assistant";
  return Array.from(name).slice(0, CLIENT_NAME_MAX).join("");
}

/** `POST /v1/auth/delegations`'s body for this request and these switches. */
export function delegationRequest(info: ConnectRequestInfo, switches: ScopeSwitches) {
  return {
    scopes: chosenScopes(switches),
    clientName: clientNameOf(info),
    clientId: info.clientId,
    requestId: info.req,
  };
}

/** "Requested by Kitchen helper · signed in as Meera". */
export function requestedByLine(clientName: string, you: string): string {
  return `Requested by ${clientName} · signed in as ${you}`;
}

/** Where the access goes (MC-3: the page must show it): the client's redirect host. */
export function returnsToLine(info: Pick<ConnectRequestInfo, "redirectHost" | "redirectIsLoopback">): string {
  return info.redirectIsLoopback ? `Returns to an app on this computer (${info.redirectHost})` : `Returns to ${info.redirectHost}`;
}

export const CONSENT_TITLE = "Allow an assistant to use Cookpool?";
export const NEVER_MOVES_MONEY = "It can never move money, post, or change your groups. Anything that would is a suggestion you confirm in Cookpool.";
export const DISCONNECT_HINT = "Disconnect any time in You → Connected assistants.";
export const EXPIRED_TEXT = "This request has expired · start again from your assistant";
export const CANCELLED_TEXT = "Cancelled · you can close this page";
export const FAILED_TEXT = "Couldn't connect · try again";
export const ALLOWED_TEXT = "Allowed · going back to your assistant";

// ── mcp-worker's /connect/* ────────────────────────────────────────

export type McpResult<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; code: string; reason?: string; message: string };

export interface McpConnectApi {
  request(req: string): Promise<McpResult<ConnectRequestInfo>>;
  complete(body: { req: string; delegationId: string; token: string }): Promise<McpResult<{ redirectTo: string }>>;
  deny(req: string): Promise<McpResult<{ redirectTo: string }>>;
  disconnect(delegationId: string): Promise<McpResult<{ revokedGrants: number; delegationRevoked: boolean }>>;
}

type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

/**
 * mcp-worker's `/connect/*` on `origin`. Writes carry the person's session
 * (`token`); the read carries none. The usual envelopes: `{ data }` and
 * `{ error: { code, message, details } }`; no answer is `network_error`.
 */
export function mcpConnectApi(origin: string, token: string | null, fetchImpl: FetchLike): McpConnectApi {
  const call = async <T>(path: string, init: RequestInit): Promise<McpResult<T>> => {
    let res: Response;
    try {
      res = await fetchImpl(`${origin}${path}`, { ...init, credentials: "omit", cache: "no-store" });
    } catch (e) {
      return { ok: false, status: 0, code: "network_error", message: (e as Error)?.message ?? "network unreachable" };
    }
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      body = null;
    }
    const env = (body ?? {}) as { data?: T; error?: { code?: string; message?: string; details?: { reason?: unknown } } };
    if (res.ok && env.data !== undefined) return { ok: true, data: env.data };
    const reason = env.error?.details?.reason;
    return {
      ok: false,
      status: res.status,
      code: env.error?.code ?? "error",
      ...(typeof reason === "string" ? { reason } : {}),
      message: env.error?.message ?? `Request failed (${res.status})`,
    };
  };
  const post = <T>(path: string, body: unknown) =>
    call<T>(path, {
      method: "POST",
      headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(body),
    });
  return {
    request: (req) => call(`/connect/request?req=${encodeURIComponent(req)}`, { method: "GET" }),
    complete: (body) => post("/connect/complete", body),
    deny: (req) => post("/connect/deny", { req }),
    disconnect: (delegationId) => post("/connect/disconnect", { delegationId }),
  };
}

/** A refusal that means the request is gone: expired, used, or no longer connectable. */
export function isExpired(result: { ok: false; status: number; code: string; reason?: string }): boolean {
  return (result.status === 404 && (result.reason === "expired" || result.code === "not_found")) || result.status === 412;
}

/** Only a real address goes to `location.assign` (never `javascript:` or `data:`). */
export function safeRedirect(raw: unknown): string | null {
  if (typeof raw !== "string" || raw === "") return null;
  try {
    const url = new URL(raw);
    return ["javascript:", "data:", "vbscript:", "blob:", "file:"].includes(url.protocol) ? null : url.toString();
  } catch {
    return null;
  }
}

// ── Allow and Cancel ───────────────────────────────────────────────

/** A result of an identity call as the console's `wrap` gives it. */
export type IdentityResult<T> = { ok: true; data: T } | { ok: false; status: number; error: { code: string; message: string; reason?: string | undefined } };

export interface AllowDeps {
  createDelegation(body: ReturnType<typeof delegationRequest>): Promise<IdentityResult<{ delegation: { id: string }; token: string }>>;
  revokeDelegation(id: string): Promise<unknown>;
  complete: McpConnectApi["complete"];
  go(url: string): void;
}

export type ConnectOutcome =
  | { kind: "allowed"; redirectTo: string }
  | { kind: "cancelled" }
  | { kind: "expired" }
  | { kind: "failed"; message: string };

/**
 * Allow: mint the delegation, hand it to mcp-worker, then go where it says.
 * When the hand-off fails the new delegation is revoked again (best effort),
 * so no token is left that no assistant holds. The token lives only in this
 * call: never stored, never logged.
 */
export async function allowFlow(deps: AllowDeps, info: ConnectRequestInfo, switches: ScopeSwitches): Promise<ConnectOutcome> {
  if (!canAllow(switches)) return { kind: "failed", message: "Allow at least one thing" };
  const minted = await deps.createDelegation(delegationRequest(info, switches));
  if (!minted.ok) return { kind: "failed", message: minted.error.message || FAILED_TEXT };
  const { delegation, token } = minted.data;
  const done = await deps.complete({ req: info.req, delegationId: delegation.id, token });
  const to = done.ok ? safeRedirect(done.data.redirectTo) : null;
  if (!done.ok || !to) {
    try {
      await deps.revokeDelegation(delegation.id);
    } catch {
      /* best effort: it expires unused */
    }
    if (!done.ok && isExpired(done)) return { kind: "expired" };
    return { kind: "failed", message: FAILED_TEXT };
  }
  deps.go(to);
  return { kind: "allowed", redirectTo: to };
}

/**
 * Cancel: mcp-worker denies the request (the assistant hears access_denied
 * when it next asks). The page then says so and stays; a request that is
 * already gone says it expired. A failed deny still cancels here: the
 * request lapses by itself within ten minutes.
 */
export async function cancelFlow(deps: { deny: McpConnectApi["deny"] }, req: string): Promise<ConnectOutcome> {
  const r = await deps.deny(req);
  if (!r.ok && isExpired(r)) return { kind: "expired" };
  return { kind: "cancelled" };
}

/** What the page shows after loading the request. */
export function loadOutcome(r: McpResult<ConnectRequestInfo>): { kind: "ready"; info: ConnectRequestInfo } | ConnectOutcome {
  if (r.ok) return { kind: "ready", info: r.data };
  return isExpired(r) ? { kind: "expired" } : { kind: "failed", message: FAILED_TEXT };
}

// ── Connected assistants ───────────────────────────────────────────

export const ASSISTANTS_TITLE = "Connected assistants";
export const ASSISTANTS_HREF = "/you/assistants";
export const ASSISTANTS_LEAD = "Let the assistant you already use read your kitchen and suggest things. It never moves money on its own.";
export const CONNECTOR_LABEL = "Your Cookpool connector";
export const NO_CONNECTOR = "No connector for this environment";

export type AssistantTabId = "gemini" | "claude" | "chatgpt";

export interface AssistantTab {
  id: AssistantTabId;
  /** The assistant's name, as plain text (no logos, no brand styling). */
  label: string;
  steps: readonly string[];
  /** A small caveat, or "". */
  note: string;
}

export const ASSISTANT_TABS: readonly AssistantTab[] = [
  {
    id: "gemini",
    label: "Gemini",
    steps: ["Open Gemini → Settings → Connected apps", "Add a custom app and paste the URL above", "Sign in to Cookpool and approve"],
    note: "Custom apps may not be offered in every country or language yet.",
  },
  {
    id: "claude",
    label: "Claude",
    steps: ["Open Claude → Settings → Connectors", "Add custom connector and paste the URL above", "Sign in to Cookpool and approve"],
    note: "",
  },
  {
    id: "chatgpt",
    label: "ChatGPT",
    steps: ["Open ChatGPT → Settings → Connectors", "Create a connector with the URL above", "Sign in to Cookpool and approve"],
    note: "May need developer mode in some plans.",
  },
];

export function assistantTab(id: string | null | undefined): AssistantTab {
  return ASSISTANT_TABS.find((t) => t.id === id) ?? ASSISTANT_TABS[0]!;
}

export const CAN_DO: readonly string[] = [
  "Read your pantry, recipes, shopping list and balances",
  "Set cooking timers that ring on your phone",
  "Suggest uses and purchases — you confirm them here",
];
export const CANT_DO: readonly string[] = ["Move money, post, change groups or settings"];

export interface DelegationLike {
  id: string;
  clientName: string;
  createdAt: string;
  lastUsedAt: string | null;
}

export interface ConnectedRow {
  id: string;
  name: string;
  /** "Connected 2 days ago · last used 1 h ago". */
  sub: string;
}

/** When it was connected: "today", "yesterday", "3 days ago" (within a week), else "on 28 Oct". */
export function connectedWhen(iso: string, now: Date): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "";
  const days = -localDayOffset(at, now);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;
  return `on ${dayText(iso, now)}`;
}

/** When it was last used: "5 min ago", "1 h ago", "yesterday", "28 Oct"; "not used yet" before the first. */
export function lastUsedWhen(iso: string | null, now: Date): string {
  if (!iso) return "not used yet";
  const text = agoText(iso, now);
  return text ? text.charAt(0).toLowerCase() + text.slice(1) : "not used yet";
}

export function connectedRows(list: readonly DelegationLike[] | null | undefined, now: Date): ConnectedRow[] {
  return (list ?? []).map((d) => {
    const used = lastUsedWhen(d.lastUsedAt, now);
    const connected = connectedWhen(d.createdAt, now);
    return {
      id: d.id,
      name: d.clientName.trim() || "An assistant",
      sub: `${connected ? `Connected ${connected}` : "Connected"} · ${d.lastUsedAt ? `last used ${used}` : used}`,
    };
  });
}

/** "Connected · 2". */
export function connectedLabel(count: number): string {
  return `Connected · ${count}`;
}

/** The list without one: Disconnect removes the row at once. */
export function withoutDelegation<T extends { id: string }>(list: readonly T[] | null | undefined, id: string): T[] {
  return (list ?? []).filter((d) => d.id !== id);
}

/** The toast after Disconnect. No Undo: a revoked token can't come back. */
export function disconnectedToast(name: string): { title: string; description: string } {
  return { title: `Disconnected · ${name}`, description: "Reconnect from your assistant" };
}

export const DISCONNECT_FAILED = "Couldn't disconnect · try again";

/**
 * Disconnect: identity revokes the delegation first (the token stops working
 * at the edge whatever else happens), then mcp-worker ends its grant (best
 * effort; it revokes the same delegation again, harmlessly).
 */
export async function disconnectFlow(
  deps: { revokeDelegation(id: string): Promise<IdentityResult<unknown>>; mcpDisconnect?: ((id: string) => Promise<unknown>) | null },
  id: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const r = await deps.revokeDelegation(id);
  if (!r.ok) return { ok: false, message: DISCONNECT_FAILED };
  if (deps.mcpDisconnect) {
    try {
      await deps.mcpDisconnect(id);
    } catch {
      /* best effort: the grant's token no longer works */
    }
  }
  return { ok: true };
}
