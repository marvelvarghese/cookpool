// You → AI assistants (cookpool-spliteco SE-6): the MCP address per host,
// each assistant's access (Look only / Add & edit) within what was allowed at
// connect, Disconnect, the lists from the canvas, and Activity's "via" chip.

import type { Delegation } from "@saas/contracts/delegations";
import type { SplitecoActivityEntry } from "@saas/contracts/spliteco";
import { viaChip } from "@/lib/activity-text";
import {
  CAN,
  DRAFT_NOTE,
  ONLY_IN_APP,
  accessOf,
  assistantRows,
  disconnectFlow,
  mcpDisconnecter,
  mcpOriginFor,
  mcpUrlFor,
  monoOf,
  reconnectHint,
  scopesFor,
  usedAgo,
  withUpdated,
  withoutAssistant,
} from "@/lib/assistants";

const NOW = new Date("2026-11-12T12:00:00.000Z");

const dlg = (over: Partial<Delegation> = {}): Delegation => ({
  id: "dlg_1",
  scopes: ["kitchen.read", "money.read", "money.write"],
  grantedScopes: ["kitchen.read", "money.read", "money.write"],
  clientName: "Claude",
  clientId: "cli",
  createdAt: "2026-11-10T12:00:00.000Z",
  expiresAt: "2027-02-08T12:00:00.000Z",
  lastUsedAt: "2026-11-12T10:00:00.000Z",
  ...over,
});

describe("the MCP address", () => {
  it("is Cookpool's MCP server on this environment's workers.dev host", () => {
    expect(mcpUrlFor("cookpool-spliteco-web-stage.cookpool.workers.dev")).toBe("https://cookpool-mcp-worker-stage.cookpool.workers.dev/mcp");
    expect(mcpUrlFor("cookpool-spliteco-web-prod.cookpool.workers.dev")).toBe("https://cookpool-mcp-worker-prod.cookpool.workers.dev/mcp");
    expect(mcpUrlFor("localhost:3002")).toBe("http://localhost:8787/mcp");
    expect(mcpOriginFor("evil.example")).toBeNull();
    expect(mcpUrlFor("cookpool-spliteco-web-stage.cookpool.workers.dev.evil.example")).toBeNull();
  });
});

describe("each connected assistant", () => {
  it("reads as Add & edit, Look only or not in Spliteco, with when it was last used", () => {
    expect(accessOf(["money.read", "money.write"])).toBe("write");
    expect(accessOf(["money.read"])).toBe("read");
    expect(accessOf(["kitchen.read"])).toBe("none");
    const rows = assistantRows(
      [dlg(), dlg({ id: "dlg_2", clientName: "ChatGPT", scopes: ["money.read"], grantedScopes: ["money.read"], lastUsedAt: null }), dlg({ id: "dlg_3", clientName: "  ", scopes: ["kitchen.read"], grantedScopes: ["kitchen.read"] })],
      NOW,
    );
    expect(rows.map((r) => [r.name, r.mono, r.access, r.status, r.canRead, r.canWrite])).toEqual([
      ["Claude", "Cl", "write", "Connected · last used 2 h ago · can add & edit", true, true],
      ["ChatGPT", "Ch", "read", "Connected · not used yet · can only look", true, false],
      ["An assistant", "An", "none", "Connected · last used 2 h ago · not allowed in Spliteco", false, false],
    ]);
    expect(assistantRows(null, NOW)).toEqual([]);
    expect(monoOf("✨")).toBe("AI");
    expect(usedAgo("2026-11-09T12:00:00.000Z", NOW)).toBe("3 days ago");
    expect(usedAgo("2026-11-12T11:59:30.000Z", NOW)).toBe("just now");
  });

  it("switches money.write off and on, keeping everything outside Spliteco, within what was allowed at connect", () => {
    const d = dlg();
    expect(scopesFor(d, "read")).toEqual(["kitchen.read", "money.read"]);
    expect(scopesFor(dlg({ scopes: ["kitchen.read", "money.read"] }), "write")).toEqual(["kitchen.read", "money.write", "money.read"]);
    // Nothing to change.
    expect(scopesFor(d, "write")).toBeNull();
    // Not allowed at connect: reconnect instead.
    expect(scopesFor(dlg({ scopes: ["money.read"], grantedScopes: ["money.read"] }), "write")).toBeNull();
    expect(reconnectHint("ChatGPT", "write")).toContain("Add and edit Spliteco expenses");
  });

  it("replaces an updated one and drops a disconnected one", () => {
    const list = [dlg(), dlg({ id: "dlg_2" })];
    expect(withUpdated(list, dlg({ id: "dlg_2", scopes: ["money.read"] })).map((d) => d.scopes)).toEqual([
      ["kitchen.read", "money.read", "money.write"],
      ["money.read"],
    ]);
    expect(withoutAssistant(list, "dlg_1").map((d) => d.id)).toEqual(["dlg_2"]);
  });
});

