import type { ActivityPage } from "@saas/contracts/kitchen";
import type { KitchenActivityCursor } from "@saas/db/kitchen";
import { isUuid } from "@saas/db/ids";
import { requireGroupAction } from "../authz.js";
import type { OrgContext } from "../context.js";
import { withKitchenRepo } from "../db.js";
import { successResponse, unavailable, validationError } from "../http.js";
import { toKitchenTxn } from "../ledger.js";

// GET /v1/organizations/{org}/kitchen/activity?cursor=&limit=   kitchen.ledger.read
//
// The group's ledger, newest first: every transaction with its splits, and
// whether it has been reversed (and by which transaction). Keyset-paged on
// (occurred_at, id); `nextCursor` is opaque and null on the last page.

export const DEFAULT_ACTIVITY_LIMIT = 25;
export const MAX_ACTIVITY_LIMIT = 100;

const ISO_INSTANT_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

function toBase64Url(text: string): string {
  return btoa(text).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(text: string): string | null {
  try {
    const padded = text.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (text.length % 4)) % 4);
    return atob(padded);
  } catch {
    return null;
  }
}

export function encodeActivityCursor(cursor: KitchenActivityCursor): string {
  return toBase64Url(`${cursor.occurredAt}|${cursor.id}`);
}

export function decodeActivityCursor(token: string): KitchenActivityCursor | null {
  if (token.length > 200) return null;
  const decoded = fromBase64Url(token);
  if (!decoded) return null;
  const [occurredAt, id, extra] = decoded.split("|");
  if (extra !== undefined || !occurredAt || !id || !ISO_INSTANT_RE.test(occurredAt) || !isUuid(id)) return null;
  return { occurredAt, id };
}

export async function handleActivity(ctx: OrgContext, request: Request): Promise<Response> {
  const denied = await requireGroupAction(ctx, "kitchen.ledger.read");
  if (denied) return denied;

  const url = new URL(request.url);
  const fields: Record<string, string[]> = {};
  let limit = DEFAULT_ACTIVITY_LIMIT;
  const rawLimit = url.searchParams.get("limit");
  if (rawLimit !== null && rawLimit !== "") {
    const n = Number(rawLimit);
    if (/^\d+$/.test(rawLimit) && n >= 1 && n <= MAX_ACTIVITY_LIMIT) limit = n;
    else fields.limit = [`Must be a whole number from 1 to ${MAX_ACTIVITY_LIMIT}`];
  }
  let cursor: KitchenActivityCursor | null = null;
  const rawCursor = url.searchParams.get("cursor");
  if (rawCursor !== null && rawCursor !== "") {
    cursor = decodeActivityCursor(rawCursor);
    if (!cursor) fields.cursor = ["Must be a nextCursor this route returned"];
  }
  if (Object.keys(fields).length > 0) return validationError(ctx.requestId, fields);

  return withKitchenRepo(ctx, async (repo) => {
    const page = await ctx.timings.measure("db", () => repo.listActivity(ctx.orgId, { cursor, limit }));
    if (!page.ok) return unavailable(ctx.requestId);
    const nextCursor = page.value.nextCursor ? encodeActivityCursor(page.value.nextCursor) : null;
    const data: ActivityPage = { items: page.value.items.map(toKitchenTxn), nextCursor };
    return successResponse(data, ctx.requestId, 200, nextCursor);
  });
}
