/* eslint-disable @typescript-eslint/no-explicit-any -- loose reads of tool answers in tests */
// End to end (cookpool-spliteco SE-6): mcp-worker's real Spliteco tools →
// the real api-edge (its delegated-token gate, allowlist and spliteco facade)
// → the real spliteco-worker over a real SQLite engine. Only identity is a
// fake: it resolves one delegated token to a person, a delegation and its
// scopes, as identity-worker's /v1/auth/resolve does. No real credential is
// involved; the token is made up.
//
// It walks the canvas's AssistantChat: draft "Sunset cruise", save it, edit
// Dev out, ask to settle (a link, nothing recorded), and checks Activity says
// "via Claude" — and that a payment is never written, however it is asked.

import { z } from "zod";
import worker from "@api-edge/index";
import type { Env as EdgeEnv } from "@api-edge/env";
import type { Env as McpEnv } from "@mcp-worker/env";
import { ALL_TOOLS } from "@mcp-worker/mcp";
import { errorText, isEdgeError, type ToolDef } from "@mcp-worker/tools/types";
import type { SplitecoActivityResponse } from "@saas/contracts/spliteco";
import { route } from "@spliteco-worker/router";
import { ANU, DEV, ME, MEERA, envelope, world } from "./helpers.js";
import type { Harness } from "./harness.js";

const TOKEN = `sps_dlg_${"7".repeat(32)}.notarealsecret`;
const DLG = `dlg_${"7".repeat(32)}`;

function fetcher(handle: (request: Request) => Promise<Response>): Fetcher {
  return {
    // A facade forwards the body as a stream: Node's Request wants `duplex` for that, workerd does not.
    fetch: (input: RequestInfo | URL, init?: RequestInit) =>
      handle(input instanceof Request ? input : new Request(String(input), init ? ({ ...init, duplex: "half" } as RequestInit) : undefined)),
    connect: () => {
      throw new Error("not implemented");
    },
  } as unknown as Fetcher;
}

/** api-edge in front of the harness's spliteco-worker, with an identity that knows one delegated token. */
function stack(h: Harness, scopes: string[]) {
  const identity = fetcher(async (request) => {
    if (!request.url.includes("/v1/auth/resolve")) return Response.json({ error: { code: "not_found" } }, { status: 404 });
    if (request.headers.get("authorization") !== `Bearer ${TOKEN}`) return Response.json({ error: { code: "unauthenticated" } }, { status: 401 });
    return Response.json({
      data: { actor: { actorType: "user", actorId: ME, email: "you@spliteco.test", delegation: { id: DLG, scopes, clientName: "Claude" } } },
      meta: { requestId: "r", cursor: null },
    });
  });
  const reached: string[] = [];
  const splitecoWorker = fetcher(async (request) => {
    reached.push(`${request.method} ${new URL(request.url).pathname}`);
    return route(request, h.env, {});
  });
  const edgeEnv = { ENVIRONMENT: "test", IDENTITY_WORKER: identity, SPLITECO_WORKER: splitecoWorker } as unknown as EdgeEnv;
  const apiEdge = fetcher((request) => worker.fetch(request, edgeEnv));
  const env = { API_EDGE: apiEdge, ENVIRONMENT: "test", MCP_PUBLIC_ORIGIN: "https://cookpool-mcp-worker-stage.cookpool.workers.dev" } as unknown as McpEnv;
  const tools = new Map(ALL_TOOLS.filter((t) => scopes.includes(t.scope)).map((t) => [t.name, t]));

  /** A tools/call as the MCP server runs it: the schema first, then the tool, then the plain words for a refusal. */
  async function call(name: string, args: Record<string, unknown> = {}): Promise<{ ok: boolean; text: string; data: any }> {
    const tool = tools.get(name) as ToolDef | undefined;
    if (!tool) return { ok: false, text: `not listed: ${name}`, data: null };
    const parsed = z.object(tool.inputSchema).parse(args);
    const outcome = await tool.run(parsed as never, { env, bearer: TOKEN, requestId: "req_e2e", now: Date.now() });
    if (isEdgeError(outcome)) return { ok: false, text: tool.explain?.(outcome) ?? errorText(outcome), data: outcome };
    return { ok: true, text: outcome.summary, data: outcome.data };
  }
  return { call, reached, tools };
}

const txns = (h: Harness) => h.db.prepare("SELECT kind, via_delegation, via_client FROM kitchen_txns ORDER BY rowid").all() as { kind: string; via_delegation: string | null; via_client: string | null }[];

