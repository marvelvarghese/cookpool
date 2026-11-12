// Live split (cookpool-spliteco SE4, design §2; risk SE-E):
//
//   POST /v1/spliteco/groups/{org}/live      open from an itemized draft        spliteco.live.opened
//   GET  /v1/spliteco/live/{code}            the session, claims, who is here   (marks the caller here)
//   POST /v1/spliteco/live/{code}/claims     set or clear one claim
//   POST /v1/spliteco/live/{code}/lock       the opener posts ONE itemized expense
//                                            spliteco.expense.added + spliteco.live.locked
//
// Opening needs `spliteco.expense.write` in the group. Everything else needs
// only membership: a code of a group the caller is not in, a malformed code
// and an unknown code all read as the opaque 404. A member may claim only for
// themselves (403 `own_claims_only`); the opener may set anyone's claim and
// alone may lock (403 `not_the_opener`). The lock is refused until every item
// has someone on it (409 `not_all_claimed`), then posts through the expense
// path — the same parse, engine split, member check and stored rows as
// POST /groups/{org}/expenses — with the session's state in that one batch.
// A session takes claims and a lock for SPLITECO_LIVE_HOURS after it opens
// (409 `live_expired` after); a locked one answers 409 `live_locked` to a
// claim and its own expense to another lock.

import {
  SPLITECO_ERROR_REASONS,
  SPLITECO_ITEM_SHARE_MODES,
  SPLITECO_LIVE_CODE_ALPHABET,
  SPLITECO_LIVE_CODE_LENGTH,
  SPLITECO_LIVE_HOURS,
  SPLITECO_LIVE_PRESENCE_SECONDS,
  SPLITECO_PORTION_SCALE,
  liveDraftTotal,
  normalizeLiveCode,
  type SplitecoLiveClaim,
  type SplitecoLiveDraft,
  type SplitecoLiveResponse,
  type SplitecoLiveSession,
} from "@saas/contracts/spliteco";
import { createSqlExecutor } from "@saas/db/d1";
import { asUuid } from "@saas/db/ids";
import type { AppendEventWithAuditInput } from "@saas/db/events";
import {
  createSplitecoLiveRepository,
  createSplitecoRepository,
  liveLockStatement,
  type SplitecoLiveClaimRecord,
  type SplitecoLiveRepository,
  type SplitecoLiveSessionRecord,
  type SplitecoRepository,
} from "@saas/db/spliteco";
import { formatMinor } from "@saas/kitchen-engine/money";
import { requireOrgAction } from "../authz.js";
import type { RequestContext } from "../context.js";
import { parseExpense, splitExpense } from "../expense-input.js";
import { conflict, forbidden, notFound, readJsonObject, successResponse, unavailable, unprocessable, validationError } from "../http.js";
import { orgPublicId, parseOrgPublicId, txnPublicId } from "../ids.js";
import { currencyOf, groupLabel, splitecoAudit } from "../ledger.js";
import type { MemberGroup } from "../membership.js";
import { myGroup, notInGroup, versionOf, writeOutcome } from "./expenses.js";

const HOUR_MS = 60 * 60 * 1000;

interface Repos {
  ledger: SplitecoRepository;
  live: SplitecoLiveRepository;
}

async function withRepos(ctx: RequestContext, fn: (repos: Repos) => Promise<Response>): Promise<Response> {
  if (!ctx.env.PLATFORM_DB) return unavailable(ctx.requestId);
  const executor = createSqlExecutor(ctx.env.PLATFORM_DB);
  try {
    return await fn({ ledger: createSplitecoRepository(executor), live: createSplitecoLiveRepository(executor) });
  } catch {
    return unavailable(ctx.requestId);
  } finally {
    await executor.dispose();
  }
}

