import type { KitchenMeasure } from "@saas/contracts/kitchen";
import type { KitchenItemRecord, KitchenRepository } from "@saas/db/kitchen";
import type { RequestContext } from "../context.js";
import { canUseIn, type MemberGroup } from "../groups-client.js";
import { readMeasures } from "../measures.js";

// What "say what you used" reads before it asks the model (design §2): the
// caller's usable items with something left, and the people they share a
// usable group with. Everything the model will see is built from this — and
// it holds no money: an item goes as its name, its unit, what's left and its
// measures; a group as a ref ("g1"); a person as "person n" with only their
// first name (the single exception to "no names", design §2).

/** The most items one sentence is read against (the caller's items with something left). */
export const AI_USES_MAX_ITEMS = 100;
/** The most co-members named to the model. */
export const AI_USES_MAX_PEOPLE = 40;

export interface UsesItem {
  /** What the model calls it: "i1", "i2"… */
  ref: string;
  record: KitchenItemRecord;
  measures: KitchenMeasure[];
  /** Its group, or null for the caller's own pantry. */
  group: MemberGroup | null;
  /** Its group's ref ("g1"), or "mine". */
  pantryRef: string;
}

export interface UsesPerson {
  /** "person 1", "person 2"… */
  ref: string;
  subjectId: string;
  firstName: string;
  /** The refs of the usable groups they share with the caller. */
  groupRefs: string[];
}

export interface UsesInput {
  text: string;
  /** The caller (`usr_…`): "me" to the model. */
  caller: string;
  items: UsesItem[];
  people: UsesPerson[];
  /** Each usable group's members (`usr_…`), by the group's stored id. */
  members: Map<string, ReadonlySet<string>>;
  /** Every group ref the model sees. */
  groupRefs: string[];
}

/**
 * A first name only: the first run of letters of the name they set, else of
 * their email's local part ("anu.k@…" → "anu"). Never a surname, never an
 * address. Null when there is nothing to call them.
 */
export function firstNameOf(user: { displayName: string | null; email: string } | null): string | null {
  if (!user) return null;
  const source = user.displayName?.trim() || user.email.split("@")[0] || "";
  const match = /\p{L}[\p{L}\p{M}'’]*/u.exec(source);
  return match ? match[0].slice(0, 20) : null;
}

export type UsesContext = { ok: true; input: UsesInput } | { ok: false };

/** Read the caller's usable items and co-members for `text`. `{ ok: false }` when a read failed. */
export async function readUsesContext(ctx: RequestContext, repo: KitchenRepository, text: string): Promise<UsesContext> {
  const caller = ctx.actor.subjectId;
  const mine = await ctx.timings.measure("groups", () => ctx.groups.of(caller));
  if (!mine.ok) return { ok: false };
  const usable = [...mine.groups].filter(canUseIn).sort((a, b) => a.name.localeCompare(b.name) || a.slug.localeCompare(b.slug));
  const groupRef = new Map(usable.map((g, i) => [g.orgId as string, `g${i + 1}`]));

  const found = await ctx.timings.measure("db", () =>
    repo.searchItems({ ownerSubjectId: caller, orgIds: usable.map((g) => g.orgId), q: "", limit: AI_USES_MAX_ITEMS }),
  );
  if (!found.ok) return { ok: false };
  const measures = await readMeasures(ctx, repo, found.value);
  if (!measures) return { ok: false };

  const rosters = await ctx.timings.measure("roster", () => Promise.all(usable.map((g) => ctx.roster.members(g.orgId))));
  const members = new Map<string, ReadonlySet<string>>();
  for (const [i, group] of usable.entries()) {
    const roster = rosters[i]!;
    if (!roster.ok) return { ok: false };
    members.set(group.orgId, new Set(roster.members.map((m) => m.subjectId)));
  }

  const byOrg = new Map(usable.map((g) => [g.orgId as string, g]));
  const items: UsesItem[] = [];
  for (const record of found.value) {
    const group = record.orgId ? byOrg.get(record.orgId) : null;
    if (group === undefined) continue; // Not usable: the scope only reads usable groups.
    items.push({
      ref: `i${items.length + 1}`,
      record,
      measures: measures(record),
      group,
      pantryRef: group ? groupRef.get(group.orgId)! : "mine",
    });
  }

  // Co-members, in the order the groups list them; each once.
  const coMembers: string[] = [];
  for (const group of usable) {
    for (const id of members.get(group.orgId) ?? []) {
      if (id !== caller && !coMembers.includes(id)) coMembers.push(id);
    }
  }
  const users = coMembers.length > 0 ? await ctx.timings.measure("people", () => ctx.people.users(coMembers)) : new Map();
  const people: UsesPerson[] = [];
  for (const subjectId of coMembers) {
    if (people.length >= AI_USES_MAX_PEOPLE) break;
    const firstName = firstNameOf(users.get(subjectId) ?? null);
    if (!firstName) continue; // Nothing to call them by: they cannot be named.
    people.push({
      ref: `person ${people.length + 1}`,
      subjectId,
      firstName,
      groupRefs: usable.filter((g) => members.get(g.orgId)?.has(subjectId)).map((g) => groupRef.get(g.orgId)!),
    });
  }

  return { ok: true, input: { text, caller, items, people, members, groupRefs: [...groupRef.values()] } };
}
