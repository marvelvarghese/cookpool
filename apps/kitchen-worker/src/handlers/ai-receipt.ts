import {
  AI_RECEIPT_MAX_BYTES,
  RESTOCK_FINISHED_DAYS,
  RESTOCK_LOW_PERCENT,
  RESTOCK_USUAL_DAYS,
  RESTOCK_USUAL_MIN_TIMES,
  type AiReceiptImageType,
  type AiReceiptResponse,
} from "@saas/contracts/kitchen";
import type { RequestContext } from "../context.js";
import type { MemberGroup } from "../groups-client.js";
import { readJsonObject, successResponse, unavailable, validationError } from "../http.js";
import { addDays, isoDay } from "../pantry.js";
import { reachIn } from "../restock.js";
import { aiProviderFor } from "../ai/provider.js";
import { aiEscalate, runAiTask } from "../ai/runner.js";
import { matchReceipt, type PastPurchase } from "../ai/receipt-match.js";
import { RECEIPT_TASK } from "../ai/receipt-task.js";
import {
  aiBudgetReached,
  aiBudgetSpent,
  aiFailed,
  aiToday,
  aiUnavailable,
  overLimit,
  recordAiAction,
  withAiRepos,
} from "../ai/usage.js";
import { myGroups } from "./dishes.js";

// Receipts (cookpool-ai AI-3, design §3):
//
//   POST /v1/kitchen/me/ai/receipt   self: { image } → AiReceiptResponse; writes nothing
//
// In order: 503 `ai_unavailable` without a key; 422 on a bad photo (not a
// base64 JPEG or WebP, or over 1.5 MB decoded); 429 at today's limit (50
// actions, `ai_daily_limit`) or today's receipts (10, `receipt_daily_limit`,
// AI-13); 503 `budget` once this month's AI budget is spent (AI-13); the
// caller's groups, restock names, item history and group currencies (one
// read each); the model reads the photo (Haiku; one Sonnet retry on a failed
// check only with AI_ESCALATE on — else the lines that pass come back as
// `check`, reason `unclear`); the food list is looked up for the lines in ONE
// read; the lines are matched locally (../ai/receipt-match.ts). One action is
// counted, with its cost.
//
// The image is never stored or logged: it is held in this request only, sent
// to the model, and dropped. Nothing about it but the usage row's counts is
// written anywhere.

const DAY_MS = 86_400_000;
/** How many names of the caller's history the matcher compares against. */
const HISTORY_LIMIT = 500;

type Photo = { ok: true; image: string; mediaType: AiReceiptImageType } | { ok: false; errors: string[] };

/** The first bytes of a base64 string (at most 12), decoded. */
function headBytes(base64: string): Uint8Array {
  const head = atob(base64.slice(0, 16));
  return Uint8Array.from(head, (c) => c.charCodeAt(0));
}

/**
 * Read the photo from the body: base64 (a `data:…;base64,` prefix and
 * whitespace are dropped), a JPEG or WebP by its bytes, at most
 * AI_RECEIPT_MAX_BYTES decoded. Only its first bytes are decoded here.
 */
export function readPhoto(raw: unknown): Photo {
  if (typeof raw !== "string" || raw.trim() === "") return { ok: false, errors: ["Must be a photo, in base64"] };
  const image = raw.replace(/^data:[^,]{0,100};base64,/, "").replace(/\s+/g, "");
  if (image.length < 16 || image.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(image)) {
    return { ok: false, errors: ["Must be a JPEG or WebP photo, in base64"] };
  }
  const padding = image.endsWith("==") ? 2 : image.endsWith("=") ? 1 : 0;
  const bytes = (image.length / 4) * 3 - padding;
  if (bytes > AI_RECEIPT_MAX_BYTES) return { ok: false, errors: ["Must be at most 1.5 MB"] };
  const head = headBytes(image);
  const ascii = (from: number, to: number) => String.fromCharCode(...head.slice(from, to));
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return { ok: true, image, mediaType: "image/jpeg" };
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return { ok: true, image, mediaType: "image/webp" };
  return { ok: false, errors: ["Must be a JPEG or WebP photo, in base64"] };
}

