// The client address api-edge keys signed-out rate limits on (Cookpool SM-4).
//
// From the internet it is Cloudflare's CF-Connecting-IP and nothing else; over
// the console Worker's service binding (ctx.props { caller: "web-console-next" })
// it is the console's forwarded `x-console-client-ip` and nothing else. A
// client can set neither: not by calling api-edge with the forwarded header,
// and not by sending CF-Connecting-IP (or the header) through the console's
// /api, whose forwarder replaces both (tests/web-console-next api-forward).
// Driven through the entry too, with the join preview's per-IP limit.

import worker from "@api-edge/index";
import {
  CONSOLE_CALLER,
  FORWARDED_CLIENT_IP_HEADER,
  fromConsoleBinding,
  isIpAddress,
  trustedClientIp,
  withTrustedClientIp,
} from "@api-edge/client-ip";
import { __rateLimitConfigForTest, __resetRateLimitMemoryForTest } from "@api-edge/rate-limit";

const CONSOLE_PROPS = { caller: "web-console-next" };
const PREVIEW = "/v1/join/KTCH2345/preview";
const LIMIT = __rateLimitConfigForTest.join_preview.identity.limit;

/** The ExecutionContext a service-binding call (or, with no props, an internet request) gets. */
function ctx(props?: unknown): ExecutionContext {
  return { props, waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext;
}

function req(path: string, headers: Record<string, string> = {}): Request {
  return new Request(`https://api.cookpool.test${path}`, { headers });
}

/** membership-worker answering the preview, so a request that passes the limit is a 200. */
function membership(): Fetcher {
  return {
    fetch: () =>
      Promise.resolve(
        Response.json({ data: { groupName: "Flat 4B", inviterFirstName: "Anu", memberCount: 5 }, meta: { requestId: "m", cursor: null } }),
      ),
    connect() {
      throw new Error("not implemented");
    },
  } as unknown as Fetcher;
}

const env = () => ({ ENVIRONMENT: "test", MEMBERSHIP_WORKER: membership() }) as never;

beforeEach(() => {
  __resetRateLimitMemoryForTest();
});

describe("which caller is the console", () => {
  it("is the binding's props, exactly", () => {
    expect(CONSOLE_CALLER).toBe("web-console-next");
    expect(fromConsoleBinding(CONSOLE_PROPS)).toBe(true);
    for (const props of [undefined, null, {}, { caller: "web-console-nex" }, { caller: ["web-console-next"] }, "web-console-next", 1]) {
      expect(fromConsoleBinding(props)).toBe(false);
    }
  });
});

describe("isIpAddress", () => {
  it("takes a bare IPv4 or IPv6 address", () => {
    for (const ip of ["203.0.113.7", "0.0.0.0", "255.255.255.255", "2001:db8::1", "::1", "2a06:98c0:3600::103", "::ffff:192.0.2.1"]) {
      expect(isIpAddress(ip)).toBe(true);
    }
  });

  it("refuses anything else, a list included", () => {
    for (const v of ["", "unknown", "256.1.1.1", "1.2.3", "1.2.3.4, 5.6.7.8", "1.2.3.4:443", " 1.2.3.4", "bearer:abc", "a".repeat(46), "anon:auth:1.2.3.4"]) {
      expect(isIpAddress(v)).toBe(false);
    }
  });
});

describe("trustedClientIp: the rule", () => {
  it("from the internet: Cloudflare's CF-Connecting-IP, the forwarded header ignored", () => {
    const r = req("/x", { "CF-Connecting-IP": "203.0.113.7", [FORWARDED_CLIENT_IP_HEADER]: "198.51.100.1" });
    for (const props of [undefined, {}, { caller: "someone-else" }]) {
      expect(trustedClientIp(r, props)).toEqual({ ip: "203.0.113.7", source: "cloudflare" });
    }
    expect(trustedClientIp(req("/x", { [FORWARDED_CLIENT_IP_HEADER]: "198.51.100.1" }), undefined)).toEqual({ ip: null, source: "none" });
  });

  it("over the console's binding: the forwarded header, CF-Connecting-IP ignored", () => {
    const r = req("/x", { "CF-Connecting-IP": "203.0.113.7", [FORWARDED_CLIENT_IP_HEADER]: "198.51.100.1" });
    expect(trustedClientIp(r, CONSOLE_PROPS)).toEqual({ ip: "198.51.100.1", source: "console" });
    expect(trustedClientIp(req("/x", { "CF-Connecting-IP": "203.0.113.7" }), CONSOLE_PROPS)).toEqual({ ip: null, source: "none" });
    expect(trustedClientIp(req("/x", { [FORWARDED_CLIENT_IP_HEADER]: "not-an-ip" }), CONSOLE_PROPS)).toEqual({ ip: null, source: "none" });
  });
});

describe("withTrustedClientIp: one address goes on", () => {
  it("leaves an internet request with nothing to drop as it is", () => {
    const r = req("/x", { "CF-Connecting-IP": "203.0.113.7" });
    expect(withTrustedClientIp(r, undefined).request).toBe(r);
  });

  it("drops the forwarded header from an internet request and keeps Cloudflare's address", () => {
    const { request, source } = withTrustedClientIp(
      req("/x", { "CF-Connecting-IP": "203.0.113.7", [FORWARDED_CLIENT_IP_HEADER]: "198.51.100.1", authorization: "Bearer t" }),
      undefined,
    );
    expect(source).toBe("cloudflare");
    expect(request.headers.get("cf-connecting-ip")).toBe("203.0.113.7");
    expect(request.headers.has(FORWARDED_CLIENT_IP_HEADER)).toBe(false);
    expect(request.headers.get("authorization")).toBe("Bearer t");
  });

  it("over the binding, puts the forwarded address in CF-Connecting-IP and drops the header", () => {
    const { request, source } = withTrustedClientIp(
      req("/x?q=1", { "CF-Connecting-IP": "203.0.113.7", [FORWARDED_CLIENT_IP_HEADER]: "198.51.100.1" }),
      CONSOLE_PROPS,
    );
    expect(source).toBe("console");
    expect(request.headers.get("cf-connecting-ip")).toBe("198.51.100.1");
    expect(request.headers.has(FORWARDED_CLIENT_IP_HEADER)).toBe(false);
    expect(new URL(request.url).search).toBe("?q=1");
  });

  it("over the binding with no usable forwarded address, leaves none", () => {
    const { request, source } = withTrustedClientIp(req("/x", { "CF-Connecting-IP": "203.0.113.7" }), CONSOLE_PROPS);
    expect(source).toBe("none");
    expect(request.headers.has("cf-connecting-ip")).toBe(false);
  });

  it("keeps the method and body", async () => {
    const r = new Request("https://api.cookpool.test/v1/auth/login/start", {
      method: "POST",
      headers: { "content-type": "application/json", [FORWARDED_CLIENT_IP_HEADER]: "198.51.100.1" },
      body: JSON.stringify({ email: "anu@example.com" }),
    });
    const { request } = withTrustedClientIp(r, CONSOLE_PROPS);
    expect(request.method).toBe("POST");
    expect(await request.json()).toEqual({ email: "anu@example.com" });
  });
});

describe("through the entry: the join preview's per-IP limit", () => {
  const preview = (headers: Record<string, string>, props?: unknown) => worker.fetch(req(PREVIEW, headers), env(), ctx(props));

  it("a client calling api-edge cannot pick a fresh bucket with the forwarded header", async () => {
    for (let i = 0; i < LIMIT; i++) {
      const res = await preview({ "CF-Connecting-IP": "203.0.113.7", [FORWARDED_CLIENT_IP_HEADER]: `198.51.100.${i}` });
      expect(res.status).toBe(200);
    }
    const over = await preview({ "CF-Connecting-IP": "203.0.113.7", [FORWARDED_CLIENT_IP_HEADER]: "192.0.2.200" });
    expect(over.status).toBe(429);
  });

  it("over the binding each forwarded address has its own bucket", async () => {
    for (let i = 0; i < LIMIT; i++) {
      expect((await preview({ [FORWARDED_CLIENT_IP_HEADER]: "198.51.100.1" }, CONSOLE_PROPS)).status).toBe(200);
    }
    expect((await preview({ [FORWARDED_CLIENT_IP_HEADER]: "198.51.100.1" }, CONSOLE_PROPS)).status).toBe(429);
    expect((await preview({ [FORWARDED_CLIENT_IP_HEADER]: "198.51.100.2" }, CONSOLE_PROPS)).status).toBe(200);
  });

  it("over the binding a CF-Connecting-IP picks nothing", async () => {
    for (let i = 0; i < LIMIT; i++) {
      await preview({ "CF-Connecting-IP": `203.0.113.${i}`, [FORWARDED_CLIENT_IP_HEADER]: "198.51.100.1" }, CONSOLE_PROPS);
    }
    const over = await preview({ "CF-Connecting-IP": "192.0.2.99", [FORWARDED_CLIENT_IP_HEADER]: "198.51.100.1" }, CONSOLE_PROPS);
    expect(over.status).toBe(429);
  });

  it("one client is one bucket, whichever way it came in", async () => {
    // Cloudflare's CF-Connecting-IP on api-edge's own host and the console's
    // forwarded header name the same client the same way.
    for (let i = 0; i < LIMIT; i++) await preview({ "CF-Connecting-IP": "203.0.113.50" });
    expect((await preview({ [FORWARDED_CLIENT_IP_HEADER]: "203.0.113.50" }, CONSOLE_PROPS)).status).toBe(429);
    expect((await preview({ "CF-Connecting-IP": "203.0.113.51" })).status).toBe(200);
  });
});

describe("/health says where the address came from", () => {
  const health = async (headers: Record<string, string>, props?: unknown) => {
    const res = await worker.fetch(req("/health", headers), { ENVIRONMENT: "test" } as never, ctx(props));
    return ((await res.json()) as { checks: { clientIp: { source: string } } }).checks.clientIp.source;
  };

  it("cloudflare from the internet, console over the binding, none otherwise", async () => {
    expect(await health({ "CF-Connecting-IP": "203.0.113.7", [FORWARDED_CLIENT_IP_HEADER]: "198.51.100.1" })).toBe("cloudflare");
    expect(await health({ [FORWARDED_CLIENT_IP_HEADER]: "198.51.100.1" }, CONSOLE_PROPS)).toBe("console");
    expect(await health({ [FORWARDED_CLIENT_IP_HEADER]: "198.51.100.1" })).toBe("none");
    expect(await health({ "CF-Connecting-IP": "203.0.113.7" }, CONSOLE_PROPS)).toBe("none");
  });

  it("still answers without a context (the entry's callers before SM-4)", async () => {
    const res = await worker.fetch(req("/health", { "CF-Connecting-IP": "203.0.113.7" }), { ENVIRONMENT: "test" } as never);
    expect(res.status).toBe(200);
  });
});