/** A fresh code from the join-code alphabet, by rejection sampling (as membership-worker mints join codes). */
export function generateLiveCode(): string {
  const alphabet = SPLITECO_LIVE_CODE_ALPHABET;
  const limit = 256 - (256 % alphabet.length);
  let code = "";
  while (code.length < SPLITECO_LIVE_CODE_LENGTH) {
    const buf = new Uint8Array(SPLITECO_LIVE_CODE_LENGTH * 2);
    crypto.getRandomValues(buf);
    for (let i = 0; i < buf.length && code.length < SPLITECO_LIVE_CODE_LENGTH; i++) {
      const byte = buf[i]!;
      if (byte < limit) code += alphabet[byte % alphabet.length];
    }
  }
  return code;
}

function newSessionId(): string {
  return `lvs_${crypto.randomUUID().replace(/-/g, "")}`;
}

function eventId(): string {
  return crypto.randomUUID().replace(/-/g, "");
}

function liveAudit(
  ctx: RequestContext,
  input: { type: string; session: SplitecoLiveSessionRecord; description: string; payload: Record<string, unknown> },
): AppendEventWithAuditInput {
  return {
    event: {
      id: eventId(),
      type: input.type,
      version: 1,
      source: "spliteco-worker",
      occurredAt: ctx.now(),
      actorType: ctx.actor.subjectType,
      actorId: ctx.actor.subjectId,
      orgId: input.session.orgId,
      subjectKind: "ledger_live_session",
      subjectId: input.session.id,
      requestId: ctx.requestId,
      payload: { orgId: orgPublicId(input.session.orgId), sessionId: input.session.id, code: input.session.code, ...input.payload },
    },
    audit: { id: eventId(), category: "spliteco", description: input.description },
  };
}

/** The expense body a draft and its claims post as (and what opening validates). */
function expenseBody(draft: SplitecoLiveDraft, claims: readonly Pick<SplitecoLiveClaimRecord, "itemPosition" | "subjectId" | "mode" | "value">[]): Record<string, unknown> {
  const body: Record<string, unknown> = {
    title: draft.title,
    totalMinor: liveDraftTotal(draft),
    category: draft.category ?? null,
    note: draft.note ?? null,
    payers: draft.payers,
    split: {
      method: "items",
      items: draft.items.map((item, position) => ({
        name: item.name,
        qty: item.qty ?? 1,
        unitMinor: item.unitMinor ?? null,
        totalMinor: item.totalMinor,
        shares: claims.filter((c) => c.itemPosition === position).map((c) => ({ subjectId: c.subjectId, mode: c.mode, value: c.value })),
      })),
      adjustments: draft.adjustments,
    },
  };
  if (draft.occurredAt) body.occurredAt = draft.occurredAt;
  return body;
}

function readDraft(session: SplitecoLiveSessionRecord): SplitecoLiveDraft {
  return JSON.parse(session.draft) as SplitecoLiveDraft;
}

function expired(ctx: RequestContext, session: SplitecoLiveSessionRecord): boolean {
  return session.state === "open" && ctx.now().getTime() >= new Date(session.expiresAt).getTime();
}

type Found = { ok: true; session: SplitecoLiveSessionRecord; group: MemberGroup } | { ok: false; response: Response };

/** The session behind `codeParam`, if the caller is in its group; every other case is the opaque 404. */
async function findSession(ctx: RequestContext, live: SplitecoLiveRepository, codeParam: string): Promise<Found> {
  const code = normalizeLiveCode(decodeURIComponent(codeParam));
  if (!code) return { ok: false, response: notFound(ctx.requestId) };
  const session = await live.byCode(code);
  if (!session) return { ok: false, response: notFound(ctx.requestId) };
  const group = await myGroup(ctx, session.orgId);
  if (group === "unavailable") return { ok: false, response: unavailable(ctx.requestId) };
  if (!group) return { ok: false, response: notFound(ctx.requestId) };
  return { ok: true, session, group };
}

