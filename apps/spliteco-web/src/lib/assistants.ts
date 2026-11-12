// AI assistants (cookpool-spliteco SE-6, canvas `Assistants`): what the You →
// AI assistants page shows and does, without React, so it is unit-testable.
//
// - The MCP address: Cookpool's MCP server (apps/mcp-worker), the same one
//   Cookpool's console offers, on this environment's workers.dev host.
// - Each connected assistant (identity's delegations), with its access:
//   "Look only" (money.read, no money.write) or "Add & edit" (money.write),
//   changed with PATCH /v1/auth/delegations/{id} within what the person
//   allowed when they connected it, and Disconnect.
// - What an assistant can do here, and what stays in the app.

import type { Delegation, DelegationScope } from "@saas/contracts/delegations";

// ── The MCP address ────────────────────────────────────────────────

const HOST_RE = /^cookpool-spliteco-web-([a-z0-9-]+)\.cookpool\.workers\.dev$/;

/** The MCP server's origin for the app served on `host` (window.location.host); null where there is none. */
export function mcpOriginFor(host: string): string | null {
  const h = host.trim().toLowerCase();
  const m = HOST_RE.exec(h);
  if (m) return `https://cookpool-mcp-worker-${m[1]}.cookpool.workers.dev`;
  if (/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(h)) return "http://localhost:8787";
  return null;
}

/** The address to paste into an assistant: `{mcp}/mcp`. */
export function mcpUrlFor(host: string): string | null {
  const origin = mcpOriginFor(host);
  return origin ? `${origin}/mcp` : null;
}

// ── Access ─────────────────────────────────────────────────────────

export type Access = "write" | "read" | "none";

/** What it may do in Spliteco now: Add & edit, Look only, or nothing here (kitchen-only). */
export function accessOf(scopes: readonly string[]): Access {
  if (scopes.includes("money.write")) return "write";
  if (scopes.includes("money.read")) return "read";
  return "none";
}

export interface AssistantRow {
  id: string;
  name: string;
  /** Two letters for the badge: "Cl". */
  mono: string;
  access: Access;
  /** "Connected · last used 2 h ago · can add & edit". */
  status: string;
  /** Add & edit can be chosen (the person allowed it when they connected). */
  canWrite: boolean;
  /** Look only can be chosen. */
  canRead: boolean;
}

/** "5 min ago", "2 h ago", "3 days ago"; "" before its first use. */
export function usedAgo(iso: string | null, now: Date): string {
  if (!iso) return "";
  const s = Math.max(0, Math.round((now.getTime() - new Date(iso).getTime()) / 1000));
  if (!Number.isFinite(s)) return "";
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86_400) return `${Math.floor(s / 3600)} h ago`;
  const d = Math.floor(s / 86_400);
  return d === 1 ? "yesterday" : `${d} days ago`;
}

export function monoOf(name: string): string {
  const letters = Array.from(name.replace(/[^\p{L}\p{N}]/gu, ""));
  if (letters.length === 0) return "AI";
  return (letters[0]!.toUpperCase() + (letters[1] ?? "").toLowerCase()).slice(0, 2);
}

const ACCESS_WORDS: Record<Access, string> = { write: "can add & edit", read: "can only look", none: "not allowed in Spliteco" };

export function assistantRows(list: readonly Delegation[] | null | undefined, now: Date): AssistantRow[] {
  return (list ?? []).map((d) => {
    const name = d.clientName.trim() || "An assistant";
    const granted = d.grantedScopes ?? d.scopes;
    const access = accessOf(d.scopes);
    const used = usedAgo(d.lastUsedAt, now);
    return {
      id: d.id,
      name,
      mono: monoOf(name),
      access,
      status: ["Connected", used ? `last used ${used}` : "not used yet", ACCESS_WORDS[access]].join(" · "),
      canWrite: granted.includes("money.write"),
      canRead: granted.includes("money.read"),
    };
  });
}

/**
 * The scopes to set for `access`, keeping everything outside Spliteco as it
 * is. Null when that access is not within what was allowed at connect (then
 * the page says to reconnect), or nothing would change.
 */
