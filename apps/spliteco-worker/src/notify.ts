// What Spliteco sends (SE2), through notifications-worker's enqueue route over
// the NOTIFICATIONS_WORKER binding with the baseline's client
// (`@saas/notifications-client`), as kitchen-worker's emails do:
//
//   spliteco.reminder   a nudge to someone who owes you — once per reminder
//   spliteco.paid_you   a payment recorded to you — once per payment
//
// notifications-worker renders the template, checks suppression and the
// person's preferences (email is on unless they turned it off; push goes to a
// person who turned the kind on), records the send and collapses a repeated
// idempotency key into the first send. Each call runs after the write has
// committed (`ctx.defer`) and never throws.

import { KITCHEN_EMAIL_CATEGORY } from "@saas/contracts/kitchen";
import {
  SPLITECO_EMAILS,
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
  input: { orgPublicId: string; template: SplitecoEmail; data: SplitecoReminderEmail | SplitecoPaidYouEmail; to: string; about: string },
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