async function view(ctx: RequestContext, repos: Repos, session: SplitecoLiveSessionRecord, group: MemberGroup): Promise<SplitecoLiveSession> {
  const since = new Date(ctx.now().getTime() - SPLITECO_LIVE_PRESENCE_SECONDS * 1000).toISOString();
  const [claims, here, currencies] = await Promise.all([
    repos.live.claims(session.id),
    repos.live.presence(session.id, since),
    repos.ledger.currencies([session.orgId]),
  ]);
  const draft = readDraft(session);
  const memberIds = group.members.map((m) => m.subjectId);
  const names = await ctx.people.names([...new Set([...memberIds, session.createdBy])]);
  const claimed = new Set(claims.map((c) => c.itemPosition));
  return {
    id: session.id,
    code: session.code,
    groupId: orgPublicId(session.orgId),
    groupName: groupLabel(group),
    currency: currencyOf(currencies, session.orgId),
    state: expired(ctx, session) ? "expired" : session.state,
    createdBy: session.createdBy,
    createdAt: session.createdAt,
    expiresAt: session.expiresAt,
    draft,
    totalMinor: liveDraftTotal(draft),
    itemsMinor: draft.items.reduce((s, it) => s + it.totalMinor, 0),
    claimedMinor: draft.items.reduce((s, it, i) => s + (claimed.has(i) ? it.totalMinor : 0), 0),
    claims: claims.map((c): SplitecoLiveClaim => ({ ...c })),
    here,
    members: memberIds.map((subjectId) => ({ subjectId, name: names.get(subjectId) ?? null })),
    expenseId: session.txnId ? txnPublicId(session.txnId) : null,
  };
}

async function answer(ctx: RequestContext, repos: Repos, session: SplitecoLiveSessionRecord, group: MemberGroup, status = 200): Promise<Response> {
  return successResponse<SplitecoLiveResponse>({ session: await view(ctx, repos, session, group) }, ctx.requestId, status);
}

/** Who the draft names that the group does not have. */
function outsidersOf(group: MemberGroup, draft: SplitecoLiveDraft, claims: readonly { subjectId: string }[]): string[] {
  return notInGroup(group, [...draft.payers.map((p) => p.subjectId), ...claims.map((c) => c.subjectId)]);
}

