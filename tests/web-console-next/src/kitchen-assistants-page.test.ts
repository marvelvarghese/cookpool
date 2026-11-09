// Connected assistants (cookpool-mcp MC-4): the connector URL per environment,
// the tabs, the list and Disconnect; and the two pages in both frames.

import { DEFAULT_APP_CONFIG, mcpOrigin, mcpPublicUrl, resolveAppConfig } from "@web-console-next/lib/app-config";
import { frameRedirect } from "@web-console-next/lib/features";
import { STATIC_PAGES, staticPageFor } from "@web-console-next/lib/static-pages.mjs";
import { backParent } from "@web-console-next/components/kitchen/back";
import { activeKitchenTab, activeNewFrameTab } from "@web-console-next/components/kitchen/nav";
import { qk } from "@web-console-next/lib/query-keys";
import {
  ASSISTANTS_HREF,
  ASSISTANT_TABS,
  CANT_DO,
  CAN_DO,
  DISCONNECT_FAILED,
  assistantTab,
  connectedLabel,
  connectedRows,
  connectedWhen,
  disconnectFlow,
  disconnectedToast,
  lastUsedWhen,
  withoutDelegation,
} from "@web-console-next/components/kitchen/assistants";

describe("the connector URL", () => {
  it("is mcp-worker's workers.dev /mcp in stage and prod, and nothing elsewhere", () => {
    expect(mcpPublicUrl("stage", DEFAULT_APP_CONFIG)).toBe("https://cookpool-mcp-worker-stage.cookpool.workers.dev/mcp");
    expect(mcpPublicUrl("prod", DEFAULT_APP_CONFIG)).toBe("https://cookpool-mcp-worker-prod.cookpool.workers.dev/mcp");
    expect(mcpOrigin("stage", DEFAULT_APP_CONFIG)).toBe("https://cookpool-mcp-worker-stage.cookpool.workers.dev");
    expect(mcpPublicUrl("dev", DEFAULT_APP_CONFIG)).toBeNull();
    expect(mcpPublicUrl(undefined, DEFAULT_APP_CONFIG)).toBeNull();
    expect(mcpOrigin(null, DEFAULT_APP_CONFIG)).toBeNull();
  });

  it("follows CONSOLE_MCP_PUBLIC_URLS (the custom domain, later), https only", () => {
    const cfg = resolveAppConfig({ CONSOLE_MCP_PUBLIC_URLS: "prod=https://mcp.cookpool.store/mcp, stage = http://insecure.example/mcp" });
    expect(mcpPublicUrl("prod", cfg)).toBe("https://mcp.cookpool.store/mcp");
    expect(mcpOrigin("prod", cfg)).toBe("https://mcp.cookpool.store");
    expect(mcpPublicUrl("stage", cfg)).toBeNull();
    expect(mcpPublicUrl("stage", resolveAppConfig({ CONSOLE_MCP_PUBLIC_URLS: "stage=not a url" }))).toBeNull();
  });
});

describe("how to add it", () => {
  it("has Gemini, Claude and ChatGPT, three steps each, Gemini first", () => {
    expect(ASSISTANT_TABS.map((t) => t.label)).toEqual(["Gemini", "Claude", "ChatGPT"]);
    for (const t of ASSISTANT_TABS) {
      expect(t.steps).toHaveLength(3);
      expect(t.steps[2]).toBe("Sign in to Cookpool and approve");
    }
    expect(assistantTab("claude").steps[0]).toBe("Open Claude → Settings → Connectors");
    expect(assistantTab("gemini").note).toBe("Custom apps may not be offered in every country or language yet.");
    expect(assistantTab("chatgpt").note).toBe("May need developer mode in some plans.");
    expect(assistantTab("claude").note).toBe("");
    expect(assistantTab("nope").id).toBe("gemini");
  });

  it("says what it can and can't do", () => {
    expect(CAN_DO).toHaveLength(3);
    expect(CANT_DO).toEqual(["Move money, post, change groups or settings"]);
  });
});