export function scopesFor(d: Pick<Delegation, "scopes" | "grantedScopes">, access: "read" | "write"): DelegationScope[] | null {
  const granted = d.grantedScopes ?? d.scopes;
  if (!granted.includes("money.read") && access === "read") return null;
  if (!granted.includes("money.write") && access === "write") return null;
  const others = d.scopes.filter((s) => s !== "money.read" && s !== "money.write");
  const money: DelegationScope[] = access === "write" ? ["money.write", ...(granted.includes("money.read") ? (["money.read"] as const) : [])] : ["money.read"];
  const next = [...others, ...money];
  const same = next.length === d.scopes.length && next.every((s) => d.scopes.includes(s));
  return same ? null : next;
}

/** Why an access can't be chosen. */
export function reconnectHint(name: string, access: "read" | "write"): string {
  return access === "write"
    ? `${name} was connected without “Add and edit Spliteco expenses”. Add Cookpool to ${name} again and switch it on.`
    : `${name} was connected without “See your balances”. Add Cookpool to ${name} again and switch it on.`;
}

/** The list with one delegation replaced by its update. */
export function withUpdated(list: readonly Delegation[], updated: Delegation): Delegation[] {
  return list.map((d) => (d.id === updated.id ? updated : d));
}

export function withoutAssistant(list: readonly Delegation[], id: string): Delegation[] {
  return list.filter((d) => d.id !== id);
}

/**
 * Disconnect: identity revokes the delegation first (the token stops working
 * at api-edge within 30 s, whatever else happens), then the MCP server ends
 * its grant (best effort; it revokes the same delegation again, harmlessly).
 */
export async function disconnectFlow(
  deps: { revoke(id: string): Promise<unknown>; mcpDisconnect?: ((id: string) => Promise<unknown>) | null },
  id: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    await deps.revoke(id);
  } catch {
    return { ok: false, message: "Couldn't disconnect · try again" };
  }
  if (deps.mcpDisconnect) {
    try {
      await deps.mcpDisconnect(id);
    } catch {
      /* best effort: the grant's token no longer works */
    }
  }
  return { ok: true };
}

/** POST {mcp}/connect/disconnect with the person's own session (the MCP server's CORS allows this app's origin). */
export function mcpDisconnecter(origin: string | null, token: string | null, fetchImpl: typeof fetch): ((id: string) => Promise<unknown>) | null {
  if (!origin || !token) return null;
  return (id: string) =>
    fetchImpl(`${origin}/connect/disconnect`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ delegationId: id }),
      credentials: "omit",
      cache: "no-store",
    });
}

// ── The words ──────────────────────────────────────────────────────

export const ASSISTANTS_TITLE = "AI assistants";
export const ASSISTANTS_LEAD = "Log and fix splits by just asking.";
export const ASSISTANTS_SUB =
  "Cookpool's MCP server lets Claude, ChatGPT and Gemini add, edit and move Spliteco expenses for you. Settling up stays in this app.";
export const ADD_THIS = "Add this to your assistant";
export const ADD_HOW =
  "When your assistant asks, sign in with your Cookpool account and pick what it may do — switch on “Add and edit Spliteco expenses” to let it log splits. No keys or passwords to paste.";
export const NO_ADDRESS = "No MCP server for this address";

export const CAN: readonly string[] = [
  "Log an expense with any split — equal, exact, %, shares, +/−, itemized",
  "Edit or delete an expense (deleted ones come back for 30 days)",
  "Move an expense to another group",
  "Look up balances, groups, activity and insights",
  "Comment, and send one reminder per person per day",
];

export const ONLY_IN_APP: readonly string[] = [
  "Settle up or record any payment",
  "Add or remove members, or delete a group",
  "Connect apps or change your account",
];

export const DRAFT_NOTE =
  "Your assistant shows a draft first — nothing saves until you say yes. Every change is tagged in Activity (“via Claude”).";

export const NONE_CONNECTED = "No assistant connected yet. Paste the address above into one to start.";
