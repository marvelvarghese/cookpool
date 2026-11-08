import {
  RESTOCK_FINISHED_DAYS,
  RESTOCK_LOW_PERCENT,
  RESTOCK_USUAL_DAYS,
  RESTOCK_USUAL_MIN_TIMES,
  type RestockResponse,
} from "@saas/contracts/kitchen";
import type { RequestContext } from "../context.js";
import type { MemberGroup } from "../groups-client.js";
import { successResponse, unavailable } from "../http.js";
import { addDays, isoDay } from "../pantry.js";
import { reachIn, restockLines, withRestockRepos } from "../restock.js";

// What to buy again (PN-3, cookpool-pantry design §6.1–§6.4):
//
//   GET /v1/kitchen/me/restock   self: { finished, runningLow, usual }
//
// Across every pantry the caller can reach — their own, and each group
// membership says they are in with a group role — read in ONE statement
// (see packages/db/src/kitchen/purchases.ts). As on the other cross-pantry
// reads, the role membership returns is the check: every group role reads
// the pantry, and `canAdd` says from the role whether the caller may add to
// it. Usual lines are only for pantries they can add to.

const DAY_MS = 86_400_000;

export async function handleRestock(ctx: RequestContext): Promise<Response> {
  const groups = await ctx.timings.measure("groups", () => ctx.groups.of(ctx.actor.subjectId));
  if (!groups.ok) return unavailable(ctx.requestId);
  const byId = new Map<string, MemberGroup>(groups.groups.map((g) => [g.orgId, g]));
  const now = ctx.now();
  const today = isoDay(now);

  return withRestockRepos(ctx, async ({ purchases }) => {
    const found = await ctx.timings.measure("db", () =>
      purchases.restock({
        ownerSubjectId: ctx.actor.subjectId,
        orgIds: [...byId.keys()],
        finishedSince: new Date(now.getTime() - RESTOCK_FINISHED_DAYS * DAY_MS),
        boughtSince: addDays(today, -RESTOCK_USUAL_DAYS),
        lowPercent: RESTOCK_LOW_PERCENT,
        minTimes: RESTOCK_USUAL_MIN_TIMES,
      }),
    );
    if (!found.ok) return unavailable(ctx.requestId);
    return successResponse<RestockResponse>(restockLines(found.value, reachIn(byId), today), ctx.requestId);
  });
}
