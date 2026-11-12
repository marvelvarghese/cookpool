import type { OAuthHelpers } from "@cloudflare/workers-oauth-provider";

export interface Env {
  /**
   * The OAuth store (infra/terraform/cloudflare-kv `mcp_oauth`): clients,
   * grants, tokens and pending connect requests. The provider library reads
   * it as `OAUTH_KV`; index.ts aliases it.
   */
  MCP_OAUTH_KV: KVNamespace;
  /** api-edge, with `props: { caller: "mcp-worker" }`: every tool's call goes here. */
  API_EDGE: Fetcher;
  /** identity-worker: only POST /v1/internal/delegations/refresh (MC-2). */
  IDENTITY_WORKER?: Fetcher;
  ENVIRONMENT: string;
  /** The console's origin: where /authorize sends people, and the only origin /connect/* answers. */
  CONSOLE_ORIGIN: string;
  /** This worker's own origin: the OAuth issuer, and the MCP resource is `${MCP_PUBLIC_ORIGIN}/mcp`. */
  MCP_PUBLIC_ORIGIN: string;
  /**
   * The Spliteco app's origin (cookpool-spliteco SE-6): settle_up's and
   * save_expense's links point there, and its AI assistants page may call
   * /connect/disconnect. Optional: without it the links are derived from
   * the workers.dev host, and only the console may disconnect.
   */
  SPLITECO_ORIGIN?: string;
}

/** What the provider library sees: the KV under its own name, and its helpers. */
export interface ProviderEnv extends Env {
  OAUTH_KV: KVNamespace;
  OAUTH_PROVIDER: OAuthHelpers;
}

/** What a grant carries, encrypted (design §2): the delegated token never leaves it but to api-edge. */
export interface GrantProps {
  /** `sps_dlg_…`: the bearer every tool sends to api-edge. */
  delegatedToken: string;
  /** What the person allowed, as identity recorded it. */
  scopes: string[];
  /** `dlg_…` */
  delegationId: string;
  /** ISO 8601: when the delegated token ends (refresh rotates it before then); null when identity did not say. */
  delegatedExpiresAt: string | null;
}

/** What a grant carries in the clear (the library keeps it unencrypted so grants can be listed). */
export interface GrantMetadata {
  delegationId: string;
  clientName: string;
}
