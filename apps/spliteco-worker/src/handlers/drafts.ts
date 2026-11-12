// An assistant's drafts (cookpool-spliteco SE-6, design §0.9, risk SE-F):
//
//   POST /v1/spliteco/drafts               { action: add | edit | move, … } → 201 { draft }; saves nothing
//   POST /v1/spliteco/drafts/{drf}/save    → the add, edit or move, exactly as drafted
//
// An assistant never writes an expense straight away (./delegated.ts refuses
// the add, edit and move routes to a delegation with `draft_required`): it
// drafts, shows the person the split, and saves only on their yes. A draft is
// checked as the write would be (membership, the split adding up, Cookpool's
// rows, the current version, the currency), so what the person sees is what
// saves. It is kept in D1 (ledger_drafts, migration 560) for
// SPLITECO_DRAFT_MINUTES, the person's and the delegation's that made it:
// anyone else reads the opaque 404.
//
// The save runs the ordinary handler (handlers/expenses.ts) with the draft's
// token as its Idempotency-Key, so everything is checked again at save time
// and a second save answers the same expense instead of posting twice. Every
// row it writes carries the delegation and the assistant's name.

import {
  SPLITECO_DRAFT_MINUTES,
  SPLITECO_DRAFT_TOKEN_RE,
  SPLITECO_ERROR_REASONS,
  type SplitecoCategory,
  type SplitecoDraft,
  type SplitecoDraftResponse,
  type SplitecoDraftShare,
  type SplitecoExpenseRequest,
} from "@saas/contracts/spliteco";
import { createSqlExecutor } from "@saas/db/d1";
import { asUuid } from "@saas/db/ids";
import {
  createSplitecoDraftsRepository,
  createSplitecoRepository,
  type SplitecoDraftRecord,
  type SplitecoDraftsRepository,
  type SplitecoRepository,
  type SplitecoTxnRecord,
} from "@saas/db/spliteco";
import { requireOrgAction } from "../authz.js";
import type { RequestContext } from "../context.js";
import { conflict, notFound, readJsonObject, successResponse, unavailable, unprocessable, validationError } from "../http.js";
import { orgPublicId, parseOrgPublicId, txnPublicId } from "../ids.js";
import { currencyOf, groupLabel, methodOf } from "../ledger.js";
import type { MemberGroup } from "../membership.js";
import {
  currencyRefused,
  handleCreateExpense,
  handleEditExpense,
  handleMoveExpense,
  loadWritable,
  myGroup,
  notInGroup,
  readExpenseBody,
} from "./expenses.js";

const MINUTE_MS = 60 * 1000;
const DAY_MS = 24 * 60 * MINUTE_MS;

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

async function withRepos(
  ctx: RequestContext,
  fn: (repo: SplitecoRepository, drafts: SplitecoDraftsRepository) => Promise<Response>,
): Promise<Response> {
  if (!ctx.env.PLATFORM_DB) return unavailable(ctx.requestId);
  const executor = createSqlExecutor(ctx.env.PLATFORM_DB);
  try {
    return await fn(createSplitecoRepository(executor), createSplitecoDraftsRepository(executor));
  } catch {
    return unavailable(ctx.requestId);
  } finally {
    await executor.dispose();
  }
}

export function newDraftToken(): string {
  return `drf_${crypto.randomUUID().replace(/-/g, "")}`;
}

async function sharesOf(
  ctx: RequestContext,
  splits: readonly { subjectId: string; paidMinor: number; owedMinor: number }[],
): Promise<SplitecoDraftShare[]> {
  const names = await ctx.people.names(splits.map((s) => s.subjectId));
  return splits.map((s) => ({ subjectId: s.subjectId, name: names.get(s.subjectId) ?? null, paidMinor: s.paidMinor, owedMinor: s.owedMinor }));
}

async function beforeOf(ctx: RequestContext, t: SplitecoTxnRecord, group: MemberGroup | undefined): Promise<SplitecoDraft["before"]> {
  return {
    groupId: orgPublicId(t.orgId),
    groupName: groupLabel(group),
    title: t.title,
    totalMinor: t.totalMinor,
    shares: await sharesOf(ctx, t.splits),
  };
}

type Drafted =
  | { ok: true; record: Omit<SplitecoDraftRecord, "id" | "subjectId" | "delegationId" | "createdAt" | "expiresAt" | "savedTxnId" | "savedAt">; draft: Omit<SplitecoDraft, "token" | "expiresAt"> }
  | { ok: false; response: Response };

