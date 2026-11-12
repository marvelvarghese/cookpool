// Reminders and your profile (design §2, §5; SE2):
//
//   POST /v1/spliteco/reminders   { to, groupId? }   a nudge to someone who owes you   spliteco.reminder.sent
//   GET  /v1/spliteco/me/profile                     your UPI ID and default currency
//   PUT  /v1/spliteco/me/profile                     set them (`upiVpa: null` removes it)
//
// A reminder goes to someone who owes the caller in a group they share (by
// the group's plan), at most once per pair per SPLITECO_REMINDER_HOURS:
// inside that window it is 409 `reminded_recently`, with when the next one is
// allowed. It is recorded with its audit event in one batch, then sent by
// email (and push, for a person who turned it on) through notifications-worker.
// Someone the caller shares no group with reads as the opaque 404.

import {
  SPLITECO_ERROR_REASONS,
  SPLITECO_REMINDER_HOURS,
  isUpiVpa,
  type SplitecoProfileResponse,
  type SplitecoReminderResponse,
} from "@saas/contracts/spliteco";
import { formatMinor } from "@saas/kitchen-engine/money";
import { requireOrgAction } from "../authz.js";
import type { RequestContext } from "../context.js";
import { conflict, notFound, readJsonObject, successResponse, unavailable, validationError } from "../http.js";
import { orgPublicId, parseOrgPublicId } from "../ids.js";
import { bucketedPlan, currencyOf, groupLabel, withRepo } from "../ledger.js";
import { sendReminder } from "../notify.js";
import { Fields, subjectId } from "../validate.js";
import { SETTLE_ACTION, refuseAssistant } from "./settle.js";

const HOUR_MS = 60 * 60 * 1000;
const CURRENCY_RE = /^[A-Z]{3}$/;

function newReminderId(): string {
  return `rmd_${crypto.randomUUID().replace(/-/g, "")}`;
}

export async function handleSendReminder(ctx: RequestContext, request: Request): Promise<Response> {
  const body = await readJsonObject(request);
  if (!body) return validationError(ctx.requestId, { body: ["Must be a JSON object"] });
  const fields = new Fields();
  const to = subjectId(fields, "to", body.to);
  let groupId: string | null = null;
  if (body.groupId !== undefined && body.groupId !== null) {
    groupId = typeof body.groupId === "string" ? parseOrgPublicId(body.groupId) : null;
    if (!groupId) fields.add("groupId", "Must be a group's id");
  }
  if (!fields.ok || to === undefined) return validationError(ctx.requestId, fields.errors);
  const me = ctx.actor.subjectId;
  if (to === me) return notFound(ctx.requestId);

  const mine = await ctx.timings.measure("membership", () => ctx.groups.of(me));
  if (!mine.ok) return unavailable(ctx.requestId);
  const shared = mine.groups.filter((g) => g.members.some((m) => m.subjectId === to) && (groupId === null || g.orgId === groupId));
  if (shared.length === 0) return notFound(ctx.requestId);

  return withRepo(ctx, async (repo) => {
    const orgIds = shared.map((g) => g.orgId);
    const [rows, currencies, settings] = await ctx.timings.measure("db", () =>
      Promise.all([repo.listTxns(orgIds), repo.currencies(orgIds), repo.groupSettings(orgIds)]),
    );
    // What they owe the caller in each shared group, by its plan; the reminder is about the largest.
    let best: { group: (typeof shared)[number]; amountMinor: number } | null = null;
    for (const group of shared) {
      const own = rows.filter((t) => t.orgId === group.orgId);
      const owed = bucketedPlan(own, settings.get(group.orgId)?.simplifyDebts ?? true)
        .filter((p) => p.fromId === to && p.toId === me)
        .reduce((s, p) => s + p.amountMinor, 0);
      if (owed > 0 && (!best || owed > best.amountMinor)) best = { group, amountMinor: owed };
    }
    if (!best) return conflict(ctx.requestId, "They don't owe you anything here", SPLITECO_ERROR_REASONS.NOTHING_OWED);
    const denied = await requireOrgAction(ctx, best.group.orgId, SETTLE_ACTION);
    if (denied) return denied;

    const now = ctx.now();
    const notBefore = new Date(now.getTime() - SPLITECO_REMINDER_HOURS * HOUR_MS).toISOString();
    const currency = currencyOf(currencies, best.group.orgId);
    const reminder = {
      id: newReminderId(),
      orgId: best.group.orgId,
      fromSubject: me,
      toSubject: to,
      amountMinor: best.amountMinor,
      currency,
      sentAt: now.toISOString(),
    };
    const eventId = () => crypto.randomUUID().replace(/-/g, "");
    const added = await ctx.timings.measure("db", () =>
      repo.addReminder(reminder, notBefore, {
        event: {
          id: eventId(),
          type: "spliteco.reminder.sent",
          version: 1,
          source: "spliteco-worker",
          occurredAt: now,
          actorType: ctx.actor.subjectType,
          actorId: me,
          orgId: best!.group.orgId,
          subjectKind: "ledger_reminder",
          subjectId: reminder.id,
          requestId: ctx.requestId,
          payload: { orgId: orgPublicId(best!.group.orgId), reminderId: reminder.id, toSubjectId: to, amountMinor: best!.amountMinor, currency },
        },
        audit: { id: eventId(), category: "spliteco", description: `Reminder ${reminder.id}: ${me} reminded ${to} of ${formatMinor(best!.amountMinor, currency)}` },
      }),
    );
    if (!added.ok) {
      const lastSentAt = added.last?.sentAt ?? null;
      return conflict(ctx.requestId, "You reminded them in the last 24 hours", SPLITECO_ERROR_REASONS.REMINDED_RECENTLY, {
        lastSentAt,
        nextAllowedAt: lastSentAt ? new Date(new Date(lastSentAt).getTime() + SPLITECO_REMINDER_HOURS * HOUR_MS).toISOString() : null,
      });
    }
    const delivered = await sendReminder(ctx, {
      reminderId: reminder.id,
      orgPublicId: orgPublicId(best.group.orgId),
      groupName: groupLabel(best.group),
      to,
      amount: formatMinor(best.amountMinor, currency),
    });
    return successResponse<SplitecoReminderResponse>(
      {
        reminder: {
          id: reminder.id,
          groupId: orgPublicId(best.group.orgId),
          toSubjectId: to,
          amountMinor: best.amountMinor,
          currency,
          sentAt: reminder.sentAt,
          nextAllowedAt: new Date(now.getTime() + SPLITECO_REMINDER_HOURS * HOUR_MS).toISOString(),
        },
        delivered,
      },
      ctx.requestId,
      201,
    );
  });
}

