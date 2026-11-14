/**
 * Start from Spliteco (money-native MY-10), as pure logic: which of the
 * person's Spliteco groups the picker lists and in what order, which are
 * already added, and how a picked group fills Add group. No React, so it is
 * unit-testable.
 *
 * A Spliteco group can hold several currencies; a Cookpool group has exactly
 * one. The default is the Spliteco group's main currency (the one most of its
 * entries are in, ties to the group's ledger currency); the person may pick
 * any other and nothing is greyed out. Renaming here is Cookpool-only: nothing
 * in this file writes to Spliteco.
 */

import type {
  SplitecoActivityEntry,
  SplitecoGroupResponse,
  SplitecoGroupSummary,
  SplitecoPerson,
} from "@saas/contracts/spliteco";
import type { WastePolicy } from "@saas/contracts/kitchen";
import { DEFAULT_KITCHEN_CURRENCY } from "@saas/contracts/kitchen";
import { GROUP_NAME_MAX } from "./groups";

/** The groups Start from Spliteco offers: Spliteco's own, never the hidden direct ones. */
export function pickableGroups(groups: readonly SplitecoGroupSummary[]): SplitecoGroupSummary[] {
  return groups.filter((g) => g.kind !== "direct");
}

/**
 * Already a Cookpool group: made in Cookpool, or brought across before (the
 * ids this device recorded when Create group finished).
 */
export function isAdded(group: Pick<SplitecoGroupSummary, "id" | "madeIn">, addedIds: ReadonlySet<string> | readonly string[]): boolean {
  if (group.madeIn === "cookpool") return true;
  return Array.isArray(addedIds) ? addedIds.includes(group.id) : (addedIds as ReadonlySet<string>).has(group.id);
}

/** Group ids by how recently something happened in them (newest first), from the activity read. */
export function recencyOrder(entries: readonly Pick<SplitecoActivityEntry, "groupId" | "at">[]): string[] {
  const latest = new Map<string, number>();
  for (const e of entries) {
    const at = Date.parse(e.at);
    const t = Number.isNaN(at) ? 0 : at;
    if (t >= (latest.get(e.groupId) ?? -1)) latest.set(e.groupId, t);
  }
  return [...latest.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);
}

/** Search by name (case and accents ignored), then recent first; groups with no activity follow by name. */
export function searchGroups(
  groups: readonly SplitecoGroupSummary[],
  query: string,
  recent: readonly string[] = [],
): SplitecoGroupSummary[] {
  const norm = (s: string) => s.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase();
  const q = norm(query.trim());
  const rank = new Map(recent.map((id, i) => [id, i]));
  return groups
    .filter((g) => !q || norm(g.name).includes(q))
    .slice()
    .sort((a, b) => {
      const ra = rank.get(a.id) ?? Number.POSITIVE_INFINITY;
      const rb = rank.get(b.id) ?? Number.POSITIVE_INFINITY;
      if (ra !== rb) return ra < rb ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
}

/** The main currency: the one most of the group's entries are in; ties go to the group's ledger currency. */
export function mainCurrency(group: Pick<SplitecoGroupSummary, "currency">, entryCurrencies: readonly string[]): string {
  const counts = new Map<string, number>();
  for (const c of entryCurrencies) counts.set(c, (counts.get(c) ?? 0) + 1);
  let best = group.currency || DEFAULT_KITCHEN_CURRENCY;
  let bestN = counts.get(best) ?? 0;
  for (const [c, n] of counts) {
    if (n > bestN) {
      best = c;
      bestN = n;
    }
  }
  return best;
}

/** What a picked Spliteco group fills into Add group. */
export interface StartFromSpliteco {
  /** The Spliteco group it came from (`org_…`); read-only, never written to. */
  fromGroupId: string;
  /** Fills the name; the person may change it (Cookpool-only). */
  name: string;
  /** The one currency the Cookpool group gets by default: the Spliteco group's main one. */
  currency: string;
  /** Every currency the Spliteco group holds, main first; each is selectable, none greyed out. */
  currencies: string[];
  /** True when the Spliteco group holds more than the one. */
  multiCurrency: boolean;
  /** The people who come along (the caller is the group's owner already, so not listed). */
  people: SplitecoPerson[];
}

/** Map a picked group's detail to Add group's fields. `meId` is left out of the people. */
export function startFromSpliteco(detail: SplitecoGroupResponse, meId: string | null): StartFromSpliteco {
  const entryCurrencies = detail.expenses.map((e) => e.currency);
  const main = mainCurrency(detail.group, entryCurrencies);
  const others = [...new Set([detail.group.currency, ...entryCurrencies])].filter((c) => c && c !== main);
  const seen = new Set<string>();
  const people: SplitecoPerson[] = [];
  for (const m of detail.members) {
    if (m.subjectId === meId || seen.has(m.subjectId)) continue;
    seen.add(m.subjectId);
    people.push({ subjectId: m.subjectId, name: m.name });
  }
  return {
    fromGroupId: detail.group.id,
    name: detail.group.name.slice(0, GROUP_NAME_MAX),
    currency: main,
    currencies: [main, ...others],
    multiCurrency: others.length > 0,
    people,
  };
}

/** The currencies Add group's selector lists: the standard set, plus any the Spliteco group holds. All selectable. */
export function currencyChoices(
  standard: readonly { code: string; label: string }[],
  extra: readonly string[] = [],
): { code: string; label: string }[] {
  const out = standard.map((c) => ({ ...c }));
  for (const code of extra) if (!out.some((c) => c.code === code)) out.push({ code, label: code });
  return out;
}

/** What Create group sends once Add group is filled: the one currency, the rule, and (from Spliteco) the people. */
export interface CreateGroupPlan {
  name: string;
  currency: string;
  wastePolicy: WastePolicy;
  /** The Spliteco group it started from, or null; only a Cookpool record, Spliteco keeps its own name. */
  fromSplitecoGroupId: string | null;
  /** Subjects brought along; empty when Add group was filled by hand. */
  bringSubjectIds: string[];
}

export function createGroupPlan(input: {
  name: string;
  currency: string;
  wastePolicy: WastePolicy;
  from: StartFromSpliteco | null;
}): CreateGroupPlan {
  return {
    name: input.name.trim(),
    currency: input.currency,
    wastePolicy: input.wastePolicy,
    fromSplitecoGroupId: input.from?.fromGroupId ?? null,
    bringSubjectIds: input.from ? input.from.people.map((p) => p.subjectId) : [],
  };
}

/** "3 people" / "1 person". */
export function peopleCount(n: number): string {
  return n === 1 ? "1 person" : `${n} people`;
}