async function draftAdd(ctx: RequestContext, repo: SplitecoRepository, body: Record<string, unknown>): Promise<Drafted> {
  const orgId = typeof body.groupId === "string" ? parseOrgPublicId(body.groupId) : null;
  if (!orgId) return { ok: false, response: validationError(ctx.requestId, { groupId: ["Must be a group id (org_…)"] }) };
  if (!isObj(body.expense)) return { ok: false, response: validationError(ctx.requestId, { expense: ["Must be an expense"] }) };
  const denied = await requireOrgAction(ctx, orgId, "spliteco.expense.write");
  if (denied) return { ok: false, response: denied };
  const group = await myGroup(ctx, orgId);
  if (group === "unavailable") return { ok: false, response: unavailable(ctx.requestId) };
  if (!group) return { ok: false, response: notFound(ctx.requestId) };
  const read = readExpenseBody(ctx, body.expense, group);
  if (!read.ok) return read;
  const request = read.parsed.value.request;
  const currency = currencyOf(await repo.currencies([orgId]), orgId);
  const refused = currencyRefused(ctx, request.currency, currency);
  if (refused) return { ok: false, response: refused };
  return {
    ok: true,
    record: { action: "add", orgId, txnId: null, body: JSON.stringify(request) },
    draft: expenseDraft("add", group, null, request, currency, await sharesOf(ctx, read.splits), null),
  };
}

async function draftEdit(ctx: RequestContext, repo: SplitecoRepository, body: Record<string, unknown>): Promise<Drafted> {
  if (typeof body.expenseId !== "string") return { ok: false, response: validationError(ctx.requestId, { expenseId: ["Must be an expense id (txn_…)"] }) };
  if (!isObj(body.expense)) return { ok: false, response: validationError(ctx.requestId, { expense: ["Must be an expense"] }) };
  const loaded = await loadWritable(ctx, repo, body.expenseId);
  if (!loaded.ok) return loaded;
  const { txn: original, group } = loaded;
  const read = readExpenseBody(ctx, body.expense, group);
  if (!read.ok) return read;
  const request = read.parsed.value.request;
  const refused = currencyRefused(ctx, request.currency, original.currency);
  if (refused) return { ok: false, response: refused };
  return {
    ok: true,
    record: { action: "edit", orgId: original.orgId, txnId: original.id, body: JSON.stringify(request) },
    draft: expenseDraft("edit", group, txnPublicId(original.id), request, original.currency, await sharesOf(ctx, read.splits), await beforeOf(ctx, original, group)),
  };
}

async function draftMove(ctx: RequestContext, repo: SplitecoRepository, body: Record<string, unknown>): Promise<Drafted> {
  if (typeof body.expenseId !== "string") return { ok: false, response: validationError(ctx.requestId, { expenseId: ["Must be an expense id (txn_…)"] }) };
  const toOrg = typeof body.toGroupId === "string" ? parseOrgPublicId(body.toGroupId) : null;
  if (!toOrg) return { ok: false, response: validationError(ctx.requestId, { toGroupId: ["Must be a group id (org_…)"] }) };
  const loaded = await loadWritable(ctx, repo, body.expenseId);
  if (!loaded.ok) return loaded;
  const { txn: original, group: from } = loaded;
  const target = await myGroup(ctx, toOrg);
  if (target === "unavailable") return { ok: false, response: unavailable(ctx.requestId) };
  if (!target) return { ok: false, response: notFound(ctx.requestId) };
  if (toOrg === original.orgId) return { ok: false, response: conflict(ctx.requestId, "It is already in that group", SPLITECO_ERROR_REASONS.SAME_GROUP) };
  const denied = await requireOrgAction(ctx, toOrg, "spliteco.expense.write");
  if (denied) return { ok: false, response: denied };
  const outsiders = notInGroup(target, original.splits.map((s) => s.subjectId));
  if (outsiders.length > 0) {
    return {
      ok: false,
      response: conflict(ctx.requestId, "Everyone on it must be a member of that group", SPLITECO_ERROR_REASONS.NOT_MEMBERS, { subjectIds: outsiders }),
    };
  }
  const currency = currencyOf(await repo.currencies([toOrg]), toOrg);
  if (currency !== original.currency) {
    return {
      ok: false,
      response: unprocessable(ctx.requestId, `That group's ledger counts in ${currency}`, SPLITECO_ERROR_REASONS.CURRENCY_MISMATCH, { currency }),
    };
  }
  const items = await repo.items([original.id]);
  const shares = await sharesOf(ctx, original.splits);
  return {
    ok: true,
    record: { action: "move", orgId: toOrg, txnId: original.id, body: JSON.stringify({ toGroupId: orgPublicId(toOrg) }) },
    draft: {
      action: "move",
      groupId: orgPublicId(toOrg),
      groupName: groupLabel(target),
      expenseId: txnPublicId(original.id),
      title: original.title,
      totalMinor: original.totalMinor,
      currency: original.currency,
      category: (original.category as SplitecoCategory | null) ?? null,
      method: methodOf(original),
      shares,
      itemCount: items.items.length,
      before: await beforeOf(ctx, original, from),
    },
  };
}