describe("an assistant with Add & edit, end to end", () => {
  it("drafts, saves only on yes, edits, deletes, restores and moves — every row via Claude — and settles only by link", async () => {
    const { h, goa, flat } = world();
    const s = stack(h, ["money.read", "money.write"]);

    // "Add the sunset cruise to Goa Trip — ₹3,200, Anu paid, split equally."
    const people = await s.call("find_people", { groupId: goa.publicId });
    expect(people.ok).toBe(true);
    expect(people.data.people.map((p: { name: string }) => p.name).sort()).toEqual(["Anu", "Dev", "Meera"]);
    const drafted = await s.call("draft_expense", {
      groupId: goa.publicId,
      expense: { title: "Sunset cruise", totalMinor: 320000, category: "entertainment", payers: [{ subjectId: ANU, amountMinor: 320000 }], split: { method: "equal", participants: [ME, ANU, DEV, MEERA] } },
    });
    expect(drafted.text).toMatch(/^DRAFT — nothing is saved yet\. Add "Sunset cruise" to Goa Trip: ₹3,200\.00, Anu paid/);
    expect(drafted.data.shares.map((x: { share: string }) => x.share)).toEqual(["₹800.00", "₹800.00", "₹800.00", "₹800.00"]);
    expect(txns(h)).toEqual([]);

    // "Yes."
    const saved = await s.call("save_expense", { token: drafted.data.token });
    expect(saved.ok).toBe(true);
    expect(saved.text).toBe('Saved "Sunset cruise" in Goa Trip: ₹3,200.00. It shows as via this assistant in Spliteco\'s activity.');
    const id = saved.data.id as string;
    expect(saved.data.open).toBe(`https://cookpool-spliteco-web-stage.cookpool.workers.dev/expense?id=${id}`);

    // "Oh wait, Dev skipped the cruise."
    const edit = await s.call("edit_expense", {
      expenseId: id,
      expense: { title: "Sunset cruise", totalMinor: 320000, category: "entertainment", payers: [{ subjectId: ANU, amountMinor: 320000 }], split: { method: "equal", participants: [ME, ANU, MEERA] } },
    });
    expect(edit.text).toMatch(/^DRAFT — nothing is saved yet\. Change "Sunset cruise"/);
    expect(edit.data.before.shares).toHaveLength(4);
    expect(txns(h)).toHaveLength(1);
    const edited = await s.call("save_expense", { token: edit.data.token });
    expect(edited.ok).toBe(true);

    // Delete, restore, move: each via Claude too.
    const current = edited.data.id as string;
    expect((await s.call("delete_expense", { expenseId: current })).ok).toBe(true);
    expect((await s.call("restore_expense", { expenseId: current })).ok).toBe(true);
    const search = await s.call("search_expenses", { query: "cruise" });
    const live = search.data.expenses[0].id as string;
    // Meera is not in Flat 4B: the draft says so, and nothing moves.
    const refused = await s.call("move_expense", { expenseId: live, toGroupId: flat.publicId });
    expect(refused).toMatchObject({ ok: false, text: "Not everyone on it is in that group, so it can't move there." });
    h.grant(MEERA, flat, "builder");
    const move = await s.call("move_expense", { expenseId: live, toGroupId: flat.publicId });
    expect(move.text).toMatch(/^DRAFT — nothing is saved yet\. Move "Sunset cruise" to Flat 4B/);
    expect((await s.call("save_expense", { token: move.data.token })).ok).toBe(true);

    expect(txns(h).every((t) => t.via_delegation === DLG && t.via_client === "Claude")).toBe(true);
    expect(txns(h).map((t) => t.kind)).toEqual(["expense", "expense", "reversal", "reversal", "expense", "expense", "reversal"]);

    // Activity, as the person reads it in the app: via Claude on every change.
    const act = (await envelope<SplitecoActivityResponse>(await h.call("GET", "/v1/spliteco/me/activity", { as: ME }))).data;
    expect(act.entries.length).toBeGreaterThanOrEqual(5);
    expect(act.entries.every((e) => e.viaAssistant === "Claude")).toBe(true);
    expect((await s.call("get_activity")).data.entries.every((e: { via?: string }) => e.via === "Claude")).toBe(true);

    // "Now settle up with Dev." — a link, and no payment route is ever reached.
    const settle = await s.call("settle_up", { groupId: flat.publicId, personId: DEV });
    expect(settle.text).toContain("I can't record payments");
    expect(settle.data.url).toBe(`https://cookpool-spliteco-web-stage.cookpool.workers.dev/settle?group=${flat.publicId}&to=${DEV}`);
    expect(s.reached.filter((r) => /settlements|not-received|settle-plan|profile|\/live/.test(r))).toEqual([]);
    // Nothing straight away either: every add, edit and move went through a draft.
    expect(s.reached.filter((r) => /\/groups\/[^/]+\/expenses$|^PUT |\/move$/.test(r))).toEqual([]);
    expect(txns(h).some((t) => t.kind === "settlement")).toBe(false);
  });

  it("refuses an expired-looking or made-up draft token as the edge and the worker would", async () => {
    const { h } = world();
    const s = stack(h, ["money.read", "money.write"]);
    const res = await s.call("save_expense", { token: `drf_${"0".repeat(32)}` });
    expect(res).toMatchObject({ ok: false, text: "Cookpool couldn't find that. Check the id and try again." });
  });
});

describe("an assistant with Look only, end to end", () => {
  it("lists no writes, and the edge refuses a write sent anyway", async () => {
    const { h, goa } = world();
    const s = stack(h, ["money.read"]);
    expect([...s.tools.keys()].filter((n) => ["draft_expense", "save_expense", "delete_expense"].includes(n))).toEqual([]);
    expect((await s.call("list_groups")).ok).toBe(true);
    // A write tool the grant does not list, called anyway against the edge: refused there, before the worker.
    const draft = ALL_TOOLS.find((t) => t.name === "draft_expense")!;
    const outcome = await draft.run(
      { groupId: goa.publicId, expense: { title: "x", totalMinor: 100, payers: [{ subjectId: ME, amountMinor: 100 }], split: { method: "equal", participants: [ME] } } } as never,
      { env: { API_EDGE: fetcher((r) => worker.fetch(r, { ENVIRONMENT: "test", IDENTITY_WORKER: fetcher(async () => Response.json({ data: { actor: { actorType: "user", actorId: ME, email: "x", delegation: { id: DLG, scopes: ["money.read"], clientName: "Claude" } } }, meta: {} })), SPLITECO_WORKER: fetcher((req) => route(req, h.env, {})) } as never)) } as never, bearer: TOKEN, requestId: "r", now: Date.now() },
    );
    expect(isEdgeError(outcome) && [outcome.status, outcome.reason]).toEqual([403, "scope"]);
    expect(txns(h)).toEqual([]);
  });
});
