// Settling up (design §2, §0.9, §0.11; SE2):
//
//   POST /v1/spliteco/groups/{org}/settlements        the caller paid someone      spliteco.settlement.recorded
//   POST /v1/spliteco/settlements/{txn}/not-received  the person paid says no     spliteco.settlement.not_received
//   GET  /v1/spliteco/groups/{org}/settle-plan        the plan, balance by balance
//   PUT  /v1/spliteco/groups/{org}/settings           simplify debts on or off
//
// A payment is recorded only when the payer confirms it: the caller is always
// the payer ("I paid"); a UPI payment is the app's deep link first. It is
// stored as settlement rows on the one ledger — one per balance it pays, a
// kitchen group's Kitchen first, then Other (or as the payer splits it), all
// sharing source_kind 'payment' and one source_id — in ONE batch with its
// audit event. It may not be more than the plan says the payer owes the
// payee in each balance. "Not received" reverses every row of it, and only
// the person paid may say it. Neither is ever taken from an assistant.

import {
  SPLITECO_ERROR_REASONS,
  SPLITECO_LIMITS,
  SPLITECO_PAYMENT_METHODS,
  type SplitecoBucket,
  type SplitecoGroupSettingsResponse,
  type SplitecoPayment,
  type SplitecoPaymentMethod,
  type SplitecoSettlePlanResponse,
  type SplitecoSettlementResponse,
} from "@saas/contracts/spliteco";
import { asUuid } from "@saas/db/ids";
import { PAYMENT_SOURCE_KIND, type NewSplitecoTxn, type SplitecoRepository, type SplitecoTxnRecord } from "@saas/db/spliteco";
import { buildSettlement, reverseSplits, settlePlan } from "@saas/kitchen-engine/ledger";
import { formatMinor } from "@saas/kitchen-engine/money";
import { allocatePayment, pairwisePlan, plannedBetween, SETTLE_ORDER, type Allocation } from "@saas/kitchen-engine/settle";
import { requireOrgAction } from "../authz.js";
import type { RequestContext } from "../context.js";
import {
  conflict,
  errorResponse,
  forbidden,
  notFound,
  readJsonObject,
  successResponse,
  unavailable,
  unprocessable,
  validationError,
} from "../http.js";
import { requestIdempotencyKey } from "../idempotency.js";
import { orgPublicId, parseOrgPublicId, parseTxnPublicId, txnPublicId } from "../ids.js";
import { BUCKETS, bucketPlan, bucketRows, bucketedPlan, currencyOf, engineTxns, groupLabel, kitchenView, splitecoAudit, withRepo } from "../ledger.js";
import type { MemberGroup } from "../membership.js";
import { sendPaidYou } from "../notify.js";
import { Fields, minor, oneOf, subjectId, text } from "../validate.js";

/** The grant every SE2 write needs: every group role but viewer (see SPLITECO_ACTIONS). */
export const SETTLE_ACTION = "spliteco.expense.write" as const;

/** Payments are made in an app, never by an assistant (design §0.9): refused even if the edge let one through. */
export function refuseAssistant(ctx: RequestContext): Response | null {
  if (!ctx.actor.delegationId) return null;
  return forbidden(ctx.requestId, "Payments are recorded in the app, never by an assistant", SPLITECO_ERROR_REASONS.NOT_FROM_AN_ASSISTANT);
}

async function myGroup(ctx: RequestContext, orgId: string): Promise<MemberGroup | null | "unavailable"> {
  const mine = await ctx.timings.measure("membership", () => ctx.groups.of(ctx.actor.subjectId));
  if (!mine.ok) return "unavailable";
  return mine.groups.find((g) => g.orgId === orgId) ?? null;
}

/** What `from` owes `to` in each balance, by the group's plan (simplified or not). */
export function owedByBucket(rows: readonly SplitecoTxnRecord[], from: string, to: string, simplify: boolean): Allocation {
  const owed: Allocation = { kitchen: 0, other: 0 };
  for (const bucket of BUCKETS) owed[bucket] = plannedBetween(bucketPlan(rows, bucket, simplify), from, to);
  return owed;
}

