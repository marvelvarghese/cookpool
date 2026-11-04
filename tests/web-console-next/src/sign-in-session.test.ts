import { createClient } from "@web-console-next/lib/api";
import {
  JOIN_AFTER_SIGN_IN_TTL_MS,
  clearJoinAfterSignIn,
  joinAfterSignInPending,
  rememberJoinAfterSignIn,
  rememberLoginNext,
  takeLoginNext,
} from "@web-console-next/lib/login-return";

// Cookpool SI-5: the session ends on a 401, and a join link that was seen on
// the sign-in page is joined without a second tap — in this tab only.

type FetchArgs = [RequestInfo | URL, RequestInit | undefined];

describe("createClient reports a 401 to the session's token", () => {
  const realFetch = globalThis.fetch;
  let calls: FetchArgs[] = [];
  let status = 401;

  beforeEach(() => {
    calls = [];
    status = 401;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push([input, init]);
      const body =
        status === 200
          ? { data: { providers: [] }, meta: { requestId: "req_t" } }
          : { error: { code: status === 401 ? "unauthenticated" : "internal_error", message: "x", requestId: "req_t" } };
      return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    }) as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  const target = {
    name: "stage",
    url: "https://cookpool-api-edge-stage.unrouted.workers.dev",
    directUrl: "https://cookpool-api-edge-stage.unrouted.workers.dev",
  };

  it("tells the session when the API refuses its token", async () => {
    let reports = 0;
    const client = createClient(target, "tok_old", () => (reports += 1));
    await expect(client.auth.getSession()).rejects.toMatchObject({ status: 401 });
    expect(reports).toBe(1);
    // The token was sent as before.
    expect(new Headers(calls[0]?.[1]?.headers).get("authorization")).toBe("Bearer tok_old");
  });

  it("does not report other failures, or successes", async () => {
    let reports = 0;
    const client = createClient(target, "tok", () => (reports += 1));
    status = 500;
    await expect(client.auth.getSession()).rejects.toBeTruthy();
    status = 200;
    await client.auth.listOAuthProviders();
    expect(reports).toBe(0);
  });

  it("does not report a 401 to a request that carried no token", async () => {
    let reports = 0;
    const signedIn = createClient(target, "tok", () => (reports += 1));
    // The signed-out join preview never sends the token (SI-4's anonymous flag).
    await expect(signedIn.memberships.previewJoinPublic("KTCH2345")).rejects.toMatchObject({ status: 401 });
    expect(new Headers(calls[0]?.[1]?.headers).has("authorization")).toBe(false);
    // And a client with no token has nothing to report.
    const signedOut = createClient(target, null, () => (reports += 1));
    await expect(signedOut.auth.getSession()).rejects.toMatchObject({ status: 401 });
    expect(reports).toBe(0);
  });
});

describe("join after sign-in (sessionStorage, this tab only)", () => {
  const store = new Map<string, string>();
  const g = globalThis as unknown as { window?: unknown };
  const hadWindow = "window" in g;

  beforeAll(() => {
    g.window = {
      sessionStorage: {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => void store.set(k, v),
        removeItem: (k: string) => void store.delete(k),
      },
    };
  });

  afterAll(() => {
    if (!hadWindow) delete g.window;
  });

  beforeEach(() => store.clear());

  const T0 = 1_800_000_000_000;

  it("is pending for the code sign-in recorded, until cleared", () => {
    expect(joinAfterSignInPending("KTCH2345", T0)).toBe(false);
    rememberJoinAfterSignIn("KTCH2345", T0);
    expect([...store.keys()]).toEqual(["cookpool.next.join-after-sign-in"]);
    expect(joinAfterSignInPending("KTCH2345", T0 + 1_000)).toBe(true);
    // A read does not consume it (React may render twice); clearing does.
    expect(joinAfterSignInPending("KTCH2345", T0 + 2_000)).toBe(true);
    clearJoinAfterSignIn();
    expect(joinAfterSignInPending("KTCH2345", T0 + 3_000)).toBe(false);
  });

  it("is for that code only", () => {
    rememberJoinAfterSignIn("KTCH2345", T0);
    expect(joinAfterSignInPending("ABCD2345", T0)).toBe(false);
  });

  it("lapses after its time", () => {
    rememberJoinAfterSignIn("KTCH2345", T0);
    expect(joinAfterSignInPending("KTCH2345", T0 + JOIN_AFTER_SIGN_IN_TTL_MS)).toBe(true);
    expect(joinAfterSignInPending("KTCH2345", T0 + JOIN_AFTER_SIGN_IN_TTL_MS + 1)).toBe(false);
    expect(joinAfterSignInPending("KTCH2345", T0 - 1)).toBe(false);
  });

  it("ignores anything else in the slot", () => {
    for (const value of ["KTCH2345", "{", JSON.stringify({ code: "KTCH2345" }), JSON.stringify({ code: "KTCH2345", at: "x" })]) {
      store.clear();
      store.set("cookpool.next.join-after-sign-in", value);
      expect(joinAfterSignInPending("KTCH2345", T0)).toBe(false);
    }
  });

  it("leaves the baseline's next stash working beside it", () => {
    rememberLoginNext("/join/KTCH2345");
    rememberJoinAfterSignIn("KTCH2345", T0);
    expect(takeLoginNext()).toBe("/join/KTCH2345");
    expect(takeLoginNext()).toBeNull();
    expect(joinAfterSignInPending("KTCH2345", T0)).toBe(true);
  });
});
