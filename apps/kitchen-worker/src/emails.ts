// Cookpool's emails (CP-18), as kitchen-worker asks for them.
//
// Every email goes through notifications-worker's enqueue route over the
// NOTIFICATIONS_WORKER binding, with the baseline's own client
// (`@saas/notifications-client`): notifications-worker renders the template,
// checks suppression and the person's preferences, records the send and
// collapses a repeated idempotency key into the first send. The calls here
// are best-effort and run only after the write that causes them has
// committed (`ctx.defer`): the client never throws, and an email that cannot
// be sent never fails or holds up the request.
//
//   kitchen.use_soon        the daily digest (sweep.ts), once per person per day
//   kitchen.dish_posted     a dish shared with a group for claims: the group's
//                           members who can claim, not the cook — once per dish
//   kitchen.logged_for_you  a use or an expense logged by someone else: each
//                           person it charges or credits, not whoever logged it
//                           — once per transaction
//   kitchen.portion_set     a portion of an open dish someone else set for you
//                           (SM-6) — once per dish and person
//   kitchen.paid_you        a payment recorded to you, by the payer or an
//                           owner or admin, never by you (PW-5) — once per
//                           payment
//
// The portion, the dish and the payment also go out as Web Push to a person
// who turned that kind on: notifications-worker sends it with the email's
// enqueue, under the same key (PW-5) — nothing more to ask for here.
//
// Each email is sent to one person, tagged with their subject id so their
// preferences apply, under the `product` category, and keyed
// `<template>:<what it is about>:<who>` — the key must name the recipient,
// because notifications-worker keeps a key once per organization.

import type { UserSummary } from "@saas/contracts/auth";
import {
  KITCHEN_EMAILS,
  KITCHEN_EMAIL_CATEGORY,
  type DishPostedEmail,
  type KitchenEmail,
  type KitchenEmailData,
  type LoggedForYouEmail,
  type PaidYouEmail,
  type PortionSetEmail,
  type SettlementMethod,
} from "@saas/contracts/kitchen";
import type { Uuid } from "@saas/db/ids";
import type { KitchenDishRecord, KitchenItemRecord, KitchenStockMoveRecord, KitchenTxnRecord } from "@saas/db/kitchen";
import { formatMinor } from "@saas/kitchen-engine/money";
import { formatQuantity } from "@saas/kitchen-engine/units";
import {
  buildIdempotencyKey,
  enqueueNotification,
  type EnqueueNotificationResult,
} from "@saas/notifications-client";
import type { ActorContext, RequestContext } from "./context.js";
import type { Env } from "./env.js";
import type { MemberGroup } from "./groups-client.js";
import { displayNameOf } from "./identity-client.js";
import { toPublicId } from "./ids.js";
import { inSplitOrder, splitDish } from "./split.js";

/**
 * The organization an email that belongs to no one group is sent under:
 * notifications-worker's system organization, as identity-worker's sign-in
 * emails are. The digest crosses a person's pantries, so it is sent here, and
 * the person's preferences under it are what stop it.
 */
export const SYSTEM_ORG_ID = "00000000-0000-0000-0000-000000000000";

/**
 * The group roles whose grant holds `kitchen.dish.claim` (design.md §6): every
 * role but viewer. A dish posted for claims is emailed to them, not to
 * viewers, who cannot claim. tests/kitchen-worker pins it against the engine.
 */
export const CLAIM_ROLES: ReadonlySet<string> = new Set(["owner", "admin", "builder"]);

/** Who asked for an email: forwarded as the enqueue's actor, for its audit events. */
export interface EmailOrigin {
  requestId: string;
  actor: ActorContext;
}

/** One email for one person. */
export interface KitchenMail {
  /** The group it is about (`org_…`), or SYSTEM_ORG_ID. */
  orgId: string;
  templateKey: KitchenEmail;
  templateData: KitchenEmailData;
  to: UserSummary;
  idempotencyKey: string;
}