/** A payment as the API answers it, from its rows (one per balance it paid). */
export function paymentOf(rows: readonly SplitecoTxnRecord[]): SplitecoPayment | null {
  const first = rows[0];
  if (!first) return null;
  const from = first.splits.find((s) => s.paidMinor > 0)?.subjectId ?? first.createdBy;
  const to = first.splits.find((s) => s.owedMinor > 0)?.subjectId ?? "";
  return {
    id: txnPublicId(first.id),
    groupId: orgPublicId(first.orgId),
    fromSubjectId: from,
    toSubjectId: to,
    amountMinor: rows.reduce((s, t) => s + t.totalMinor, 0),
    currency: first.currency,
    method: (first.method as SplitecoPaymentMethod | null) ?? null,
    note: first.note,
    parts: rows.map((t) => ({ txnId: txnPublicId(t.id), bucket: t.bucket, amountMinor: t.totalMinor })),
    recordedAt: first.createdAt,
    recordedBy: first.createdBy,
    state: rows.every((t) => t.reversedBy !== null) ? "not_received" : "recorded",
  };
}

/** Every row of the payment `t` belongs to (itself alone for a payment Cookpool recorded). */
async function rowsOfPayment(repo: SplitecoRepository, t: SplitecoTxnRecord): Promise<SplitecoTxnRecord[]> {
  if (t.sourceKind !== PAYMENT_SOURCE_KIND || !t.sourceId) return [t];
  const rows = await repo.paymentRows(t.orgId, t.sourceId);
  return rows.length > 0 ? rows : [t];
}

interface ParsedSettlement {
  toSubjectId: string;
  amountMinor: number;
  method: (typeof SPLITECO_PAYMENT_METHODS)[number];
  note: string | null;
  split: Partial<Allocation> | null;
  /** `kitchen`: made in Cookpool (SE3) — pays the Kitchen balance only, never more than it. */
  bucket: "kitchen" | null;
}

function parseSettlement(body: Record<string, unknown>): { ok: true; value: ParsedSettlement } | { ok: false; fields: Fields["errors"] } {
  const fields = new Fields();
  const toSubjectId = subjectId(fields, "toSubjectId", body.toSubjectId);
  const amountMinor = minor(fields, "amountMinor", body.amountMinor, true);
  const method = oneOf(fields, "method", body.method, SPLITECO_PAYMENT_METHODS);
  const note = text(fields, "note", body.note, SPLITECO_LIMITS.note, true);
  let split: Partial<Allocation> | null = null;
  if (body.split !== undefined && body.split !== null) {
    if (typeof body.split !== "object" || Array.isArray(body.split)) {
      fields.add("split", "Must be an object with kitchen and other amounts");
    } else {
      const raw = body.split as Record<string, unknown>;
      split = {};
      for (const bucket of SETTLE_ORDER) {
        if (raw[bucket] === undefined) continue;
        const v = minor(fields, `split.${bucket}`, raw[bucket]);
        if (v !== undefined) split[bucket] = v;
      }
      for (const k of Object.keys(raw)) if (!(SETTLE_ORDER as readonly string[]).includes(k)) fields.add(`split.${k}`, "Must be kitchen or other");
    }
  }
  let bucket: "kitchen" | null = null;
  if (body.bucket !== undefined && body.bucket !== null) {
    if (body.bucket !== "kitchen") fields.add("bucket", "Must be kitchen, or left out");
    else if (split) fields.add("split", "A Kitchen payment pays the Kitchen balance only");
    else bucket = "kitchen";
  }
  if (!fields.ok || toSubjectId === undefined || amountMinor === undefined || !method || note === undefined) {
    return { ok: false, fields: fields.errors };
  }
  return { ok: true, value: { toSubjectId, amountMinor, method, note, split, bucket } };
}

