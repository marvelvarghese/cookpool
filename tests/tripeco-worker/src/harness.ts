// The tripeco-worker test harness: the real router over a real SQLite engine
// with every migration applied (610 included), on top of spliteco-worker's
// harness (../../spliteco-worker/src/harness.ts) so SPLITECO_WORKER is the
// shipped spliteco-worker over the SAME database — a posted ride (TR-3) is a
// real expense with real balances.

import { createHarness, envelope, usr, type CallOptions, type Group, type Harness } from "@spliteco-tests/harness";
import { route } from "@tripeco-worker/router";
import type { Env } from "@tripeco-worker/env";
import type { TripecoDeps } from "@tripeco-worker/context";

export interface TripecoHarness {
  h: Harness;
  env: Env;
  call(method: string, path: string, opts: CallOptions): Promise<Response>;
  /** Spliteco, as the same person would call it through the edge. */
  spliteco(method: string, path: string, opts: CallOptions): Promise<Response>;
  close(): void;
  /** Every call tripeco-worker made to spliteco-worker. */
  spliteCalls: Array<{ method: string; path: string; headers: Record<string, string> }>;
}

function fetcher(handle: (request: Request) => Promise<Response>): Fetcher {
  return {
    fetch(input: string | Request | URL, init?: RequestInit): Promise<Response> {
      const request = input instanceof Request ? input : new Request(String(input), init);
      return handle(request);
    },
    connect() {
      throw new Error("not implemented");
    },
  } as unknown as Fetcher;
}

export function createTripeco(options: { deps?: TripecoDeps } = {}): TripecoHarness {
  const h = createHarness();
  const spliteCalls: TripecoHarness["spliteCalls"] = [];
  const spliteco = fetcher(async (request) => {
    const url = new URL(request.url);
    const sent: Record<string, string> = {};
    request.headers.forEach((v, k) => {
      if (k !== "x-actor-subject-id" && k !== "x-actor-subject-type" && k !== "content-type") sent[k] = v;
    });
    const text = request.body ? await request.text() : undefined;
    spliteCalls.push({ method: request.method, path: url.pathname, headers: sent });
    return h.call(request.method, url.pathname + url.search, {
      as: request.headers.get("x-actor-subject-id"),
      headers: sent,
      ...(text !== undefined && text !== "" ? { rawBody: text } : {}),
    });
  });
  const env: Env = { ENVIRONMENT: "test", PLATFORM_DB: h.env.PLATFORM_DB!, SPLITECO_WORKER: spliteco, APP_URL: "https://tripeco.test" };
  return {
    h,
    env,
    spliteCalls,
    call(method, path, opts) {
      const headers = new Headers({ "x-request-id": "req_test", ...(opts.headers ?? {}) });
      if (opts.as !== null) {
        headers.set("x-actor-subject-id", opts.as);
        headers.set("x-actor-subject-type", "user");
      }
      let body: string | undefined;
      if (opts.rawBody !== undefined) body = opts.rawBody;
      else if (opts.body !== undefined) body = JSON.stringify(opts.body);
      if (body !== undefined) headers.set("content-type", "application/json");
      return route(new Request(`https://tripeco.internal${path}`, { method, headers, ...(body !== undefined ? { body } : {}) }), env, options.deps ?? {});
    },
    spliteco(method, path, opts) {
      return h.call(method, path, opts);
    },
    close() {
      h.close();
    },
  };
}

export { envelope, usr, type Group };