export function handleGetProfile(ctx: RequestContext): Promise<Response> {
  return withRepo(ctx, async (repo) => {
    const profile = (await repo.profiles([ctx.actor.subjectId])).get(ctx.actor.subjectId);
    return successResponse<SplitecoProfileResponse>(
      { profile: { upiVpa: profile?.upiVpa ?? null, defaultCurrency: profile?.defaultCurrency ?? "INR" } },
      ctx.requestId,
    );
  });
}

export async function handlePutProfile(ctx: RequestContext, request: Request): Promise<Response> {
  // A UPI ID is where money goes: set only by the person, in the app.
  const refused = refuseAssistant(ctx);
  if (refused) return refused;
  const body = await readJsonObject(request);
  if (!body) return validationError(ctx.requestId, { body: ["Must be a JSON object"] });
  const fields = new Fields();
  let upiVpa: string | null = null;
  if (body.upiVpa === undefined) fields.add("upiVpa", "Required (null removes it)");
  else if (body.upiVpa !== null) {
    const typed = typeof body.upiVpa === "string" ? body.upiVpa.trim() : body.upiVpa;
    if (typed === "") upiVpa = null;
    else if (isUpiVpa(typed)) upiVpa = typed;
    else fields.add("upiVpa", "Must be a UPI ID like name@bank");
  }
  let defaultCurrency: string | undefined;
  if (body.defaultCurrency !== undefined) {
    if (typeof body.defaultCurrency === "string" && CURRENCY_RE.test(body.defaultCurrency)) defaultCurrency = body.defaultCurrency;
    else fields.add("defaultCurrency", "Must be a currency code like INR");
  }
  if (!fields.ok) return validationError(ctx.requestId, fields.errors);
  return withRepo(ctx, async (repo) => {
    const me = ctx.actor.subjectId;
    const current = (await repo.profiles([me])).get(me);
    const saved = await repo.setProfile({
      subjectId: me,
      upiVpa,
      defaultCurrency: defaultCurrency ?? current?.defaultCurrency ?? "INR",
      updatedAt: ctx.now().toISOString(),
    });
    return successResponse<SplitecoProfileResponse>({ profile: { upiVpa: saved.upiVpa, defaultCurrency: saved.defaultCurrency } }, ctx.requestId);
  });
}