export async function handleCreateSettlement(ctx: RequestContext, request: Request, orgParam: string): Promise<Response> {
  const refused = refuseAssistant(ctx);
  if (refused) return refused;
  const orgId = parseOrgPublicId(orgParam);
  if (!orgId) return notFound(ctx.requestId);
  const denied = await requireOrgAction(ctx, orgId, SETTLE_ACTION);
  if (denied) return denied;
  const group = await myGroup(ctx, orgId);
  if (group === "unavailable") return unavailable(ctx.requestId);
  if (!group) return notFound(ctx.requestId);

  const idem = requestIdempotencyKey(request, ctx.requestId);
  if (!idem.ok) return idem.response;
  const body = await readJsonObject(request);
  if (!body) return validationError(ctx.requestId, { body: ["Must be a JSON object"] });
  const parsed = parseSettlement(body);
  if (!parsed.ok) return validationError(ctx.requestId, parsed.fields);
  const pay = parsed.value;
  const me = ctx.actor.subjectId;
  // Cookpool's payment (SE3) is for a kitchen group's Kitchen balance.
  if (pay.bucket === "kitchen" && group.madeIn !== "cookpool") {
    return validationError(ctx.requestId, { bucket: ["Only a group made in Cookpool has a Kitchen balance"] });
  }
  if (pay.toSubjectId === me) {
    return unprocessable(ctx.requestId, "A payment needs two different people", SPLITECO_ERROR_REASONS.SAME_PERSON);
  }
  if (!group.members.some((m) => m.subjectId === pay.toSubjectId)) {
    return unprocessable(ctx.requestId, "You can pay only someone in the group", SPLITECO_ERROR_REASONS.NOT_IN_GROUP, {
      subjectIds: [pay.toSubjectId],
    });
  }

  return withRepo(ctx, async (repo) => {
    // A retry of a payment that already landed answers what it wrote.
    const replay = await repo.findByIdemKey(orgId, idem.key);
    if (replay) {
      if (replay.kind !== "settlement" || replay.createdBy !== me) {
        return conflict(ctx.requestId, "This Idempotency-Key was already used for a different request", SPLITECO_ERROR_REASONS.IDEMPOTENCY_KEY_REUSED);
      }
      const payment = paymentOf(await rowsOfPayment(repo, replay));
      return payment ? successResponse<SplitecoSettlementResponse>({ payment }, ctx.requestId, 200) : unavailable(ctx.requestId);
    }

    const [rows, currencies, settings] = await ctx.timings.measure("db", () =>
      Promise.all([repo.listTxns([orgId]), repo.currencies([orgId]), repo.groupSettings([orgId])]),
    );
    const currency = currencyOf(currencies, orgId);
    const simplify = settings.get(orgId)?.simplifyDebts ?? true;
    const owed = owedByBucket(rows, me, pay.toSubjectId, simplify);
    // Made in Cookpool (SE3, design §0.11): Kitchen only, never more than it —
    // the same engine rule, with all of it put on Kitchen; Other stays as it is.
    const allocated = pay.bucket === "kitchen"
      ? allocatePayment({ owed: { kitchen: owed.kitchen, other: 0 }, amountMinor: pay.amountMinor, split: { kitchen: pay.amountMinor, other: 0 } })
      : allocatePayment({ owed, amountMinor: pay.amountMinor, split: pay.split });
    if (!allocated.ok) {
      const details = { owed: allocated.owed, owedMinor: allocated.owed.kitchen + allocated.owed.other };
      if (allocated.reason === "nothing_owed") {
        return conflict(ctx.requestId, "You don't owe them anything here", SPLITECO_ERROR_REASONS.NOTHING_OWED, details);
      }
      if (allocated.reason === "split_mismatch") {
        return unprocessable(ctx.requestId, "Kitchen and Other must add up to the amount", SPLITECO_ERROR_REASONS.SPLIT_MISMATCH, details);
      }
      return unprocessable(
        ctx.requestId,
        `That is more than you owe (${formatMinor(details.owedMinor, currency)})`,
        SPLITECO_ERROR_REASONS.OVER_SETTLED,
        details,
      );
    }

    const now = ctx.now().toISOString();
    const paymentId = asUuid(crypto.randomUUID());
    const parts = SETTLE_ORDER.filter((b) => allocated.allocation[b] > 0);
    const txns: NewSplitecoTxn[] = parts.map((bucket, i) => ({
      id: i === 0 ? paymentId : asUuid(crypto.randomUUID()),
      orgId,
      kind: "settlement",
      title: "Payment",
      totalMinor: allocated.allocation[bucket],
      currency,
      occurredAt: now,
      createdBy: me,
      createdAt: now,
      note: pay.note,
      // The first row carries the request's key (a retry finds it); the rest, the key and their bucket.
      idemKey: i === 0 ? idem.key : `${idem.key}:${bucket}`,
      // Made in Cookpool's Money tab (SE3): Cookpool's row, on the Kitchen balance.
      app: pay.bucket === "kitchen" ? "cookpool" : "spliteco",
      bucket,
      category: null,
      method: pay.method,
      sourceKind: PAYMENT_SOURCE_KIND,
      sourceId: paymentId,
      splits: buildSettlement({ fromId: me, toId: pay.toSubjectId, amountMinor: allocated.allocation[bucket] }),
    }));
    const result = await ctx.timings.measure("db", () =>
      repo.write(
        txns,
        splitecoAudit(ctx, {
          type: "spliteco.settlement.recorded",
          orgId,
          txnId: paymentId,
          idemKey: idem.key,
          description: `Payment ${txnPublicId(paymentId)}: ${me} paid ${pay.toSubjectId} ${formatMinor(pay.amountMinor, currency)} by ${pay.method}`,
          payload: {
            fromSubjectId: me,
            toSubjectId: pay.toSubjectId,
            amountMinor: pay.amountMinor,
            currency,
            method: pay.method,
            parts: txns.map((t) => ({ txnId: txnPublicId(t.id), bucket: t.bucket, amountMinor: t.totalMinor })),
          },
        }),
      ),
    );
    if (!result.ok) {
      if (result.error.kind === "currency_mismatch") {
        return unprocessable(ctx.requestId, `The group's ledger counts in ${result.error.currency ?? "another currency"}`, SPLITECO_ERROR_REASONS.CURRENCY_MISMATCH);
      }
      if (result.error.kind === "invalid") {
        return errorResponse("internal_error", "The payment did not add up", 500, ctx.requestId, { reason: result.error.reason });
      }
      return unavailable(ctx.requestId);
    }
    const stored = result.replayed ? await rowsOfPayment(repo, result.existing) : await repo.paymentRows(orgId, paymentId);
    const payment = paymentOf(stored);
    if (!payment) return unavailable(ctx.requestId);
    if (!result.replayed) {
      await ctx.defer(() =>
        sendPaidYou(ctx, {
          paymentTxnPublicId: payment.id,
          orgPublicId: payment.groupId,
          groupName: groupLabel(group),
          payer: me,
          payee: pay.toSubjectId,
          amount: formatMinor(payment.amountMinor, currency),
          method: pay.method,
        }),
      );
    }
    return successResponse<SplitecoSettlementResponse>({ payment }, ctx.requestId, result.replayed ? 200 : 201);
  });
}