export async function handleOpenLive(ctx: RequestContext, request: Request, orgParam: string): Promise<Response> {
  const orgId = parseOrgPublicId(orgParam);
  if (!orgId) return notFound(ctx.requestId);
  const denied = await requireOrgAction(ctx, orgId, "spliteco.expense.write");
  if (denied) return denied;
  const group = await myGroup(ctx, orgId);
  if (group === "unavailable") return unavailable(ctx.requestId);
  if (!group) return notFound(ctx.requestId);

  const body = await readJsonObject(request);
  if (!body) return validationError(ctx.requestId, { body: ["Must be a JSON object"] });
  const items = Array.isArray(body.items) ? (body.items as Record<string, unknown>[]) : [];
  const adjustments = Array.isArray(body.adjustments) ? body.adjustments : [];
  const rawClaims = Array.isArray(body.claims) ? (body.claims as Record<string, unknown>[]) : [];
  // Read through the expense parser: the same fields, limits and messages.
  const claims = rawClaims.map((c) => ({
    itemPosition: c?.itemPosition,
    subjectId: c?.subjectId,
    mode: c?.mode,
    value: c?.value,
  }));
  const asExpense: Record<string, unknown> = {
    title: body.title,
    totalMinor: items.reduce((s, it) => s + (typeof it?.totalMinor === "number" ? it.totalMinor : 0), 0) +
      (adjustments as Record<string, unknown>[]).reduce(
        (s, a) => s + (typeof a?.amountMinor === "number" ? (a.kind === "discount" ? -a.amountMinor : a.amountMinor) : 0),
        0,
      ),
    category: body.category,
    note: body.note,
    occurredAt: body.occurredAt,
    payers: body.payers,
    split: {
      method: "items",
      items: items.map((it, position) => ({
        ...(it && typeof it === "object" ? it : {}),
        shares: claims.filter((c) => c.itemPosition === position).map(({ subjectId, mode, value }) => ({ subjectId, mode, value })),
      })),
      adjustments,
    },
  };
  for (const key of ["category", "note", "occurredAt"]) if (asExpense[key] === undefined) delete asExpense[key];
  const parsed = parseExpense(asExpense);
  const fields: Record<string, string[]> = parsed.ok ? {} : { ...parsed.fields };
  claims.forEach((c, i) => {
    if (typeof c.itemPosition !== "number" || !Number.isSafeInteger(c.itemPosition) || c.itemPosition < 0 || c.itemPosition >= items.length) {
      (fields[`claims[${i}].itemPosition`] ??= []).push("Must be the position of an item");
    }
  });
  if (!parsed.ok || Object.keys(fields).length > 0) return validationError(ctx.requestId, fields);
  const request0 = parsed.value.request;
  if (request0.split.method !== "items") return validationError(ctx.requestId, { split: ["Must be itemized"] });
  const paid = request0.payers.reduce((s, p) => s + p.amountMinor, 0);
  if (paid !== request0.totalMinor) {
    return unprocessable(ctx.requestId, "Who paid must add up to the bill", SPLITECO_ERROR_REASONS.DOES_NOT_ADD_UP, {
      problems: [{ kind: "payers_mismatch", totalMinor: request0.totalMinor, paidMinor: paid }],
    });
  }
  const draft: SplitecoLiveDraft = {
    title: request0.title,
    category: request0.category ?? null,
    note: request0.note ?? null,
    ...(request0.occurredAt ? { occurredAt: request0.occurredAt } : {}),
    payers: request0.payers,
    items: request0.split.items.map(({ name, qty, unitMinor, totalMinor }) => ({ name, qty: qty ?? 1, unitMinor: unitMinor ?? null, totalMinor })),
    adjustments: request0.split.adjustments,
  };
  const now = ctx.now();
  const firstClaims: SplitecoLiveClaimRecord[] = request0.split.items.flatMap((item, itemPosition) =>
    item.shares.map((s) => ({ itemPosition, subjectId: s.subjectId, mode: s.mode, value: s.value, updatedAt: now.toISOString() })),
  );
  const outsiders = outsidersOf(group, draft, firstClaims);
  if (outsiders.length > 0) {
    return unprocessable(ctx.requestId, "Everyone on a live split must be in the group", SPLITECO_ERROR_REASONS.NOT_IN_GROUP, {
      subjectIds: outsiders,
    });
  }

  // ledger_live_sessions.created_by holds the public id (`usr_…`), as
  // kitchen_txns.created_by and every claim's subject_id do — not a UUID.
  const { subjectId: opener } = ctx.actor;
  return withRepos(ctx, async (repos) => {
    for (let attempt = 0; attempt < 5; attempt++) {
      const session: SplitecoLiveSessionRecord = {
        id: newSessionId(),
        orgId,
        code: generateLiveCode(),
        draft: JSON.stringify(draft),
        state: "open",
        createdBy: opener,
        createdAt: now.toISOString(),
        expiresAt: new Date(now.getTime() + SPLITECO_LIVE_HOURS * HOUR_MS).toISOString(),
        txnId: null,
        lockedAt: null,
      };
      const opened = await ctx.timings.measure("db", () =>
        repos.live.open(
          session,
          firstClaims,
          liveAudit(ctx, {
            type: "spliteco.live.opened",
            session,
            description: `Live split ${session.code} "${draft.title}" opened: ${draft.items.length} items`,
            payload: { title: draft.title, items: draft.items.length, totalMinor: liveDraftTotal(draft) },
          }),
        ),
      );
      if (opened.ok) return answer(ctx, repos, session, group, 201);
    }
    return unavailable(ctx.requestId);
  });
}