/** Ask notifications-worker to send one email. Never throws. */
export function sendKitchenMail(env: Env, origin: EmailOrigin, mail: KitchenMail): Promise<EnqueueNotificationResult> {
  return enqueueNotification(
    env,
    {
      internalActor: "kitchen-worker",
      actorSubjectType: origin.actor.subjectType,
      actorSubjectId: origin.actor.subjectId,
      requestId: origin.requestId,
    },
    {
      orgId: mail.orgId,
      category: KITCHEN_EMAIL_CATEGORY,
      templateKey: mail.templateKey,
      templateData: mail.templateData,
      recipient: {
        channel: "email",
        address: mail.to.email.trim().toLowerCase(),
        subjectKind: "user",
        subjectId: mail.to.subjectId,
      },
      idempotencyKey: mail.idempotencyKey,
      correlationId: origin.requestId,
    },
  );
}

/** Send several, a few at a time (each is one service-binding call). Counts what was accepted. */
export async function sendAll(
  env: Env,
  origin: EmailOrigin,
  mails: readonly KitchenMail[],
  concurrency = 4,
): Promise<{ sent: number; failed: number }> {
  let next = 0;
  let sent = 0;
  let failed = 0;
  async function worker(): Promise<void> {
    while (next < mails.length) {
      const mail = mails[next++]!;
      const result = await sendKitchenMail(env, origin, mail);
      if (result.ok) sent += 1;
      else failed += 1;
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, mails.length) }, worker));
  return { sent, failed };
}

/**
 * An absolute link into the app: `APP_URL` + `path`. Empty when APP_URL is
 * not an http(s) origin — the templates then leave the link out rather than
 * send a broken one.
 */
export function appLink(env: Pick<Env, "APP_URL">, path: string): string {
  const base = env.APP_URL?.trim();
  if (!base) return "";
  try {
    const url = new URL(path, base.endsWith("/") ? base : `${base}/`);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : "";
  } catch {
    return "";
  }
}

/** An enqueue's idempotency key, or null for an id no key can carry (never a `usr_…`, `dsh_…` or `txn_…` id). */
export function mailKey(template: KitchenEmail, ...parts: string[]): string | null {
  try {
    return buildIdempotencyKey(template, ...parts);
  } catch {
    return null;
  }
}

/** Half portions as people say them: 1 → "½", 4 → "2", 5 → "2½". */
export function formatPortions(portionsHalf: number): string {
  const whole = Math.floor(portionsHalf / 2);
  const half = portionsHalf % 2 === 1;
  if (whole === 0) return half ? "½" : "0";
  return half ? `${whole}½` : String(whole);
}

/** The group a write was in, from the actor's own groups (fetched once per request). */
async function groupOf(ctx: RequestContext, orgId: string): Promise<MemberGroup | null> {
  const mine = await ctx.groups.of(ctx.actor.subjectId);
  return mine.ok ? (mine.groups.find((g) => g.orgId === orgId) ?? null) : null;
}

/**
 * `kitchen.dish_posted`: a dish shared with a group for claims, just cooked.
 * Emailed to the group's members who can claim it, but not the cook; once
 * per dish and person (`kitchen.dish_posted:<dsh>:<usr>`), so a retried cook
 * request sends nothing more. A dish just for its cook, an assigned dish, or
 * one no longer open sends nothing.
 */
export async function emailDishPosted(ctx: RequestContext, dish: KitchenDishRecord): Promise<void> {
  if (!dish.orgId || dish.splitMode !== "claims" || dish.state !== "open") return;
  const orgId = dish.orgId;
  const roster = await ctx.roster.members(orgId as Uuid);
  if (!roster.ok) return;
  const recipients = roster.members
    .filter((m) => m.subjectId !== dish.cook && m.role !== null && CLAIM_ROLES.has(m.role))
    .map((m) => m.subjectId);
  if (recipients.length === 0) return;

  const [group, people] = await Promise.all([groupOf(ctx, orgId), ctx.people.users([dish.cook, ...recipients])]);
  const cook = people.get(dish.cook);
  const dishId = toPublicId("dsh", dish.id);
  const data: DishPostedEmail = {
    cookName: cook ? displayNameOf(cook) : null,
    dishName: dish.name,
    groupName: group?.name ?? "your group",
    portions: formatPortions(dish.portionsHalf),
    total: formatMinor(dish.totalMinor, dish.currency),
    dishUrl: appLink(ctx.env, `/dishes/${dishId}`),
  };
  const mails: KitchenMail[] = [];
  for (const subjectId of recipients) {
    const to = people.get(subjectId);
    const idempotencyKey = mailKey(KITCHEN_EMAILS.DISH_POSTED, dishId, subjectId);
    if (!to || !to.email.trim() || !idempotencyKey) continue;
    mails.push({ orgId: toPublicId("org", orgId), templateKey: KITCHEN_EMAILS.DISH_POSTED, templateData: data, to, idempotencyKey });
  }
  await sendAll(ctx.env, ctx, mails);
}