export async function handleNotReceived(ctx: RequestContext, request: Request, txnParam: string): Promise<Response> {
  const refused = refuseAssistant(ctx);
  if (refused) return refused;
  const id = parseTxnPublicId(txnParam);
  if (!id) return notFound(ctx.requestId);
  const idem = requestIdempotencyKey(request, ctx.requestId);
  if (!idem.ok) return idem.response;
  return withRepo(ctx, async (repo) => {
    const txn = await repo.getTxn(id);
    if (!txn) return notFound(ctx.requestId);
    const denied = await requireOrgAction(ctx, asUuid(txn.orgId), SETTLE_ACTION);
    if (denied) return denied;
    if (txn.kind !== "settlement") {
      return conflict(ctx.requestId, "Only a payment can be marked not received", SPLITECO_ERROR_REASONS.NOT_A_SETTLEMENT);
    }
    const payee = txn.splits.find((s) => s.owedMinor > 0)?.subjectId;
    if (payee !== ctx.actor.subjectId) {
      return forbidden(ctx.requestId, "Only the person paid can say it was not received", SPLITECO_ERROR_REASONS.NOT_THE_PAYEE);
    }
    const rows = await rowsOfPayment(repo, txn);
    // A retry of a not-received that already landed answers what it did.
    const replay = await repo.findByIdemKey(txn.orgId, idem.key);
    if (replay) {
      if (replay.kind === "reversal" && rows.some((r) => r.id === replay.reverses)) {
        const payment = paymentOf(await rowsOfPayment(repo, txn));
        return payment ? successResponse<SplitecoSettlementResponse>({ payment }, ctx.requestId, 200) : unavailable(ctx.requestId);
      }
      return conflict(ctx.requestId, "This Idempotency-Key was already used for a different request", SPLITECO_ERROR_REASONS.IDEMPOTENCY_KEY_REUSED);
    }
    const open = rows.filter((r) => r.reversedBy === null);
    if (open.length === 0) {
      return conflict(ctx.requestId, "This payment was already marked not received", SPLITECO_ERROR_REASONS.ALREADY_REVERSED);
    }
    const now = ctx.now().toISOString();
    const markedBy = ctx.actor.subjectId;
    const reversals: NewSplitecoTxn[] = open.map((r, i) => ({
      id: asUuid(crypto.randomUUID()),
      orgId: r.orgId,
      kind: "reversal",
      title: "Not received",
      totalMinor: r.totalMinor,
      currency: r.currency,
      occurredAt: now,
      // kitchen_txns.created_by holds the actor's public id (`usr_…`), as kitchen-worker stores it.
      createdBy: markedBy,
      createdAt: now,
      note: null,
      idemKey: i === 0 ? idem.key : `${idem.key}:${r.bucket}:${i}`,
      app: "spliteco",
      bucket: r.bucket,
      category: null,
      reverses: r.id,
      splits: reverseSplits(r.splits),
    }));
    const before = paymentOf(rows)!;
    const result = await ctx.timings.measure("db", () =>
      repo.write(
        reversals,
        splitecoAudit(ctx, {
          type: "spliteco.settlement.not_received",
          orgId: txn.orgId,
          txnId: rows[0]!.id,
          idemKey: idem.key,
          description: `Payment ${before.id} of ${formatMinor(before.amountMinor, before.currency)} from ${before.fromSubjectId} marked not received`,
          payload: {
            fromSubjectId: before.fromSubjectId,
            toSubjectId: before.toSubjectId,
            amountMinor: before.amountMinor,
            currency: before.currency,
            reversals: reversals.map((r) => txnPublicId(r.id)),
          },
        }),
      ),
    );
    if (!result.ok) {
      if (result.error.kind === "conflict") {
        return conflict(ctx.requestId, "This payment was already marked not received", SPLITECO_ERROR_REASONS.ALREADY_REVERSED);
      }
      return unavailable(ctx.requestId);
    }
    const payment = paymentOf(await rowsOfPayment(repo, txn));
    return payment ? successResponse<SplitecoSettlementResponse>({ payment }, ctx.requestId, result.replayed ? 200 : 201) : unavailable(ctx.requestId);
  });
}