describe("Disconnect", () => {
  it("revokes at identity first, then ends the grant at the MCP server (best effort)", async () => {
    const order: string[] = [];
    const ok = await disconnectFlow(
      { revoke: async (id) => order.push(`revoke ${id}`), mcpDisconnect: async (id) => { order.push(`mcp ${id}`); throw new Error("offline"); } },
      "dlg_1",
    );
    expect(ok).toEqual({ ok: true });
    expect(order).toEqual(["revoke dlg_1", "mcp dlg_1"]);
    const failed = await disconnectFlow({ revoke: async () => { throw new Error("no"); }, mcpDisconnect: async () => order.push("never") }, "dlg_1");
    expect(failed).toEqual({ ok: false, message: "Couldn't disconnect · try again" });
    expect(order).not.toContain("never");
  });

  it("calls the MCP server's /connect/disconnect with the person's session, never credentials from cookies", async () => {
    const seen: { url: string; init: RequestInit }[] = [];
    const call = mcpDisconnecter("https://mcp.test", "sps_ses_x", (async (url: string, init: RequestInit) => {
      seen.push({ url, init });
      return new Response("{}");
    }) as unknown as typeof fetch)!;
    await call("dlg_1");
    expect(seen[0]!.url).toBe("https://mcp.test/connect/disconnect");
    expect(seen[0]!.init).toMatchObject({ method: "POST", credentials: "omit", body: JSON.stringify({ delegationId: "dlg_1" }) });
    expect((seen[0]!.init.headers as Record<string, string>).authorization).toBe("Bearer sps_ses_x");
    expect(mcpDisconnecter(null, "t", fetch)).toBeNull();
    expect(mcpDisconnecter("https://mcp.test", null, fetch)).toBeNull();
  });
});

describe("the page's words", () => {
  it("lists what an assistant can do, and what stays in the app — settling up first", () => {
    expect(CAN).toHaveLength(5);
    expect(CAN[0]).toContain("equal, exact, %, shares, +/−, itemized");
    expect(ONLY_IN_APP[0]).toBe("Settle up or record any payment");
    expect(DRAFT_NOTE).toMatch(/^Your assistant shows a draft first — nothing saves until you say yes/);
  });
});

describe("Activity's via chip", () => {
  const entry = (over: Partial<SplitecoActivityEntry>) => ({ viaDelegation: null, viaAssistant: null, ...over });
  it("names the assistant, says 'an assistant' when its name was not kept, and is absent for a person's own change", () => {
    expect(viaChip(entry({ viaDelegation: "dlg_1", viaAssistant: "Claude" }))).toBe("via Claude");
    expect(viaChip(entry({ viaDelegation: "dlg_1", viaAssistant: null }))).toBe("via an assistant");
    expect(viaChip(entry({}))).toBeNull();
  });
});
