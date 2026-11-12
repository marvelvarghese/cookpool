/**
 * "More in Spliteco" (cookpool-spliteco SE3, design §4, risk SE-D): which
 * Spliteco host this Cookpool opens, and the one-tap handoff address.
 *
 * Spliteco runs on `cookpool-spliteco-web-<env>.cookpool.workers.dev`, the
 * environment the console's API target names; on a local host it is the
 * app's dev server. Cookpool asks identity-worker for a one-time, 60-second
 * code bound to that origin and opens
 * `<origin>/handoff?code=…&next=/groups/<org>&back=<this page>`: Spliteco
 * exchanges the code for its own session and shows "← Back to Cookpool".
 * Pure, so it is unit-testable.
 */

const LOCAL = /^(localhost|127\.0\.0\.1|[a-z0-9-]+\.localhost)$/;

/** The local Spliteco dev server (`apps/spliteco-web`, `next dev -p 3002`). */
export const SPLITECO_LOCAL_ORIGIN = "http://localhost:3002";

/** The Spliteco origin for a Cookpool page on `host` talking to the `env` environment. */
export function splitecoOriginFor(host: string, env: string | null | undefined): string | null {
  const hostname = host.toLowerCase().split(":")[0] ?? "";
  if (LOCAL.test(hostname)) return SPLITECO_LOCAL_ORIGIN;
  if (env !== "dev" && env !== "stage" && env !== "prod") return null;
  return `https://cookpool-spliteco-web-${env}.cookpool.workers.dev`;
}

/** Where the handoff lands: the group in Spliteco, signed in, with the way back to this exact page. */
export function handoffUrl(origin: string, code: string, orgId: string | null, back: string): string {
  const q = new URLSearchParams({ code, next: orgId ? `/groups/${orgId}` : "/", back });
  return `${origin}/handoff?${q.toString()}`;
}

/** What Spliteco adds that a kitchen doesn't need (the card's four tiles). */
export const MORE_IN_SPLITECO = Object.freeze([
  "Trips & friends outside the kitchen",
  "Insights & export",
  "Scan a restaurant bill",
  "Live split & AI assistant",
]);
