// What Spliteco sends (SE2), through notifications-worker's enqueue route over
// the NOTIFICATIONS_WORKER binding with the baseline's client
// (`@saas/notifications-client`), as kitchen-worker's emails do:
//
//   spliteco.reminder   a nudge to someone who owes you — once per reminder
//   spliteco.paid_you   a payment recorded to you — once per payment
//   spliteco.expense_for_you  an expense you're on was added, edited, deleted,
//                       restored or moved — to everyone on it but whoever did
//                       it, saying "<name> via Claude" when their assistant did (SE5)
//
// notifications-worker renders the template, checks suppression and the
// person's preferences (email is on unless they turned it off; push goes to a
// person who turned the kind on), records the send and collapses a repeated
// idempotency key into the first send. Each call runs after the write has
// committed (`ctx.defer`) and never throws.

import { KITCHEN_EMAIL_CATEGORY } from "@saas/contracts/kitchen";
import { formatMinor } from "@saas/kitchen-engine/money";
import {
  SPLITECO_EMAILS,
  type SplitecoExpenseChange,
  type SplitecoExpenseForYouEmail,
  type SplitecoEmail,
  type SplitecoPaidYouEmail,
  type SplitecoPaymentMethod,
  type SplitecoReminderEmail,
} from "@saas/contracts/spliteco";
import { buildIdempotencyKey, enqueueNotification, type EnqueueNotificationResult } from "@saas/notifications-client";
import type { RequestContext } from "./context.js";
import { displayNameOf } from "./identity-client.js";

/** How a payment was made, as the notification says it. */
export const PAYMENT_WORDS: Record<SplitecoPaymentMethod, string | null> = {
  upi: "UPI",
  cash: "Cash",
  bank: "Bank transfer",
  other: null,
};

/** An absolute link into the Spliteco app (APP_URL), or the path alone when it is not set. */
export function appLink(env: RequestContext["env"], path: string): string {
  const base = (env.APP_URL ?? "").replace(/\/+$/, "");
  return /^https?:\/\//.test(base) ? `${base}${path}` : path;
}

function keyFor(template: SplitecoEmail, about: string, to: string): string | null {
  try {
    return buildIdempotencyKey(template, about, to);
  } catch {
    return null;
  }
}

/** Ask notifications-worker to send one message to `to`. Null when they have no address. */
async function send(
  ctx: RequestContext,
  input: {
    orgPublicId: string;
    template: SplitecoEmail;
    data: SplitecoReminderEmail | SplitecoPaidYouEmail | SplitecoExpenseForYouEmail;
    to: string;
    about: string;
  },
): Promise<EnqueueNotificationResult | null> {
  const idempotencyKey = keyFor(input.template, input.about, input.to);
  if (!idempotencyKey) return null;
  const user = (await ctx.people.users([input.to])).get(input.to);
  if (!user || !user.email.trim()) return null;
  return enqueueNotification(
    ctx.env,
    {
      internalActor: "spliteco-worker",
      actorSubjectType: ctx.actor.subjectType,
      actorSubjectId: ctx.actor.subjectId,
      requestId: ctx.requestId,
    },
    {
      orgId: input.orgPublicId,
      category: KITCHEN_EMAIL_CATEGORY,
      templateKey: input.template,
      templateData: input.data,
      recipient: { channel: "email", address: user.email.trim().toLowerCase(), subjectKind: "user", subjectId: user.subjectId },
      idempotencyKey,
      correlationId: ctx.requestId,
    },
  );
}

async function nameOf(ctx: RequestContext, subjectId: string): Promise<string | null> {
  const user = (await ctx.people.users([subjectId])).get(subjectId);
  return user ? displayNameOf(user) : null;
}

/** `spliteco.reminder`: "Anu sent a friendly nudge: ₹620.00 for Goa Trip". */
export async function sendReminder(
  ctx: RequestContext,
  input: { reminderId: string; orgPublicId: string; groupName: string; to: string; amount: string },
): Promise<boolean> {
  const data: SplitecoReminderEmail = {
    fromName: await nameOf(ctx, ctx.actor.subjectId),
    amount: input.amount,
    groupName: input.groupName,
    payUrl: appLink(ctx.env, `/settle?group=${encodeURIComponent(input.orgPublicId)}&to=${encodeURIComponent(ctx.actor.subjectId)}`),
  };
  const result = await send(ctx, { orgPublicId: input.orgPublicId, template: SPLITECO_EMAILS.REMINDER, data, to: input.to, about: input.reminderId });
  return result?.ok === true;
}