export async function handleAiReceipt(ctx: RequestContext, request: Request): Promise<Response> {
  const provider = aiProviderFor(ctx);
  if (!provider) return aiUnavailable(ctx.requestId);

  const body = await readJsonObject(request);
  if (!body) return validationError(ctx.requestId, { body: ["Must be a JSON object"] });
  const photo = readPhoto(body.image);
  if (!photo.ok) return validationError(ctx.requestId, { image: photo.errors });

  return withAiRepos(ctx, async ({ usage, kitchen, purchases }) => {
    const today = await aiToday(ctx, usage);
    if (!today) return unavailable(ctx.requestId);
    const limited =
      overLimit(ctx.requestId, "actions", today, ctx.now()) ?? overLimit(ctx.requestId, "receipts", today, ctx.now());
    if (limited) return limited;
    if (await aiBudgetReached(ctx, usage)) return aiBudgetSpent(ctx.requestId, ctx.now());

    // What the caller bought before, where, and in which currency: read before the model is paid for.
    const groups = await myGroups(ctx);
    if (!groups) return unavailable(ctx.requestId);
    const byId = new Map<string, MemberGroup>(groups.map((g) => [g.orgId, g]));
    const orgIds = [...byId.keys()];
    const me = ctx.actor.subjectId;
    const now = ctx.now();
    const [restock, history, settings] = await ctx.timings.measure("db", () =>
      Promise.all([
        purchases.restock({
          ownerSubjectId: me,
          orgIds,
          finishedSince: new Date(now.getTime() - RESTOCK_FINISHED_DAYS * DAY_MS),
          boughtSince: addDays(isoDay(now), -RESTOCK_USUAL_DAYS),
          lowPercent: RESTOCK_LOW_PERCENT,
          minTimes: RESTOCK_USUAL_MIN_TIMES,
        }),
        kitchen.itemHistory({ ownerSubjectId: me, orgIds, q: "", limit: HISTORY_LIMIT }),
        kitchen.listGroupSettings(orgIds),
      ]),
    );
    if (!restock.ok || !history.ok || !settings.ok) return unavailable(ctx.requestId);

    const result = await ctx.timings.measure("ai", () =>
      runAiTask(provider, RECEIPT_TASK, { image: photo.image, mediaType: photo.mediaType }, { escalate: aiEscalate(ctx.env) }),
    );
    await recordAiAction(ctx, usage, RECEIPT_TASK.feature, result);
    if (!result.ok) return aiFailed(ctx.requestId);
    const read = result.data;

    // Each purchase once (the restock read and the history share the newest records).
    const past = new Map<string, PastPurchase>();
    const add = (p: PastPurchase) => {
      const seen = past.get(p.record.id);
      if (!seen || seen.times < p.times) past.set(p.record.id, p);
    };
    for (const name of restock.value) add({ record: name.last, times: Math.max(1, name.boughtDays.length) });
    for (const h of history.value) add({ record: h.item, times: h.times });

    const names = [
      ...read.lines.flatMap((l) => (l.isFood ? [l.text, ...(l.name ? [l.name] : [])] : [])),
      ...[...past.values()].map((p) => p.record.name),
    ];
    const foods = await ctx.timings.measure("db", () => kitchen.matchFoods(names));
    if (!foods.ok) return unavailable(ctx.requestId);

    return successResponse<AiReceiptResponse>(
      matchReceipt({
        read,
        purchases: [...past.values()],
        foods: foods.value,
        reach: reachIn(byId),
        currencies: new Map(settings.value.map((s) => [s.orgId, s.currency])),
      }),
      ctx.requestId,
    );
  });
}
