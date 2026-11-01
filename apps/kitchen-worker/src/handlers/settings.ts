import {
  CURRENCY_CODE_RE,
  DEFAULT_KITCHEN_CURRENCY,
  DEFAULT_WASTE_POLICY,
  KITCHEN_ERROR_REASONS,
  WASTE_POLICIES,
  type KitchenSettings,
  type WastePolicy,
} from "@saas/contracts/kitchen";
import type { KitchenGroupSettings } from "@saas/db/kitchen";
import { requireGroupAction } from "../authz.js";
import type { OrgContext } from "../context.js";
import { withKitchenRepo } from "../db.js";
import { conflict, readJsonObject, successResponse, unavailable, validationError } from "../http.js";

// GET   /v1/organizations/{org}/kitchen/settings   kitchen.pantry.read (every member)
// PATCH /v1/organizations/{org}/kitchen/settings   kitchen.settings.manage (owner, admin)
//
// A group that has never saved settings reads as the defaults, with
// `updatedAt: null`. The first PATCH writes its row; from then on the
// currency is fixed (409 conflict, details.reason "currency_locked").

export function toKitchenSettings(row: KitchenGroupSettings | null): KitchenSettings {
  if (!row) {
    return { currency: DEFAULT_KITCHEN_CURRENCY, wastePolicy: DEFAULT_WASTE_POLICY, updatedAt: null };
  }
  return { currency: row.currency, wastePolicy: row.wastePolicy, updatedAt: row.updatedAt.toISOString() };
}

export async function handleGetSettings(ctx: OrgContext): Promise<Response> {
  const denied = await requireGroupAction(ctx, "kitchen.pantry.read");
  if (denied) return denied;

  return withKitchenRepo(ctx, async (repo) => {
    const result = await ctx.timings.measure("db", () => repo.getGroupSettings(ctx.orgId));
    if (!result.ok) return unavailable(ctx.requestId);
    return successResponse(toKitchenSettings(result.value), ctx.requestId);
  });
}

interface SettingsChange {
  currency?: string;
  wastePolicy?: WastePolicy;
}

type Parsed = { ok: true; value: SettingsChange } | { ok: false; fields: Record<string, string[]> };

function isWastePolicy(value: unknown): value is WastePolicy {
  return typeof value === "string" && (WASTE_POLICIES as readonly string[]).includes(value);
}

/** Validate a PATCH body. Unknown fields are ignored, as on every baseline route. */
export function parseSettingsChange(body: Record<string, unknown>): Parsed {
  const fields: Record<string, string[]> = {};
  const value: SettingsChange = {};

  if (body.wastePolicy !== undefined) {
    if (isWastePolicy(body.wastePolicy)) value.wastePolicy = body.wastePolicy;
    else fields.wastePolicy = [`Must be one of: ${WASTE_POLICIES.join(", ")}`];
  }
  if (body.currency !== undefined) {
    if (typeof body.currency === "string" && CURRENCY_CODE_RE.test(body.currency)) value.currency = body.currency;
    else fields.currency = ["Must be a three-letter ISO 4217 code in capitals, such as INR"];
  }
  if (body.wastePolicy === undefined && body.currency === undefined) {
    fields.body = ["Provide wastePolicy, currency or both"];
  }

  return Object.keys(fields).length > 0 ? { ok: false, fields } : { ok: true, value };
}

export async function handleUpdateSettings(ctx: OrgContext, request: Request): Promise<Response> {
  const denied = await requireGroupAction(ctx, "kitchen.settings.manage");
  if (denied) return denied;

  const body = await readJsonObject(request);
  if (!body) return validationError(ctx.requestId, { body: ["Must be a JSON object"] });
  const parsed = parseSettingsChange(body);
  if (!parsed.ok) return validationError(ctx.requestId, parsed.fields);

  return withKitchenRepo(ctx, async (repo) => {
    const result = await ctx.timings.measure("db", () =>
      repo.upsertGroupSettings({ orgId: ctx.orgId, ...parsed.value, now: ctx.now() }),
    );
    if (result.ok) return successResponse(toKitchenSettings(result.value), ctx.requestId);
    if (result.error.kind === "currency_locked") {
      return conflict(
        ctx.requestId,
        `The group's currency is ${result.error.currency} and cannot be changed`,
        KITCHEN_ERROR_REASONS.CURRENCY_LOCKED,
        { currency: result.error.currency },
      );
    }
    return unavailable(ctx.requestId);
  });
}
