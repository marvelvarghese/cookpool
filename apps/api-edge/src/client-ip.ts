// The client's IP address, as api-edge may believe it (Cookpool SM-4).
//
// rate-limit.ts keys every signed-out request on `CF-Connecting-IP`
// (`anon:<family>:<ip>`: sign-in, the join preview), so whoever can choose
// that header can choose a fresh bucket per request. A request reaches
// api-edge one of two ways, and each has exactly one source it may take the
// address from:
//
//   - From the internet (`cookpool-api-edge-<env>.<subdomain>.workers.dev`):
//     Cloudflare's edge sets `CF-Connecting-IP` to the address that connected
//     (a client's own value does not survive it). That header, nothing else.
//   - Over the console Worker's service binding (`/api/*` on the app's own
//     address, apps/web-console-next/src/worker): there is no edge in between,
//     so there is no `CF-Connecting-IP` of Cloudflare's. The console sends the
//     address Cloudflare gave *it* as `x-console-client-ip`.
//
// The two are told apart by `ctx.props`, not by anything in the request: the
// console's binding declares `props: { caller: "web-console-next" }` in its
// wrangler config, which only someone who can deploy can set, and a request
// from the internet carries no props at all. So the forwarded header counts
// only over that binding; from the internet it is dropped unread, whatever a
// client puts in it. And over the binding `CF-Connecting-IP` counts for
// nothing (the console's own forwarder removes any it was sent).
//
// Normalized once, at the entry: the request goes on with exactly one
// `CF-Connecting-IP` (the trusted address) or none, and no
// `x-console-client-ip`, so no code past the entry can read the other one.

/** The service-binding props that mark the console Worker as the caller. */
export const CONSOLE_CALLER = "web-console-next";

/** The header the console forwards the client's address in. */
export const FORWARDED_CLIENT_IP_HEADER = "x-console-client-ip";

/** The header Cloudflare's edge sets on requests from the internet. */
export const EDGE_CLIENT_IP_HEADER = "cf-connecting-ip";

/** Where the address in force came from; `/health` reports it. */
export type ClientIpSource = "cloudflare" | "console" | "none";

/** True when the request came over the console Worker's service binding. */
export function fromConsoleBinding(props: unknown): boolean {
  return typeof props === "object" && props !== null && (props as { caller?: unknown }).caller === CONSOLE_CALLER;
}

const IPV4_RE = /^(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$/;
const IPV6_RE = /^[0-9a-f:]+(?:\.\d{1,3}){0,3}$/i;

/** A bare IPv4 or IPv6 address (the shape Cloudflare's header has), nothing else. */
export function isIpAddress(value: string): boolean {
  if (IPV4_RE.test(value)) return true;
  return value.length >= 2 && value.length <= 45 && value.includes(":") && IPV6_RE.test(value);
}

/** The one address this request may be keyed on, and where it came from. */
export function trustedClientIp(request: Request, props: unknown): { ip: string | null; source: ClientIpSource } {
  if (fromConsoleBinding(props)) {
    const forwarded = request.headers.get(FORWARDED_CLIENT_IP_HEADER)?.trim() ?? "";
    return isIpAddress(forwarded) ? { ip: forwarded, source: "console" } : { ip: null, source: "none" };
  }
  const edge = request.headers.get(EDGE_CLIENT_IP_HEADER);
  return edge ? { ip: edge, source: "cloudflare" } : { ip: null, source: "none" };
}

/**
 * The request with its client address normalized (see the header): one
 * trusted `CF-Connecting-IP` or none, and no forwarded header. A request from
 * the internet with nothing to drop is returned as it is.
 */
export function withTrustedClientIp(request: Request, props: unknown): { request: Request; source: ClientIpSource } {
  const { ip, source } = trustedClientIp(request, props);
  if (!request.headers.has(FORWARDED_CLIENT_IP_HEADER) && request.headers.get(EDGE_CLIENT_IP_HEADER) === ip) {
    return { request, source };
  }
  const headers = new Headers(request.headers);
  headers.delete(FORWARDED_CLIENT_IP_HEADER);
  if (ip) headers.set(EDGE_CLIENT_IP_HEADER, ip);
  else headers.delete(EDGE_CLIENT_IP_HEADER);
  return { request: new Request(request, { headers }), source };
}
