// The daily use-soon sweep (CP-18): scheduled() at 02:30 UTC (08:00 IST).
//
// One digest per person per day, listing what they can use whose use-by date
// is today through USE_SOON_EMAIL_DAYS ahead and that is not used up, wasted
// or removed: their own pantry's items, and the items of every group where
// their role may use them (owner, admin, member — not a viewer, who cannot).
//
// Reads, however many people: ONE D1 query for every pantry's items in the
// window; one roster per group that has any; one person's groups per group
// still unnamed (the group's name, read through a member — membership has no
// sibling route for a group by id); one identity lookup per 100 people for
// names and addresses. Then one enqueue per person, keyed
// `kitchen.use_soon:<usr>:<day>`: a second run the same day — a retry, a
// manual trigger — finds every digest already sent and sends nothing.
// Each run is recorded in kitchen_sweeps for /health.

import {
  KITCHEN_EMAILS,
  USE_SOON_EMAIL_DAYS,
  useSoonEmailData,
  type UseSoonEmailItem,
} from "@saas/contracts/kitchen";
import { createSqlExecutor } from "@saas/db/d1";
import type { Uuid } from "@saas/db/ids";
import { createKitchenRepository, type KitchenItemRecord } from "@saas/db/kitchen";
import { SYSTEM_ORG_ID, appLink, mailKey, sendAll, type KitchenMail } from "./emails.js";
import type { Env } from "./env.js";
import { USE_ROLES, createGroups } from "./groups-client.js";
import { createPeople, displayNameOf } from "./identity-client.js";
import { generateRequestId } from "./ids.js";
import { PERSONAL_PANTRY_NAME, addDays, isoDay } from "./pantry.js";
import { createRoster } from "./roster-client.js";

/** The most items one run reads: a bound on one invocation's memory, far above a day's worth. */
export const SWEEP_MAX_ITEMS = 5000;

/** Who the sweep's enqueues are from (notifications' audit events name it). */
const SWEEP_ACTOR = { subjectType: "system", subjectId: "kitchen-worker" } as const;

export interface SweepOptions {
  /** The clock the run is stamped with (started, finished). */
  now?: () => Date;
  /** The moment whose UTC day is swept — "today" (the cron's scheduled time); now() by default. */
  day?: Date;
  requestId?: string;
}

export interface SweepOutcome {
  /** The UTC day swept. */
  date: string;
  /** Items in the window. */
  items: number;
  /** People with at least one of them to use. */
  people: number;
  /** Digests notifications-worker accepted (sent now, sent earlier today, or suppressed). */
  sent: number;
  /** Digests not enqueued: no address for the person, or notifications-worker unreachable. */
  failed: number;
}

/** Each person's items, soonest first (the query's order, kept). */
function digestsOf(
  items: readonly KitchenItemRecord[],
  usersOf: ReadonlyMap<string, readonly string[]>,
  groupNames: ReadonlyMap<string, string>,
): Map<string, UseSoonEmailItem[]> {
  const out = new Map<string, UseSoonEmailItem[]>();
  const add = (subjectId: string, item: UseSoonEmailItem) => {
    const list = out.get(subjectId) ?? [];
    list.push(item);
    out.set(subjectId, list);
  };
  for (const item of items) {
    const entry = { name: item.name, useBy: item.expiresOn! };
    if (item.ownerKind === "user" && item.ownerSubjectId) {
      add(item.ownerSubjectId, { ...entry, pantry: PERSONAL_PANTRY_NAME });
    } else if (item.orgId) {
      const pantry = groupNames.get(item.orgId) ?? "A group pantry";
      for (const subjectId of usersOf.get(item.orgId) ?? []) add(subjectId, { ...entry, pantry });
    }
  }
  return out;
}

/**
 * Sweep every pantry once and send the day's digests. Returns what it did,
 * or null when there is no database to read. Never throws for a person or a
 * group it cannot reach: they are skipped (and counted as failed when a
 * digest was due).
 */
export async function runUseSoonSweep(env: Env, options: SweepOptions = {}): Promise<SweepOutcome | null> {
  if (!env.PLATFORM_DB) return null;
  const clock = options.now ?? (() => new Date());
  const startedAt = clock();
  const date = isoDay(options.day ?? startedAt);
  const requestId = options.requestId ?? generateRequestId();
  const executor = createSqlExecutor(env.PLATFORM_DB);
  try {
    const repo = createKitchenRepository(executor);
    const found = await repo.listUseSoonItems({
      from: date,
      through: addDays(date, USE_SOON_EMAIL_DAYS),
      limit: SWEEP_MAX_ITEMS,
    });
    if (!found.ok) return null;
    const items = found.value;

    // Who may use each group's items: its members whose role holds kitchen.item.use.
    const roster = createRoster(env.MEMBERSHIP_WORKER, requestId);
    const orgIds = [...new Set(items.flatMap((i) => (i.ownerKind === "group" && i.orgId ? [i.orgId] : [])))];
    const usersOf = new Map<string, string[]>();
    await Promise.all(
      orgIds.map(async (orgId) => {
        const members = await roster.members(orgId as Uuid);
        if (!members.ok) return;
        usersOf.set(
          orgId,
          members.members.filter((m) => m.role !== null && USE_ROLES.has(m.role)).map((m) => m.subjectId),
        );
      }),
    );

    // Each group's name, through one of its members: one answer names every group that member is in.
    const groups = createGroups(env.MEMBERSHIP_WORKER, requestId);
    const groupNames = new Map<string, string>();
    for (const orgId of orgIds) {
      if (groupNames.has(orgId)) continue;
      const member = usersOf.get(orgId)?.[0];
      if (!member) continue;
      const theirs = await groups.of(member);
      if (!theirs.ok) continue;
      for (const g of theirs.groups) if (!groupNames.has(g.orgId)) groupNames.set(g.orgId, g.name);
    }

    const digests = digestsOf(items, usersOf, groupNames);
    const subjectIds = [...digests.keys()].sort();
    const people = await createPeople(env.IDENTITY_WORKER, requestId).users(subjectIds);
    const homeUrl = appLink(env, "/home");

    const mails: KitchenMail[] = [];
    let failed = 0;
    for (const subjectId of subjectIds) {
      const to = people.get(subjectId);
      // No address, or an id no key can carry: skip the person, not the run.
      const idempotencyKey = mailKey(KITCHEN_EMAILS.USE_SOON, subjectId, date);
      if (!to || !to.email.trim() || !idempotencyKey) {
        failed += 1;
        continue;
      }
      const list = digests.get(subjectId)!;
      mails.push({
        orgId: SYSTEM_ORG_ID,
        templateKey: KITCHEN_EMAILS.USE_SOON,
        templateData: useSoonEmailData({
          recipientName: displayNameOf(to),
          date,
          count: list.length,
          items: list,
          homeUrl,
        }),
        to,
        idempotencyKey,
      });
    }
    const result = await sendAll(env, { requestId, actor: SWEEP_ACTOR }, mails);

    const outcome: SweepOutcome = {
      date,
      items: items.length,
      people: subjectIds.length,
      sent: result.sent,
      failed: failed + result.failed,
    };
    await repo.recordSweep({ ...outcome, startedAt, finishedAt: clock() });
    return outcome;
  } finally {
    await executor.dispose();
  }
}
