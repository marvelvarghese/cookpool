// What every Spliteco handler shares: the repositories over the request's D1
// binding, how a ledger row reads on the wire, which rows are current, the
// balances (the same engine functions kitchen-worker uses, over the same
// rows, so a group's balances match Cookpool's to the paisa), and the audit
// event a money write carries in its own batch.

import { TRIPECO_SOURCE_KIND } from "@saas/contracts/tripeco";
import { DEFAULT_KITCHEN_CURRENCY } from "@saas/contracts/kitchen";
import type {
  SplitecoCategory,
  SplitecoExpenseRequest,
  SplitecoExpenseSummary,
  SplitecoPaymentMethod,
  SplitecoSplitMethod,
  SplitecoTxnKind,
} from "@saas/contracts/spliteco";
import { createSqlExecutor } from "@saas/db/d1";
import type { AppendEventWithAuditInput } from "@saas/db/events";
import { createSplitecoRepository, type SplitecoRepository, type SplitecoTxnRecord } from "@saas/db/spliteco";
import { balances, type Txn } from "@saas/kitchen-engine/ledger";
import { planFor } from "@saas/kitchen-engine/settle";
import type { RequestContext } from "./context.js";
import { unavailable } from "./http.js";
import { orgPublicId, txnPublicId } from "./ids.js";

/** Run `fn` with the Spliteco repository; a missing binding or a throw is a 503. */
export async function withRepo(
  ctx: Pick<RequestContext, "env" | "requestId">,
  fn: (repo: SplitecoRepository) => Promise<Response>,
): Promise<Response> {
  if (!ctx.env.PLATFORM_DB) return unavailable(ctx.requestId);
  const executor = createSqlExecutor(ctx.env.PLATFORM_DB);
  try {
    return await fn(createSplitecoRepository(executor));
  } catch {
    return unavailable(ctx.requestId);
  } finally {
    await executor.dispose();
  }
}

/** A row still in effect: not a reversal, and not reversed. */
export function isCurrent(t: SplitecoTxnRecord): boolean {
  return t.kind !== "reversal" && t.reversedBy === null;
}

/** The request a Spliteco expense was saved from. */
export function inputOf(t: SplitecoTxnRecord): SplitecoExpenseRequest | null {
  if (!t.splitSpec) return null;
  try {
    return JSON.parse(t.splitSpec) as SplitecoExpenseRequest;
  } catch {
    return null;
  }
}

export function methodOf(t: SplitecoTxnRecord): SplitecoSplitMethod | null {
  return inputOf(t)?.split.method ?? null;
}

/** Spliteco edits only its own expenses. */
export function isLocked(t: SplitecoTxnRecord): boolean {
  return t.app !== "spliteco" || t.kind !== "expense" || t.sourceKind === TRIPECO_SOURCE_KIND;
}

/** Another app's source: a Tripeco ride (tripeco TR-3). */
export function sourceOf(t: SplitecoTxnRecord): { kind: "tripeco"; id: string } | null {
  return t.sourceKind === TRIPECO_SOURCE_KIND && t.sourceId ? { kind: "tripeco", id: t.sourceId } : null;
}

/** The name a group reads as. The hidden two-person group is "Outside groups". */
export function groupLabel(group: { name: string; kind: string } | undefined): string {
  if (!group) return "A group";
  return group.kind === "direct" ? "Outside groups" : group.name;
}

/** The name an assistant's change reads as ("Claude"); "an assistant" for rows before its name was kept; null for a person's own. */
export function assistantOf(t: Pick<SplitecoTxnRecord, "viaDelegation" | "viaClient">): string | null {
  if (!t.viaDelegation) return null;
  return t.viaClient ?? "an assistant";
}

export function toSummary(t: SplitecoTxnRecord, groupName: string, me: string): SplitecoExpenseSummary {
  const mine = t.splits.find((s) => s.subjectId === me);
  return {
    id: txnPublicId(t.id),
    groupId: orgPublicId(t.orgId),
    groupName,
    kind: (t.kind === "reversal" ? "expense" : t.kind) as SplitecoTxnKind,
    app: t.app,
    bucket: t.bucket,
    title: t.title,
    category: (t.category as SplitecoCategory | null) ?? null,
    method: methodOf(t),
    totalMinor: t.totalMinor,
    currency: t.currency,
    occurredAt: t.occurredAt,
    createdAt: t.createdAt,
    createdBy: t.createdBy,
    payers: t.splits.filter((s) => s.paidMinor > 0).map((s) => ({ subjectId: s.subjectId, paidMinor: s.paidMinor })),
    splits: t.splits.map((s) => ({ subjectId: s.subjectId, paidMinor: s.paidMinor, owedMinor: s.owedMinor })),
    myNetMinor: mine ? mine.paidMinor - mine.owedMinor : 0,
    locked: isLocked(t),
    viaDelegation: t.viaDelegation,
    viaAssistant: assistantOf(t),
    paymentMethod: t.kind === "settlement" ? ((t.method as SplitecoPaymentMethod | null) ?? null) : null,
    source: sourceOf(t),
  };
}