/** `spliteco.paid_you`: "Dev paid you ₹400.00 · UPI", to the person paid. */
export async function sendPaidYou(
  ctx: RequestContext,
  input: { paymentTxnPublicId: string; orgPublicId: string; groupName: string; payer: string; payee: string; amount: string; method: SplitecoPaymentMethod | null },
): Promise<boolean> {
  if (input.payer === input.payee) return false;
  const data: SplitecoPaidYouEmail = {
    payerName: await nameOf(ctx, input.payer),
    amount: input.amount,
    method: input.method ? PAYMENT_WORDS[input.method] : null,
    groupName: input.groupName,
    personUrl: appLink(ctx.env, `/friend?id=${encodeURIComponent(input.payer)}`),
  };
  const result = await send(ctx, {
    orgPublicId: input.orgPublicId,
    template: SPLITECO_EMAILS.PAID_YOU,
    data,
    to: input.payee,
    about: input.paymentTxnPublicId,
  });
  return result?.ok === true;
}

/** Who changed it, as the notification says it: "Anu", or "Anu via Claude" when their assistant did. */
export async function changedBy(ctx: RequestContext): Promise<string | null> {
  const name = await nameOf(ctx, ctx.actor.subjectId);
  if (!ctx.actor.delegationId) return name;
  return `${name ?? "Someone"} via ${ctx.actor.clientName ?? "an assistant"}`;
}

export interface ExpenseChangeNotice {
  change: SplitecoExpenseChange;
  /** The row this change wrote (`txn_…`): the idempotency key's subject. */
  aboutTxnPublicId: string;
  /** The expense as it reads now (`txn_…`): where the link goes. */
  expensePublicId: string;
  /** Who posted it: only Spliteco's own rows are told about (Cookpool posts its own). */
  app: "cookpool" | "spliteco";
  orgPublicId: string;
  groupName: string;
  fromGroupName?: string | null;
  title: string;
  totalMinor: number;
  currency: string;
  /** Everyone on it before the change (an edit's old version), each with their share. */
  before: readonly { subjectId: string; owedMinor: number }[];
  /** Everyone on it after (empty for a delete). */
  after: readonly { subjectId: string; owedMinor: number }[];
}

/**
 * `spliteco.expense_for_you` to everyone on the expense, before or after the
 * change, except whoever made it. Run after the write has committed (through
 * `ctx.defer`); a failed send fails nothing. Answers how many were taken.
 */
export async function sendExpenseForYou(ctx: RequestContext, notice: ExpenseChangeNotice): Promise<number> {
  if (notice.app !== "spliteco") return 0;
  const shares = new Map(notice.after.map((s) => [s.subjectId, s.owedMinor]));
  const people = [...new Set([...notice.before, ...notice.after].map((s) => s.subjectId))].filter((id) => id !== ctx.actor.subjectId);
  if (people.length === 0) return 0;
  const actorName = await changedBy(ctx);
  let taken = 0;
  for (const to of people) {
    const share = shares.get(to);
    const data: SplitecoExpenseForYouEmail = {
      actorName,
      change: notice.change,
      title: notice.title,
      amount: formatMinor(notice.totalMinor, notice.currency),
      groupName: notice.groupName,
      fromGroupName: notice.fromGroupName ?? null,
      yourShare: notice.change === "deleted" || share === undefined ? null : formatMinor(share, notice.currency),
      expenseUrl: appLink(ctx.env, `/expense?id=${encodeURIComponent(notice.expensePublicId)}`),
    };
    try {
      const result = await send(ctx, { orgPublicId: notice.orgPublicId, template: SPLITECO_EMAILS.EXPENSE_FOR_YOU, data, to, about: notice.aboutTxnPublicId });
      if (result?.ok === true) taken += 1;
    } catch {
      /* one person's send never stops the others' */
    }
  }
  return taken;
}