export async function handleSettlePlan(ctx: RequestContext, orgParam: string, url?: URL): Promise<Response> {
  const orgId = parseOrgPublicId(orgParam);
  if (!orgId) return notFound(ctx.requestId);
  const denied = await requireOrgAction(ctx, orgId, "spliteco.ledger.read");
  if (denied) return denied;
  const group = await myGroup(ctx, orgId);
  if (group === "unavailable") return unavailable(ctx.requestId);
  if (!group) return notFound(ctx.requestId);
  // Cookpool's view (SE3): the Kitchen balance only; never a Spliteco group.
  const kitchen = kitchenView(url);
  if (kitchen && group.madeIn !== "cookpool") return notFound(ctx.requestId);
  return withRepo(ctx, async (repo) => {
    const [all, currencies, settings] = await ctx.timings.measure("db", () =>
      Promise.all([repo.listTxns([orgId]), repo.currencies([orgId]), repo.groupSettings([orgId])]),
    );
    const rows = kitchen ? bucketRows(all, "kitchen") : all;
    const me = ctx.actor.subjectId;
    const simplify = settings.get(orgId)?.simplifyDebts ?? true;
    const buckets: SplitecoBucket[] = kitchen ? ["kitchen"] : group.madeIn === "cookpool" ? [...BUCKETS] : ["other"];
    const others = new Set<string>();
    const out: SplitecoSettlePlanResponse["buckets"] = buckets.map((bucket) => {
      const txns = engineTxns(bucketRows(rows, bucket));
      const payments = simplify ? settlePlan(txns).payments : pairwisePlan(txns);
      for (const p of payments) if (p.fromId === me) others.add(p.toId);
      return {
        bucket,
        payments: payments.map((p) => ({ fromSubjectId: p.fromId, toSubjectId: p.toId, amountMinor: p.amountMinor })),
        pairs: pairwisePlan(txns).length,
      };
    });
    return successResponse<SplitecoSettlePlanResponse>(
      {
        groupId: orgPublicId(orgId),
        currency: currencyOf(currencies, orgId),
        simplifyDebts: simplify,
        buckets: out,
        plan: bucketedPlan(rows, simplify).map((p) => ({ fromSubjectId: p.fromId, toSubjectId: p.toId, amountMinor: p.amountMinor })),
        mine: [...others].sort().map((toSubjectId) => ({ toSubjectId, owed: owedByBucket(rows, me, toSubjectId, simplify) })),
      },
      ctx.requestId,
    );
  });
}

export async function handleGroupSettings(ctx: RequestContext, request: Request, orgParam: string): Promise<Response> {
  const orgId = parseOrgPublicId(orgParam);
  if (!orgId) return notFound(ctx.requestId);
  const denied = await requireOrgAction(ctx, orgId, SETTLE_ACTION);
  if (denied) return denied;
  const body = await readJsonObject(request);
  if (!body) return validationError(ctx.requestId, { body: ["Must be a JSON object"] });
  if (typeof body.simplifyDebts !== "boolean") return validationError(ctx.requestId, { simplifyDebts: ["Must be true or false"] });
  const simplifyDebts = body.simplifyDebts;
  return withRepo(ctx, async (repo) => {
    await repo.setGroupSettings({ orgId, simplifyDebts }, ctx.actor.subjectId, ctx.now().toISOString());
    return successResponse<SplitecoGroupSettingsResponse>({ settings: { simplifyDebts } }, ctx.requestId);
  });
}
