// The world the Cookpool AI tests (AI-2) run in: the real router over real
// SQLite, a fixed clock, and a stubbed model provider — no test reaches the
// network or reads a real key. The stub answers from a script: each call
// gets the next entry, a function of the request it was sent (so a test can
// read the item refs the worker gave the model) or an error to throw. Every
// request it was sent is kept in `sent`.
//
// People: RAHUL (the caller) is a builder in Flat 4B with Anu and Dev, a
// builder in the Lunch club with Kiran, and a viewer in the Book club with
// Meera — the Book club's pantry is readable, never usable.

import type { KitchenItem, KitchenItemResponse } from "@saas/contracts/kitchen";
import type { AiMessage, AiMessageParams, AiProvider } from "@kitchen-worker/ai/provider";
import { createHarness, envelope, newGroup, type Envelope, type Group, type Harness } from "./harness.js";

/** Monday 9 November 2026, 10:00 UTC. */
export const NOW = new Date("2026-11-09T10:00:00.000Z");

export const RAHUL = "usr_rahul";
export const ANU = "usr_anu";
export const DEV = "usr_dev";
export const KIRAN = "usr_kiran";
export const MEERA = "usr_meera";

/** A price no prompt may carry. */
export const PRICE = 98765;

export interface Result<T> {
  status: number;
  body: Envelope<T>;
}

/** One scripted answer: a model message, a function of the request, or something to throw. */
export type Scripted = AiMessage | ((params: AiMessageParams) => AiMessage) | { throws: unknown };

export interface StubProvider extends AiProvider {
  sent: AiMessageParams[];
  script: Scripted[];
}

export function stubProvider(script: Scripted[] = []): StubProvider {
  const stub: StubProvider = {
    sent: [],
    script,
    async createMessage(params) {
      stub.sent.push(params);
      const next = stub.script.shift();
      if (next === undefined) throw new Error("the stub has no answer left");
      if (typeof next === "function") return next(params);
      if ("throws" in next) throw next.throws;
      return next;
    },
  };
  return stub;
}

/** A model message answering `json`, as the Messages API shapes it. */
export function answer(
  json: unknown,
  opts: { stop?: string; model?: string; usage?: Partial<Record<string, number>> } = {},
): AiMessage {
  return {
    id: "msg_test",
    type: "message",
    role: "assistant",
    model: opts.model ?? "claude-haiku-5-5",
    content: [
      { type: "thinking", thinking: "", signature: "sig" },
      { type: "text", text: typeof json === "string" ? json : JSON.stringify(json), citations: null },
    ],
    stop_reason: opts.stop ?? "end_turn",
    stop_sequence: null,
    stop_details: null,
    usage: {
      input_tokens: 300,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 1200,
      output_tokens: 80,
      ...opts.usage,
    },
  } as unknown as AiMessage;
}

/** What the worker told the model about the caller's pantries (the `<pantries>` block). */
export interface SentContext {
  pantries: string[];
  people: Array<{ ref: string; firstName?: string; pantries: string[] }>;
  items: Array<{ ref: string; name: string; pantry: string; unit: string; left: number; measures: string[] }>;
}

export function contextOf(params: AiMessageParams): SentContext {
  const first = params.messages[0]!.content;
  const text = typeof first === "string" ? first : first.map((b) => (b.type === "text" ? b.text : "")).join("");
  const match = /<pantries>([\s\S]*)<\/pantries>/.exec(text);
  if (!match) throw new Error("no <pantries> block");
  return JSON.parse(match[1]!) as SentContext;
}

/** The ref the model was given for the item named `name` (in `pantry`, when two share it). */
export function refOf(ctx: SentContext, name: string, pantry?: string): string {
  const found = ctx.items.find((i) => i.name === name && (pantry === undefined || i.pantry === pantry));
  if (!found) throw new Error(`no item ${name} in the context`);
  return found.ref;
}

/** The ref the model was given for the person called `firstName`. */
export function personRef(ctx: SentContext, firstName: string): string {
  const found = ctx.people.find((p) => p.firstName === firstName);
  if (!found) throw new Error(`no person ${firstName} in the context`);
  return found.ref;
}

export interface AiWorld {
  h: Harness;
  ai: StubProvider;
  flat: Group;
  lunch: Group;
  books: Group;
  call<T>(method: string, path: string, as: string | null, body?: unknown): Promise<Result<T>>;
  addMine(body: Record<string, unknown>): Promise<KitchenItem>;
  addTo(group: Group, body: Record<string, unknown>, as?: string): Promise<KitchenItem>;
  usageRows(): Array<Record<string, unknown>>;
  close(): void;
}

export const me = (rest: string) => `/v1/kitchen/me/${rest}`;
export const groupPath = (g: Group, rest: string) => `/v1/organizations/${g.publicId}/kitchen/${rest}`;

export function aiWorld(opts: { key?: boolean; now?: () => Date } = {}): AiWorld {
  const ai = stubProvider();
  const h = createHarness({
    deps: { now: opts.now ?? (() => NOW), aiProvider: ai },
    env: { ANTHROPIC_API_KEY: opts.key === false ? undefined : "test-key-not-real" },
  });
  const flat = newGroup("Flat 4B");
  const lunch = newGroup("Lunch club");
  const books = newGroup("Book club");
  h.grant(RAHUL, flat, "builder");
  h.grant(ANU, flat, "owner");
  h.grant(DEV, flat, "builder");
  h.grant(KIRAN, lunch, "owner");
  h.grant(RAHUL, lunch, "builder");
  h.grant(MEERA, books, "owner");
  h.grant(RAHUL, books, "viewer");
  h.profile(RAHUL, { displayName: "Rahul Mehta", email: "rahul.mehta@example.com" });
  h.profile(ANU, { displayName: "Anu Sharma", email: "anu.sharma@example.com" });
  h.profile(DEV, { displayName: "Dev Patel", email: "dev.patel@example.com" });
  h.profile(KIRAN, { displayName: null, email: "kiran.rao@example.com" });
  h.profile(MEERA, { displayName: "Meera Iyer", email: "meera@example.com" });

  async function call<T>(method: string, path: string, as: string | null, body?: unknown): Promise<Result<T>> {
    const res = await h.call(method, path, { as, ...(body !== undefined ? { body } : {}) });
    return { status: res.status, body: await envelope<T>(res) };
  }
  const item = (body: Record<string, unknown>) => ({ category: "Dairy", priceMinor: PRICE, quantity: "1", unit: "pcs", ...body });
  async function created(res: Result<KitchenItemResponse>): Promise<KitchenItem> {
    if (res.status !== 201) throw new Error(`expected 201, got ${res.status}: ${JSON.stringify(res.body)}`);
    return res.body.data.item;
  }

  return {
    h,
    ai,
    flat,
    lunch,
    books,
    call,
    addMine: async (body) => created(await call<KitchenItemResponse>("POST", me("items"), RAHUL, item(body))),
    addTo: async (group, body, as = RAHUL) => created(await call<KitchenItemResponse>("POST", groupPath(group, "items"), as, item(body))),
    usageRows: () => h.db.prepare("SELECT * FROM kitchen_ai_usage ORDER BY created_at, id").all() as Array<Record<string, unknown>>,
    close: () => h.close(),
  };
}