describe("the assistants connected", () => {
  const now = new Date(2026, 10, 9, 12, 0, 0);
  const at = (days: number, hours = 0, minutes = 0) => new Date(2026, 10, 9 - days, 12 - hours, -minutes, 0).toISOString();
  const list = [
    { id: "dlg_b", clientName: "Assistant on laptop", createdAt: at(0, 2), lastUsedAt: at(0, 0, 5) },
    { id: "dlg_a", clientName: "Assistant on Pixel", createdAt: at(2), lastUsedAt: at(0, 1) },
    { id: "dlg_c", clientName: "  ", createdAt: at(20), lastUsedAt: null },
  ];

  it("say when each was connected and last used", () => {
    expect(connectedRows(list, now)).toEqual([
      { id: "dlg_b", name: "Assistant on laptop", sub: "Connected today · last used 5 min ago" },
      { id: "dlg_a", name: "Assistant on Pixel", sub: "Connected 2 days ago · last used 1 h ago" },
      { id: "dlg_c", name: "An assistant", sub: "Connected on 20 Oct · not used yet" },
    ]);
    expect(connectedRows(null, now)).toEqual([]);
    expect(connectedLabel(2)).toBe("Connected · 2");
  });

  it("reads days in words", () => {
    expect(connectedWhen(at(1), now)).toBe("yesterday");
    expect(connectedWhen(at(6), now)).toBe("6 days ago");
    expect(connectedWhen("nope", now)).toBe("");
    expect(lastUsedWhen(at(1), now)).toBe("yesterday");
    expect(lastUsedWhen(null, now)).toBe("not used yet");
  });

  it("Disconnect drops the row and says to reconnect from the assistant, with no Undo", () => {
    expect(withoutDelegation(list, "dlg_a").map((d) => d.id)).toEqual(["dlg_b", "dlg_c"]);
    expect(withoutDelegation(null, "dlg_a")).toEqual([]);
    const toast = disconnectedToast("Assistant on Pixel");
    expect(toast).toEqual({ title: "Disconnected · Assistant on Pixel", description: "Reconnect from your assistant" });
    expect("action" in toast).toBe(false);
  });

  it("Disconnect revokes at identity first, then ends mcp-worker's grant", async () => {
    const log: string[] = [];
    const out = await disconnectFlow(
      {
        revokeDelegation: async (id) => (log.push(`revoke ${id}`), { ok: true, data: { id, revokedAt: "t" } }),
        mcpDisconnect: async (id) => log.push(`mcp ${id}`),
      },
      "dlg_a",
    );
    expect(out).toEqual({ ok: true });
    expect(log).toEqual(["revoke dlg_a", "mcp dlg_a"]);
  });

  it("a refused revoke stops there; a failed mcp-worker call doesn't undo it", async () => {
    const log: string[] = [];
    const refused = await disconnectFlow(
      {
        revokeDelegation: async () => ({ ok: false, status: 0, error: { code: "network_error", message: "x" } }),
        mcpDisconnect: async (id) => log.push(`mcp ${id}`),
      },
      "dlg_a",
    );
    expect(refused).toEqual({ ok: false, message: DISCONNECT_FAILED });
    expect(log).toEqual([]);
    const mcpDown = await disconnectFlow(
      {
        revokeDelegation: async (id) => ({ ok: true, data: { id } }),
        mcpDisconnect: async () => {
          throw new TypeError("Failed to fetch");
        },
      },
      "dlg_a",
    );
    expect(mcpDown).toEqual({ ok: true });
    expect(await disconnectFlow({ revokeDelegation: async () => ({ ok: true, data: null }), mcpDisconnect: null }, "dlg_a")).toEqual({ ok: true });
  });

  it("are cached under their own key", () => {
    expect(qk.assistantDelegations()).toEqual(["assistants", "delegations"]);
  });
});

describe("the pages", () => {
  it("are static pages", () => {
    expect(STATIC_PAGES).toEqual(expect.arrayContaining(["/connect", "/you/assistants"]));
    expect(staticPageFor("/connect")).toBe("/connect");
    expect(staticPageFor("/you/assistants")).toBe("/you/assistants");
    expect(ASSISTANTS_HREF).toBe("/you/assistants");
  });

  it("are the You tab's in the new frame, and go back to You", () => {
    expect(activeNewFrameTab("/connect")).toBe("you");
    expect(activeNewFrameTab("/you/assistants")).toBe("you");
    expect(activeNewFrameTab("/connectx")).toBeNull();
    expect(backParent("/connect", {}, { newFrame: true })).toBe("/you");
    expect(backParent("/you/assistants", {}, { newFrame: true })).toBe("/you");
    // Today's tabs are as they were.
    expect(activeKitchenTab("/connect")).toBeNull();
  });

  it("show in the new frame; today's frame sends /connect Home and Connected assistants to You", () => {
    expect(frameRedirect("/connect", true)).toBeNull();
    expect(frameRedirect("/you/assistants", true)).toBeNull();
    expect(frameRedirect("/connect", false)).toBe("/home");
    expect(frameRedirect("/you/assistants", false)).toBe("/you");
  });
});