/** What a logged-for-you email is about: a use (with what was used) or an expense. */
export type LoggedFor =
  | { kind: "use"; txn: KitchenTxnRecord; item: KitchenItemRecord; move: KitchenStockMoveRecord }
  | { kind: "expense"; txn: KitchenTxnRecord };

/**
 * `kitchen.logged_for_you`: a use or an expense that someone logged and that
 * names other people. A use emails each person who had some (its consumers),
 * an expense everyone it charges or credits — never whoever logged it, and
 * only people the transaction moves money for (a waste split equally, or a
 * use that moved no money, posts nothing here). One email per transaction and
 * person (`kitchen.logged_for_you:<txn>:<usr>`), however often the request is
 * retried.
 */
export async function emailLoggedForYou(ctx: RequestContext, logged: LoggedFor, group?: MemberGroup): Promise<void> {
  const { txn } = logged;
  const actor = txn.createdBy;
  const named =
    logged.kind === "use" ? (logged.move.consumers ?? []) : txn.splits.map((s) => s.subjectId);
  const splits = new Map(txn.splits.map((s) => [s.subjectId, s]));
  const recipients = [...new Set(named)].filter((id) => {
    const split = splits.get(id);
    return id !== actor && split !== undefined && (split.owedMinor > 0 || split.paidMinor > 0);
  });
  if (recipients.length === 0) return;

  const [here, people] = await Promise.all([
    group ? Promise.resolve(group) : groupOf(ctx, txn.orgId),
    ctx.people.users([actor, ...recipients]),
  ]);
  const by = people.get(actor);
  // A use in the words it was given in ("2 onions of Onions", SM-13), else its quantity.
  const what =
    logged.kind === "use"
      ? `${logged.move.label ?? formatQuantity(logged.move.qtyMilli, logged.item.dimension, logged.move.unit ?? logged.item.displayUnit)} of ${logged.item.name}`
      : txn.title;
  const txnId = toPublicId("txn", txn.id);
  const mails: KitchenMail[] = [];
  for (const subjectId of recipients) {
    const to = people.get(subjectId);
    const idempotencyKey = mailKey(KITCHEN_EMAILS.LOGGED_FOR_YOU, txnId, subjectId);
    if (!to || !to.email.trim() || !idempotencyKey) continue;
    const split = splits.get(subjectId)!;
    const data: LoggedForYouEmail = {
      kind: logged.kind,
      actorName: by ? displayNameOf(by) : null,
      what,
      groupName: here?.name ?? "your group",
      total: formatMinor(txn.totalMinor, txn.currency),
      yourShare: split.owedMinor > 0 ? formatMinor(split.owedMinor, txn.currency) : null,
      // A use's buyer is paid back for their own item: "you paid" is an expense's line.
      youPaid: logged.kind === "expense" && split.paidMinor > 0 ? formatMinor(split.paidMinor, txn.currency) : null,
      groupUrl: here ? appLink(ctx.env, `/groups/${encodeURIComponent(here.slug)}`) : appLink(ctx.env, "/groups"),
    };
    mails.push({
      orgId: toPublicId("org", txn.orgId),
      templateKey: KITCHEN_EMAILS.LOGGED_FOR_YOU,
      templateData: data,
      to,
      idempotencyKey,
    });
  }
  await sendAll(ctx.env, ctx, mails);
}

/**
 * `kitchen.portion_set` (SM-6): someone set another member's portion of an
 * open dish ("Anu said you had 1 portion of Egg fried rice"). Emailed to that
 * person — never for your own portion, nor for taking one back — once per
 * dish and person (`kitchen.portion_set:<dsh>:<usr>`): a change after, by
 * anyone, sends nothing more. Says who set it, how much, what it costs them
 * at the dish's price, and links to the dish, where they can change it.
 */
