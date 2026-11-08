import type {
  GroupPantry,
  PantriesResponse,
  PersonalPantry,
  ReachableItem,
  ReachableItemsPage,
  SearchItemsResponse,
  WastePolicy,
} from "@saas/contracts/kitchen";
import type { KitchenItemRecord, KitchenPantryScope, KitchenRepository } from "@saas/db/kitchen";
import { DEFAULT_KITCHEN_CURRENCY } from "@saas/contracts/kitchen";
import type { RequestContext } from "../context.js";
import { withKitchenRepo } from "../db.js";
import { canUseIn, type MemberGroup } from "../groups-client.js";
import { notFound, successResponse, unavailable, validationError } from "../http.js";
import { parseOrgPublicId } from "../ids.js";
import { readMeasures } from "../measures.js";
import {
  DEFAULT_SEARCH_LIMIT,
  MAX_SEARCH_LIMIT,
  PERSONAL_PANTRY_NAME,
  encodeItemsCursor,
  expiresFilter,
  groupPantryRef,
  limitParam,
  pantryTotals,
  parseItemsListParams,
  personalCurrency,
  personalPantryRef,
  queryParam,
  todayOf,
  toKitchenItem,
  wastePolicyOf,
} from "../pantry.js";
import { Fields } from "../validate.js";
import { itemAskFields, readAskRules } from "../asks.js";

// Every pantry the caller can reach, read as one:
//
//   GET /v1/kitchen/me/pantries                      their own, then each group's by name, with counts and worth
//   GET /v1/kitchen/me/items?pantry=&q=&filter=&usable=   items across them, soonest use-by first
//   GET /v1/kitchen/me/search?q=&limit=&usable=           items with something left, best name match first
//
// "Can reach" is the caller's personal pantry and the pantry of every group
// membership says they are in with a group role (owner, admin, builder,
// viewer). Every one of those roles reads the pantry (`kitchen.pantry.read`,
// design.md §6), so the role membership returns is the check here: asking
// policy once per group would cost a hop per group on every read. Group
// writes still go through the group's own routes and the policy engine.
//
// Reading is not using: a viewer reads a group's pantry but may not use from
// it. Every item these reads return says `canUse` — its own pantry, or a
// group where the caller's role holds kitchen.item.use (USE_ROLES) — and
// `usable=1` keeps only those, so quick use and the dish maker never offer an
// item whose use would be refused.

/** The caller's groups, by name; null when membership could not be read. */
async function myGroups(ctx: RequestContext): Promise<MemberGroup[] | null> {
  const result = await ctx.timings.measure("groups", () => ctx.groups.of(ctx.actor.subjectId));
  if (!result.ok) return null;
  return [...result.groups].sort((a, b) => a.name.localeCompare(b.name) || a.slug.localeCompare(b.slug));
}

/** The groups a read covers: all of them, or with `usable`, those the caller may use from. */
function reachable(groups: readonly MemberGroup[], usable: boolean): readonly MemberGroup[] {
  return usable ? groups.filter(canUseIn) : groups;
}

/**
 * Items as the API shows them, each with its pantry, whether the caller may use it and its measures (SM-13). The
 * groups' waste rules are read in one query for the groups the items are in, and every item's measures in one
 * more, side by side.
 */
async function present(
  ctx: RequestContext,
  repo: KitchenRepository,
  groups: readonly MemberGroup[],
  records: readonly KitchenItemRecord[],
): Promise<ReachableItem[] | null> {
  const byId = new Map(groups.map((g) => [g.orgId as string, g]));
  const orgIds = [...new Set(records.flatMap((r) => (r.orgId ? [r.orgId] : [])))];
  const [settings, measures, asks] = await Promise.all([
    ctx.timings.measure("db", () => repo.listGroupSettings(orgIds)),
    readMeasures(ctx, repo, records),
    // Who may use an ask-first item (PN-8): one more read, only when some ask first.
    readAskRules(ctx, repo, records),
  ]);
  if (!settings.ok || !measures || !asks) return null;
  const rules = new Map<string, WastePolicy>(settings.value.map((s) => [s.orgId, s.wastePolicy]));

  const { today } = todayOf(ctx.now());
  const items: ReachableItem[] = [];
  for (const record of records) {
    if (record.orgId === null) {
      items.push({ ...toKitchenItem(record, personalPantryRef(), null, today, measures(record)), canUse: true });
      continue;
    }
    const group = byId.get(record.orgId);
    if (!group) continue; // Not reachable: the scope only reads groups in `groups`.
    const ask = itemAskFields(record, asks(record), ctx.actor.subjectId, group.role);
    items.push({
      ...toKitchenItem(record, groupPantryRef(group), rules.get(record.orgId) ?? wastePolicyOf(null), today, measures(record), ask),
      canUse: canUseIn(group),
    });
  }
  return items;
}