/** Stored rows as the money engine reads them (every row, reversals included, as kitchen-worker passes them). */
export function engineTxns(rows: readonly SplitecoTxnRecord[]): Txn[] {
  return rows.map((t) => ({
    id: t.id,
    kind: t.kind,
    title: t.title,
    totalMinor: t.totalMinor,
    occurredAt: t.occurredAt,
    reverses: t.reverses,
    splits: t.splits,
  }));
}

/** Rows grouped by group id, oldest first within each. */
export function byGroup(rows: readonly SplitecoTxnRecord[]): Map<string, SplitecoTxnRecord[]> {
  const out = new Map<string, SplitecoTxnRecord[]>();
  for (const t of rows) {
    const list = out.get(t.orgId) ?? [];
    list.push(t);
    out.set(t.orgId, list);
  }
  return out;
}

/** Each person's balance in one group (Σ paid − Σ owed). */
export function groupBalances(rows: readonly SplitecoTxnRecord[]): Map<string, number> {
  return balances(engineTxns(rows));
}

/** The settle plan's payments that involve `me`: + they pay me, − I pay them, largest first (within each bucket, summed). */
export function myPlan(rows: readonly SplitecoTxnRecord[], me: string, simplify = true): { subjectId: string; amountMinor: number }[] {
  const out: { subjectId: string; amountMinor: number }[] = [];
  for (const p of bucketedPlan(rows, simplify)) {
    if (p.toId === me) out.push({ subjectId: p.fromId, amountMinor: p.amountMinor });
    else if (p.fromId === me) out.push({ subjectId: p.toId, amountMinor: -p.amountMinor });
  }
  return out.sort((a, b) => Math.abs(b.amountMinor) - Math.abs(a.amountMinor));
}

export const BUCKETS = ["kitchen", "other"] as const;

/** One bucket's rows (design §0.11: every kitchen group keeps a Kitchen and an Other balance). */
export function bucketRows(rows: readonly SplitecoTxnRecord[], bucket: (typeof BUCKETS)[number]): SplitecoTxnRecord[] {
  return rows.filter((t) => t.bucket === bucket);
}

/** One bucket's plan: the fewest payments when the group simplifies debts, else pair by pair (SE2). */
export function bucketPlan(rows: readonly SplitecoTxnRecord[], bucket: (typeof BUCKETS)[number], simplify = true) {
  return planFor(engineTxns(bucketRows(rows, bucket)), simplify);
}

/**
 * The plan worked out within each bucket (simplify runs within each balance),
 * then summed per pair: the fewest payments, or with `simplify` off, each
 * pair's own net.
 */
export function bucketedPlan(rows: readonly SplitecoTxnRecord[], simplify = true): { fromId: string; toId: string; amountMinor: number }[] {
  const net = new Map<string, number>();
  for (const bucket of BUCKETS) {
    for (const p of bucketPlan(rows, bucket, simplify)) {
      const [lo, hi, sign] = p.fromId < p.toId ? [p.fromId, p.toId, 1] : [p.toId, p.fromId, -1];
      const key = `${lo}\u0000${hi}`;
      net.set(key, (net.get(key) ?? 0) + sign * p.amountMinor);
    }
  }
  const out: { fromId: string; toId: string; amountMinor: number }[] = [];
  for (const [key, amount] of net) {
    if (amount === 0) continue;
    const [lo, hi] = key.split("\u0000") as [string, string];
    out.push(amount > 0 ? { fromId: lo, toId: hi, amountMinor: amount } : { fromId: hi, toId: lo, amountMinor: -amount });
  }
  return out.sort((a, b) => b.amountMinor - a.amountMinor || (a.fromId < b.fromId ? -1 : 1));
}

export function currencyOf(currencies: Map<string, string>, orgId: string): string {
  return currencies.get(orgId) ?? DEFAULT_KITCHEN_CURRENCY;
}

function eventId(): string {
  return crypto.randomUUID().replace(/-/g, "");
}

/** `spliteco.expense.added|edited|deleted|restored|moved`, written in the same batch as its rows. */
export function splitecoAudit(
  ctx: RequestContext,
  input: { type: string; orgId: string; txnId: string; idemKey: string; description: string; payload: Record<string, unknown> },
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
      orgId: input.orgId,
      subjectKind: "kitchen_txn",
      subjectId: input.txnId,
      requestId: ctx.requestId,
      idempotencyKey: input.idemKey,
      payload: { orgId: orgPublicId(input.orgId), txnId: txnPublicId(input.txnId), ...input.payload },
    },
    audit: { id: eventId(), category: "spliteco", description: input.description },
  };
}

/** Everyone a set of rows names. */
export function peopleOn(rows: readonly SplitecoTxnRecord[]): string[] {
  const out = new Set<string>();
  for (const t of rows) {
    out.add(t.createdBy);
    for (const s of t.splits) out.add(s.subjectId);
  }
  return [...out];
}

/**
 * Cookpool's view of a kitchen group (SE3, design §0.11): `?bucket=kitchen`
 * on a read, as Cookpool's Money tab sends it. The read then counts only the
 * Kitchen balance's rows; Other is never sent to Cookpool, and a group made
 * in Spliteco reads as not found there.
 */
export function kitchenView(url: URL | undefined): boolean {
  return url?.searchParams.get("bucket") === "kitchen";
}
