import type { Balance, BalancesResponse, SettlePlan } from "@saas/contracts/kitchen";
import { requireGroupAction } from "../authz.js";
import type { OrgContext } from "../context.js";
import { withKitchenRepo } from "../db.js";
import { balances, settlePlan } from "@saas/kitchen-engine/ledger";
import { successResponse, unavailable } from "../http.js";
import { KITCHEN_ONLY, groupCurrency, toEngineTxns } from "../ledger.js";

// GET /v1/organizations/{org}/kitchen/balances      kitchen.ledger.read
// GET /v1/organizations/{org}/kitchen/settle-plan   kitchen.ledger.read
//
// Both are derived from the whole ledger by the money engine; nothing stores
// a balance. A balance is Σ paid − Σ owed (positive gets money back), and the
// balances add up to zero. The settle plan is the fewest payments that bring
// every balance to zero, with its working (debts → pairs → payments).

export async function handleBalances(ctx: OrgContext): Promise<Response> {
  const denied = await requireGroupAction(ctx, "kitchen.ledger.read");
  if (denied) return denied;

  const roster = await ctx.timings.measure("roster", () => ctx.roster.members(ctx.orgId));
  if (!roster.ok) return unavailable(ctx.requestId);

  return withKitchenRepo(ctx, async (repo) => {
    const currency = await groupCurrency(repo, ctx);
    if (!currency) return unavailable(ctx.requestId);
    const ledger = await ctx.timings.measure("db", () => repo.listSplitsForGroup(ctx.orgId, KITCHEN_ONLY));
    if (!ledger.ok) return unavailable(ctx.requestId);

    // Every member, at zero if they have no transactions; and anyone no longer
    // in the group whose balance is not zero (it stays in the ledger under
    // their name until it is settled).
    const byPerson = new Map<string, number>(roster.members.map((m) => [m.subjectId, 0]));
    for (const [subjectId, amount] of balances(toEngineTxns(ledger.value))) {
      if (amount !== 0 || byPerson.has(subjectId)) byPerson.set(subjectId, amount);
    }
    const list: Balance[] = [...byPerson.entries()]
      .map(([subjectId, balanceMinor]) => ({ subjectId, balanceMinor }))
      .sort((a, b) => b.balanceMinor - a.balanceMinor || (a.subjectId < b.subjectId ? -1 : a.subjectId > b.subjectId ? 1 : 0));

    return successResponse<BalancesResponse>({ currency, balances: list }, ctx.requestId);
  });
}

export async function handleSettlePlan(ctx: OrgContext): Promise<Response> {
  const denied = await requireGroupAction(ctx, "kitchen.ledger.read");
  if (denied) return denied;

  return withKitchenRepo(ctx, async (repo) => {
    const currency = await groupCurrency(repo, ctx);
    if (!currency) return unavailable(ctx.requestId);
    const ledger = await ctx.timings.measure("db", () => repo.listSplitsForGroup(ctx.orgId, KITCHEN_ONLY));
    if (!ledger.ok) return unavailable(ctx.requestId);

    const plan = settlePlan(toEngineTxns(ledger.value));
    return successResponse<SettlePlan>(
      {
        currency,
        payments: plan.payments.map((p) => ({ fromSubjectId: p.fromId, toSubjectId: p.toId, amountMinor: p.amountMinor })),
        working: { ...plan.working },
      },
      ctx.requestId,
    );
  });
}