export async function handleMyPantries(ctx: RequestContext): Promise<Response> {
  const groups = await myGroups(ctx);
  if (!groups) return unavailable(ctx.requestId);
  const orgIds = groups.map((g) => g.orgId);

  return withKitchenRepo(ctx, async (repo) => {
    const day = todayOf(ctx.now());
    const [totals, settings] = await ctx.timings.measure("db", () =>
      Promise.all([
        repo.pantryTotals({ ownerSubjectId: ctx.actor.subjectId, orgIds, ...day }),
        repo.listGroupSettings(orgIds),
      ]),
    );
    if (!totals.ok || !settings.ok) return unavailable(ctx.requestId);
    const settingsById = new Map(settings.value.map((s) => [s.orgId, s]));

    const mine = totals.value.filter((t) => t.orgId === null);
    const personal: PersonalPantry = {
      kind: "personal",
      name: PERSONAL_PANTRY_NAME,
      ...pantryTotals(mine, personalCurrency(mine)),
    };
    const pantries: GroupPantry[] = groups.map((group) => {
      const groupSettings = settingsById.get(group.orgId);
      const rows = totals.value.filter((t) => t.orgId === group.orgId);
      return {
        kind: "group",
        orgId: group.publicId,
        slug: group.slug,
        name: group.name,
        ...pantryTotals(rows, groupSettings?.currency ?? DEFAULT_KITCHEN_CURRENCY),
        wastePolicy: wastePolicyOf(groupSettings),
      };
    });
    return successResponse<PantriesResponse>({ pantries: [personal, ...pantries] }, ctx.requestId);
  });
}

/** Which pantries `?pantry=` names: `all` (default), `personal`, or one group the caller is in. */
type PantryChoice = { kind: "all" } | { kind: "personal" } | { kind: "group"; publicId: string };

function pantryParam(fields: Fields, url: URL): PantryChoice {
  const raw = url.searchParams.get("pantry");
  if (raw === null || raw === "" || raw === "all") return { kind: "all" };
  if (raw === "personal") return { kind: "personal" };
  if (parseOrgPublicId(raw)) return { kind: "group", publicId: raw };
  fields.add("pantry", "Must be all, personal, or a group's org_ id");
  return { kind: "all" };
}

/** `usable=1` (or `true`): only items the caller may use. */
function usableParam(fields: Fields, url: URL): boolean {
  const raw = url.searchParams.get("usable");
  if (raw === null || raw === "" || raw === "0" || raw === "false") return false;
  if (raw === "1" || raw === "true") return true;
  fields.add("usable", "Must be 1 or 0");
  return false;
}

export async function handleMyItems(ctx: RequestContext, request: Request): Promise<Response> {
  const url = new URL(request.url);
  const fields = new Fields();
  const choice = pantryParam(fields, url);
  const params = parseItemsListParams(fields, url);
  const usable = usableParam(fields, url);
  if (!fields.ok) return validationError(ctx.requestId, fields.errors);

  // The personal pantry alone needs nothing from membership.
  let groups: MemberGroup[] = [];
  if (choice.kind !== "personal") {
    const mine = await myGroups(ctx);
    if (!mine) return unavailable(ctx.requestId);
    groups = mine;
  }
  let scope: KitchenPantryScope;
  switch (choice.kind) {
    case "personal":
      scope = { ownerSubjectId: ctx.actor.subjectId, orgIds: [] };
      break;
    case "group": {
      // A group the caller is not in reads as one that does not exist; one
      // they may only read has nothing usable.
      const group = groups.find((g) => g.publicId === choice.publicId);
      if (!group) return notFound(ctx.requestId);
      scope = { ownerSubjectId: null, orgIds: usable && !canUseIn(group) ? [] : [group.orgId] };
      break;
    }
    default:
      scope = { ownerSubjectId: ctx.actor.subjectId, orgIds: reachable(groups, usable).map((g) => g.orgId) };
  }

  return withKitchenRepo(ctx, async (repo) => {
    const page = await ctx.timings.measure("db", () =>
      repo.listItems({
        ...scope,
        q: params.q,
        expires: expiresFilter(params.filter, todayOf(ctx.now())),
        cursor: params.cursor,
        limit: params.limit,
      }),
    );
    if (!page.ok) return unavailable(ctx.requestId);
    const items = await present(ctx, repo, groups, page.value.items);
    if (!items) return unavailable(ctx.requestId);
    const nextCursor = page.value.nextCursor ? encodeItemsCursor(page.value.nextCursor) : null;
    return successResponse<ReachableItemsPage>({ items, nextCursor }, ctx.requestId, 200, nextCursor);
  });
}

export async function handleSearch(ctx: RequestContext, request: Request): Promise<Response> {
  const url = new URL(request.url);
  const fields = new Fields();
  const q = queryParam(fields, url);
  const limit = limitParam(fields, url, DEFAULT_SEARCH_LIMIT, MAX_SEARCH_LIMIT);
  const usable = usableParam(fields, url);
  if (!fields.ok) return validationError(ctx.requestId, fields.errors);

  const groups = await myGroups(ctx);
  if (!groups) return unavailable(ctx.requestId);
  const orgIds = reachable(groups, usable).map((g) => g.orgId);

  return withKitchenRepo(ctx, async (repo) => {
    const found = await ctx.timings.measure("db", () =>
      repo.searchItems({ ownerSubjectId: ctx.actor.subjectId, orgIds, q: q ?? "", limit }),
    );
    if (!found.ok) return unavailable(ctx.requestId);
    const items = await present(ctx, repo, groups, found.value);
    if (!items) return unavailable(ctx.requestId);
    return successResponse<SearchItemsResponse>({ items }, ctx.requestId);
  });
}
