import {
  DEFAULT_KITCHEN_CURRENCY,
  KITCHEN_INTERNAL_ACTORS,
  KITCHEN_INTERNAL_ACTOR_HEADER,
  type SubjectBalanceResponse,
} from "@saas/contracts/kitchen";
import { asUuid, isUuid, type Uuid } from "@saas/db/ids";
import { balances } from "@saas/kitchen-engine/ledger";
import type { RequestContext } from "../context.js";
import { withKitchenRepo } from "../db.js";
import { notFound, successResponse, unavailable } from "../http.js";
import { parseOrgPublicId } from "../ids.js";
import { toEngineTxns } from "../ledger.js";
import { Fields, subjectId } from "../validate.js";

// Service-internal routes (CP-19), for sibling workers over a service binding:
//
//   GET /v1/internal/kitchen/organizations/{org}/subjects/{usr}/balance
//       membership-worker, before it lets someone leave a group (risks CP-L)
//
// Reachable only over a service binding: kitchen-worker has no public URL
// (`workers_dev: false` on stage and prod), api-edge's kitchen facade routes
// /v1/kitchen/… and /v1/organizations/{org}/kitchen/… but never
// /v1/internal/…, and the only other worker bound to kitchen-worker is
// membership-worker. As a second lock the caller names itself in
// `x-internal-actor` (KITCHEN_INTERNAL_ACTORS) — a header api-edge never
// forwards — and anything else reads as a route that does not exist.

/** What an internal route sees: no actor, the caller is a worker. */
export type InternalContext = Pick<RequestContext, "env" | "requestId" | "timings">;

/** Is this request from a worker allowed on the internal routes? */
export function isInternalCaller(request: Request): boolean {
  const caller = request.headers.get(KITCHEN_INTERNAL_ACTOR_HEADER);
  return caller !== null && (KITCHEN_INTERNAL_ACTORS as readonly string[]).includes(caller);
}

/** A group as the internal routes take it: its `org_…` id, or its UUID. */
function orgOf(raw: string): Uuid | null {
  return parseOrgPublicId(raw) ?? (isUuid(raw) ? asUuid(raw) : null);
}

/**
 * GET …/organizations/{org}/subjects/{usr}/balance → `{ balanceMinor, currency }`:
 * Σ paid − Σ owed over the group's whole ledger, as the engine computes
 * every balance (…/balances reads the same). Someone with no money in the
 * group, or a group with no ledger, is 0. A failed read is a 503, which
 * membership-worker treats as "cannot tell" and refuses the leave.
 */
export async function handleSubjectBalance(
  ctx: InternalContext,
  params: readonly string[],
): Promise<Response> {
  const orgId = orgOf(params[0] ?? "");
  let raw: string;
  try {
    raw = decodeURIComponent(params[1] ?? "");
  } catch {
    return notFound(ctx.requestId);
  }
  const subject = subjectId(new Fields(), "subject", raw);
  if (!orgId || subject === undefined) return notFound(ctx.requestId);

  return withKitchenRepo(ctx, async (repo) => {
    const [settings, ledger] = await ctx.timings.measure("db", () =>
      Promise.all([repo.getGroupSettings(orgId), repo.listSplitsForGroup(orgId)]),
    );
    if (!settings.ok || !ledger.ok) return unavailable(ctx.requestId);
    return successResponse<SubjectBalanceResponse>(
      {
        balanceMinor: balances(toEngineTxns(ledger.value)).get(subject) ?? 0,
        currency: settings.value?.currency ?? DEFAULT_KITCHEN_CURRENCY,
      },
      ctx.requestId,
    );
  });
}