export async function emailPortionSet(ctx: RequestContext, dish: KitchenDishRecord, subjectId: string): Promise<void> {
  const actor = ctx.actor.subjectId;
  if (!dish.orgId || subjectId === actor) return;
  const share = dish.shares.find((s) => s.subjectId === subjectId);
  if (!share || share.portionsHalf === null || share.portionsHalf <= 0) return;
  const dishId = toPublicId("dsh", dish.id);
  const idempotencyKey = mailKey(KITCHEN_EMAILS.PORTION_SET, dishId, subjectId);
  if (!idempotencyKey) return;

  const [group, people] = await Promise.all([groupOf(ctx, dish.orgId), ctx.people.users([actor, subjectId])]);
  const to = people.get(subjectId);
  if (!to || !to.email.trim()) return;
  const by = people.get(actor);

  // What their portions cost them, as the dish splits now (the cook's own
  // amount also holds the unclaimed portions: those are not theirs to pay).
  let yourShare: string | null = null;
  try {
    const split = splitDish(dish, inSplitOrder(dish.cook, dish.shares));
    const owed = split.amounts.find((a) => a.subjectId === subjectId)?.owedMinor ?? 0;
    const own = subjectId === dish.cook ? owed - split.unclaimedMinor : owed;
    if (own > 0) yourShare = formatMinor(own, dish.currency);
  } catch {
    // The write's own guard keeps the shares splittable; the email still goes without an amount.
  }

  const data: PortionSetEmail = {
    actorName: by ? displayNameOf(by) : null,
    dishName: dish.name,
    groupName: group?.name ?? "your group",
    portions: formatPortions(share.portionsHalf),
    yourShare,
    dishUrl: appLink(ctx.env, `/dishes/${dishId}`),
  };
  await sendKitchenMail(ctx.env, ctx, {
    orgId: toPublicId("org", dish.orgId),
    templateKey: KITCHEN_EMAILS.PORTION_SET,
    templateData: data,
    to,
    idempotencyKey,
  });
}

/** How a payment was made, as the notification says it; "other" says nothing. */
export const PAYMENT_METHOD_WORDS: Record<SettlementMethod, string | null> = {
  upi: "UPI",
  cash: "Cash",
  bank: "Bank transfer",
  other: null,
};

/**
 * `kitchen.paid_you` (PW-5): a payment was recorded to someone — "Dev paid
 * you ₹400.00 · UPI". Emailed to the person paid, once per payment
 * (`kitchen.paid_you:<txn>:<usr>`), so a retried request sends nothing more;
 * never when they recorded it themselves (they know), and never for anything
 * but a settlement. Links to the payer's page, where what is between the two
 * of them is.
 */
export async function emailPaidYou(ctx: RequestContext, txn: KitchenTxnRecord): Promise<void> {
  if (txn.kind !== "settlement") return;
  // A settlement's splits: the payer paid, the payee is owed (buildSettlement).
  const payer = txn.splits.find((s) => s.paidMinor > 0)?.subjectId;
  const payee = txn.splits.find((s) => s.owedMinor > 0)?.subjectId;
  if (!payer || !payee || payer === payee || txn.createdBy === payee) return;
  const txnId = toPublicId("txn", txn.id);
  const idempotencyKey = mailKey(KITCHEN_EMAILS.PAID_YOU, txnId, payee);
  if (!idempotencyKey) return;

  const [group, people] = await Promise.all([groupOf(ctx, txn.orgId), ctx.people.users([payer, payee])]);
  const to = people.get(payee);
  if (!to || !to.email.trim()) return;
  const by = people.get(payer);
  const data: PaidYouEmail = {
    payerName: by ? displayNameOf(by) : null,
    amount: formatMinor(txn.totalMinor, txn.currency),
    method: txn.method ? PAYMENT_METHOD_WORDS[txn.method] : null,
    groupName: group?.name ?? "your group",
    personUrl: appLink(ctx.env, `/people/${encodeURIComponent(payer)}`),
  };
  await sendKitchenMail(ctx.env, ctx, {
    orgId: toPublicId("org", txn.orgId),
    templateKey: KITCHEN_EMAILS.PAID_YOU,
    templateData: data,
    to,
    idempotencyKey,
  });
}
