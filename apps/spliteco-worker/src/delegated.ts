// What an assistant may do here (cookpool-spliteco SE-6, design §0.9, §0.10):
// the second check, after api-edge's allowlist (apps/api-edge/src/
// delegation-scopes.ts), by route name and method. A request that carries a
// delegation (the `x-actor-delegation-id` header api-edge sets for one, and
// only for one) reaches a handler only when its route is listed here AND its
// scopes hold the one the route needs. Everything else is 403 `forbidden`:
//
//   - payments, "not received", the profile (UPI ID) and the settle plan are
//     `not_from_an_assistant` (settling up happens in an app, never from an
//     assistant);
//   - adding, editing and moving straight away are `draft_required`: an
//     assistant drafts (POST /drafts), shows the draft, and saves it
//     (POST /drafts/{drf}/save) only on the person's yes;
//   - anything else (group create and settings, live split, export, the
//     direct-group route) is `scope`.

import type { DelegationScope } from "@saas/contracts/delegations";
import { SPLITECO_ERROR_REASONS } from "@saas/contracts/spliteco";
import type { ActorContext } from "./context.js";
import { forbidden } from "./http.js";

/** `<route name>.<method>` → the scope it needs from a delegated caller. */
export const DELEGATED_ROUTES: Readonly<Record<string, DelegationScope>> = {
  // money.read
  "spliteco.me.home.get": "money.read",
  "spliteco.me.groups.get": "money.read",
  "spliteco.me.activity.get": "money.read",
  "spliteco.me.search.get": "money.read",
  "spliteco.me.friend.get": "money.read",
  "spliteco.group.get": "money.read",
  "spliteco.group.activity.get": "money.read",
  "spliteco.expense.get": "money.read",
  "spliteco.insights.get": "money.read",
  // money.write — never a payment
  "spliteco.drafts.post": "money.write",
  "spliteco.draft.save.post": "money.write",
  "spliteco.expense.delete": "money.write",
  "spliteco.expense.restore.post": "money.write",
  "spliteco.expense.comments.post": "money.write",
  "spliteco.reminders.post": "money.write",
};

/** Routes an assistant reaches only through a draft. */
const DRAFT_ONLY = new Set(["spliteco.group.expenses.post", "spliteco.expense.put", "spliteco.expense.move.post"]);

/** Settling up, and what a payment needs: an app's, never an assistant's. */
const APP_ONLY = new Set([
  "spliteco.group.settlements.post",
  "spliteco.me.payments_received.post",
  "spliteco.settlement.not_received.post",
  "spliteco.group.settle_plan.get",
  "spliteco.me.profile.get",
  "spliteco.me.profile.put",
]);

/** Null when the caller may go on; else the 403 to answer. */
export function delegatedRefusal(actor: ActorContext, routeKey: string, requestId: string): Response | null {
  if (!actor.delegationId) return null;
  const needs = DELEGATED_ROUTES[routeKey];
  if (needs && actor.scopes.includes(needs)) return null;
  if (DRAFT_ONLY.has(routeKey)) {
    return forbidden(requestId, "An assistant saves only a draft the person saw: draft it first", SPLITECO_ERROR_REASONS.DRAFT_REQUIRED);
  }
  if (APP_ONLY.has(routeKey)) {
    return forbidden(requestId, "Payments are made in the app, never by an assistant", SPLITECO_ERROR_REASONS.NOT_FROM_AN_ASSISTANT);
  }
  return forbidden(requestId, "This assistant's access does not allow that", SPLITECO_ERROR_REASONS.SCOPE);
}