export async function handleLive(ctx: RequestContext, codeParam: string): Promise<Response> {
  return withRepos(ctx, async (repos) => {
    const found = await findSession(ctx, repos.live, codeParam);
    if (!found.ok) return found.response;
    const { session, group } = found;
    if (session.state === "open" && !expired(ctx, session)) await repos.live.touch(session.id, ctx.actor.subjectId, ctx.now().toISOString());
    return answer(ctx, repos, session, group);
  });
}

/** 409 for a session that no longer changes; null while it is open. */
function closed(ctx: RequestContext, session: SplitecoLiveSessionRecord): Response | null {
  if (session.state === "locked") {
    return conflict(ctx.requestId, "This bill was locked and posted", SPLITECO_ERROR_REASONS.LIVE_LOCKED, {
      expenseId: session.txnId ? txnPublicId(session.txnId) : null,
    });
  }
  if (expired(ctx, session)) return conflict(ctx.requestId, `A live split lasts ${SPLITECO_LIVE_HOURS} hours`, SPLITECO_ERROR_REASONS.LIVE_EXPIRED);
  return null;
}

export async function handleLiveClaim(ctx: RequestContext, request: Request, codeParam: string): Promise<Response> {
  const body = await readJsonObject(request);
  if (!body) return validationError(ctx.requestId, { body: ["Must be a JSON object"] });
  const fields: Record<string, string[]> = {};
  const bad = (name: string, message: string) => void (fields[name] ??= []).push(message);
  const position = body.itemPosition;
  if (typeof position !== "number" || !Number.isSafeInteger(position) || position < 0) bad("itemPosition", "Must be the position of an item");
  const subjectId = body.subjectId === undefined || body.subjectId === null ? ctx.actor.subjectId : body.subjectId;
  if (typeof subjectId !== "string" || !/^[A-Za-z0-9][\w-]{0,127}$/.test(subjectId)) bad("subjectId", "Must be a person's id");
  const clear = body.clear === true;
  const mode = body.mode === undefined ? "portion" : body.mode;
  if (!clear && !(SPLITECO_ITEM_SHARE_MODES as readonly unknown[]).includes(mode)) bad("mode", `Must be one of ${SPLITECO_ITEM_SHARE_MODES.join(", ")}`);
  const value = body.value === undefined ? SPLITECO_PORTION_SCALE : body.value;
  if (!clear && (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0)) bad("value", "Must be a whole number of 0 or more");
  if (Object.keys(fields).length > 0) return validationError(ctx.requestId, fields);

  return withRepos(ctx, async (repos) => {
    const found = await findSession(ctx, repos.live, codeParam);
    if (!found.ok) return found.response;
    const { session, group } = found;
    const refused = closed(ctx, session);
    if (refused) return refused;
    const who = subjectId as string;
    if (who !== ctx.actor.subjectId && session.createdBy !== ctx.actor.subjectId) {
      return forbidden(ctx.requestId, "You can only claim for yourself", SPLITECO_ERROR_REASONS.OWN_CLAIMS_ONLY);
    }
    if (!group.members.some((m) => m.subjectId === who)) {
      return unprocessable(ctx.requestId, "Everyone on a live split must be in the group", SPLITECO_ERROR_REASONS.NOT_IN_GROUP, { subjectIds: [who] });
    }
    const draft = readDraft(session);
    if ((position as number) >= draft.items.length) {
      return unprocessable(ctx.requestId, "There is no item there", SPLITECO_ERROR_REASONS.NO_SUCH_ITEM);
    }
    const now = ctx.now().toISOString();
    const written = await ctx.timings.measure("db", () =>
      repos.live.setClaim(
        session.id,
        { itemPosition: position as number, subjectId: who, mode: mode as SplitecoLiveClaimRecord["mode"], value: clear ? null : (value as number), updatedAt: now },
        now,
      ),
    );
    // The guard refused it: locked or expired meanwhile.
    const current = (await repos.live.byId(session.id)) ?? session;
    if (!written) return closed(ctx, current) ?? unavailable(ctx.requestId);
    await repos.live.touch(session.id, ctx.actor.subjectId, now);
    return answer(ctx, repos, current, group);
  });
}

