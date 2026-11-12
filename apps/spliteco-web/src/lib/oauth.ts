// Where Google sign-in starts (cookpool-spliteco SE-8). The provider sends
// the person back to api-edge's own callback, and the start sets its state
// cookie on the host it runs on, so the start must run on api-edge's host
// too, not on this app's `/api` (as the console does, Cookpool SM-4).

const WORKERS_DEV = /^cookpool-spliteco-web-(dev|stage|prod)\.cookpool\.workers\.dev$/;
const LOCAL = /^(localhost|127\.0\.0\.1|[a-z0-9-]+\.localhost)$/;

/** The local API `next dev` forwards `/api` to (next.config.mjs). */
export const LOCAL_API = "http://localhost:8787";

/**
 * api-edge's own address for a page on `origin`: the environment's workers.dev
 * API on a deployed host, the local API on a local one, and this origin's
 * `/api` anywhere else. Pure.
 */
export function oauthBaseFor(origin: string): string {
  let hostname: string;
  try {
    hostname = new URL(origin).hostname.toLowerCase();
  } catch {
    return `${origin}/api`;
  }
  const m = WORKERS_DEV.exec(hostname);
  if (m) return `https://cookpool-api-edge-${m[1]}.cookpool.workers.dev`;
  if (LOCAL.test(hostname)) return LOCAL_API;
  return `${origin.replace(/\/+$/, "")}/api`;
}