function expenseDraft(
  action: "add" | "edit",
  group: MemberGroup,
  expenseId: string | null,
  request: SplitecoExpenseRequest,
  currency: string,
  shares: SplitecoDraftShare[],
  before: SplitecoDraft["before"],
): Omit<SplitecoDraft, "token" | "expiresAt"> {
  return {
    action,
    groupId: orgPublicId(group.orgId),
    groupName: groupLabel(group),
    expenseId,
    title: request.title,
    totalMinor: request.totalMinor,
    currency,
    category: request.category ?? null,
    method: request.split.method,
    shares,
    itemCount: request.split.method === "items" ? request.split.items.length : 0,
    before,
  };
}

export async function handleCreateDraft(ctx: RequestContext, request: Request): Promise<Response> {
  const body = await readJsonObject(request);
  if (!body) return validationError(ctx.requestId, { body: ["Must be a JSON object"] });
  if (body.action !== "add" && body.action !== "edit" && body.action !== "move") {
    return validationError(ctx.requestId, { action: ["Must be add, edit or move"] });
  }
  return withRepos(ctx, async (repo, drafts) => {
    const drafted =
      body.action === "add" ? await draftAdd(ctx, repo, body) : body.action === "edit" ? await draftEdit(ctx, repo, body) : await draftMove(ctx, repo, body);
    if (!drafted.ok) return drafted.response;
    const now = ctx.now();
    const record: SplitecoDraftRecord = {
      ...drafted.record,
      id: newDraftToken(),
      subjectId: ctx.actor.subjectId,
      delegationId: ctx.actor.delegationId,
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + SPLITECO_DRAFT_MINUTES * MINUTE_MS).toISOString(),
      savedTxnId: null,
      savedAt: null,
    };
    await ctx.timings.measure("db", () => drafts.create(record));
    // Housekeeping: drafts a day past their end.
    await ctx.defer(() => prune(ctx, new Date(now.getTime() - DAY_MS).toISOString()));
    return successResponse<SplitecoDraftResponse>({ draft: { ...drafted.draft, token: record.id, expiresAt: record.expiresAt } }, ctx.requestId, 201);
  });
}

async function prune(ctx: RequestContext, before: string): Promise<void> {
  if (!ctx.env.PLATFORM_DB) return;
  const executor = createSqlExecutor(ctx.env.PLATFORM_DB);
  try {
    await createSplitecoDraftsRepository(executor).prune(before);
  } finally {
    await executor.dispose();
  }
}

export async function handleSaveDraft(ctx: RequestContext, request: Request, token: string): Promise<Response> {
  if (!SPLITECO_DRAFT_TOKEN_RE.test(token)) return notFound(ctx.requestId);
  if (!ctx.env.PLATFORM_DB) return unavailable(ctx.requestId);
  const draft = await readDraft(ctx, token);
  if (draft === "unavailable") return unavailable(ctx.requestId);
  // The person's own, from the same assistant: anyone else's token reads as unknown.
  if (!draft || draft.subjectId !== ctx.actor.subjectId || draft.delegationId !== ctx.actor.delegationId) return notFound(ctx.requestId);
  if (draft.savedTxnId === null && ctx.now().getTime() >= new Date(draft.expiresAt).getTime()) {
    return conflict(ctx.requestId, `This draft is more than ${SPLITECO_DRAFT_MINUTES} minutes old; draft it again`, SPLITECO_ERROR_REASONS.DRAFT_EXPIRED, {
      expiredAt: draft.expiresAt,
    });
  }

  // The ordinary write, keyed by the draft: a second save replays the first.
  const write = new Request(request.url, {
    method: draft.action === "edit" ? "PUT" : "POST",
    headers: { "content-type": "application/json", "idempotency-key": draft.id },
    body: draft.body,
  });
  const response =
    draft.action === "add"
      ? await handleCreateExpense(ctx, write, orgPublicId(draft.orgId))
      : draft.action === "edit"
        ? await handleEditExpense(ctx, write, txnPublicId(asUuid(draft.txnId!)))
        : await handleMoveExpense(ctx, write, txnPublicId(asUuid(draft.txnId!)));
  if (response.ok && draft.savedTxnId === null) {
    const saved = (await response.clone().json().catch(() => null)) as { data?: { expense?: { id?: string } } } | null;
    const id = saved?.data?.expense?.id;
    if (typeof id === "string") await markSaved(ctx, draft.id, id);
  }
  return response;
}

async function readDraft(ctx: RequestContext, token: string): Promise<SplitecoDraftRecord | null | "unavailable"> {
  const executor = createSqlExecutor(ctx.env.PLATFORM_DB!);
  try {
    return await ctx.timings.measure("db", () => createSplitecoDraftsRepository(executor).byId(token));
  } catch {
    return "unavailable";
  } finally {
    await executor.dispose();
  }
}

async function markSaved(ctx: RequestContext, id: string, txnId: string): Promise<void> {
  const executor = createSqlExecutor(ctx.env.PLATFORM_DB!);
  try {
    await createSplitecoDraftsRepository(executor).markSaved(id, txnId, ctx.now().toISOString());
  } catch {
    /* best-effort: the expense is saved; the stamp only records which */
  } finally {
    await executor.dispose();
  }
}