export async function handleLiveLock(ctx: RequestContext, codeParam: string): Promise<Response> {
  return withRepos(ctx, async (repos) => {
    const found = await findSession(ctx, repos.live, codeParam);
    if (!found.ok) return found.response;
    const { session, group } = found;
    if (session.createdBy !== ctx.actor.subjectId) {
      return forbidden(ctx.requestId, "Only the person who opened it can lock the bill", SPLITECO_ERROR_REASONS.NOT_THE_OPENER);
    }
    // Locking what is locked answers what it posted.
    if (session.state === "locked") return answer(ctx, repos, session, group);
    const refused = closed(ctx, session);
    if (refused) return refused;
    const denied = await requireOrgAction(ctx, asUuid(session.orgId), "spliteco.expense.write");
    if (denied) return denied;

    const draft = readDraft(session);
    const claims = await repos.live.claims(session.id);
    const unclaimed = draft.items.map((_, i) => i).filter((i) => !claims.some((c) => c.itemPosition === i));
    if (unclaimed.length > 0) {
      return conflict(ctx.requestId, "Some items have nobody on them yet", SPLITECO_ERROR_REASONS.NOT_ALL_CLAIMED, { unclaimed });
    }
    const outsiders = outsidersOf(group, draft, claims);
    if (outsiders.length > 0) {
      return unprocessable(ctx.requestId, "Everyone on an expense must be in the group", SPLITECO_ERROR_REASONS.NOT_IN_GROUP, { subjectIds: outsiders });
    }
    const parsed = parseExpense(expenseBody(draft, claims));
    if (!parsed.ok) return validationError(ctx.requestId, parsed.fields);
    const split = splitExpense(parsed.value);
    if (!split.ok) {
      return unprocessable(ctx.requestId, "The split does not add up", SPLITECO_ERROR_REASONS.DOES_NOT_ADD_UP, { problems: split.problems });
    }
    const { request: body, occurredAt } = parsed.value;
    const currency = currencyOf(await repos.ledger.currencies([session.orgId]), session.orgId);
    // One key per session: a second lock (or a retry) can never post twice.
    const idemKey = `live_${session.id}`;
    const txn = versionOf(ctx, {
      orgId: session.orgId,
      request: body,
      occurredAt: (occurredAt ?? ctx.now()).toISOString(),
      currency,
      splits: split.splits,
      idemKey,
    });
    const at = ctx.now().toISOString();
    const result = await ctx.timings.measure("db", () =>
      repos.ledger.write(
        [txn],
        splitecoAudit(ctx, {
          type: "spliteco.expense.added",
          orgId: session.orgId,
          txnId: txn.id,
          idemKey,
          description: `Expense ${txnPublicId(txn.id)} "${body.title}" for ${formatMinor(body.totalMinor, currency)}, split items (live split ${session.code})`,
          payload: { title: body.title, totalMinor: body.totalMinor, currency, method: "items", subjectIds: txn.splits.map((s) => s.subjectId), live: session.id },
        }),
        {
          audits: [
            liveAudit(ctx, {
              type: "spliteco.live.locked",
              session,
              description: `Live split ${session.code} "${body.title}" locked and posted as ${txnPublicId(txn.id)}`,
              payload: { txnId: txnPublicId(txn.id), totalMinor: body.totalMinor, claims: claims.length },
            }),
          ],
          statements: [liveLockStatement(session.id, txn.id, at)],
        },
      ),
    );
    const outcome = writeOutcome(ctx, result, (t) => t.kind === "expense" && t.createdBy === session.createdBy);
    if (outcome instanceof Response) return outcome;
    const locked = (await repos.live.byId(session.id)) ?? session;
    return answer(ctx, repos, locked, group);
  });
}
