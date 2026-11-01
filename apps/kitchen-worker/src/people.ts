// People across groups (CP-9), as pure functions over each group's ledger:
// the caller's balances and everyone they share a group with (what Home,
// People and Settle up's "All groups" show), and the "why" between the caller
// and one person (the person view). Money is never added across groups'
// currencies; payments stay in the group they belong to.

import type {
  CurrencyTotal,
  KitchenGroupRole,
  MyBalancesResponse,
  PersonBalance,
  PersonGroupNet,
  PersonGroupView,
  PersonLine,
  ShortcutVia,
} from "@saas/contracts/kitchen";
import {
  balances,
  pairLines,
  personView,
  settlePlan,
  type Payment,
  type Txn,
} from "@saas/kitchen-engine/ledger";
import type { MemberGroup } from "./groups-client.js";
import type { DisplayName } from "./identity-client.js";
import { toPublicId } from "./ids.js";

/** One of the caller's groups, read in full: its currency, who is in it, and its whole ledger. */
export interface GroupLedger {
  group: MemberGroup;
  currency: string;
  /** Everyone with a group role, the caller included. */
  members: readonly string[];
  /** The ledger, oldest first, as the engine reads it (ids are stored UUIDs). */
  txns: readonly Txn[];
}

function byName(a: { name: DisplayName; id: string }, b: { name: DisplayName; id: string }): number {
  const an = a.name ?? "";
  const bn = b.name ?? "";
  // People with a name first, alphabetically; then by id.
  if (an && !bn) return -1;
  if (bn && !an) return 1;
  return an.localeCompare(bn, undefined, { sensitivity: "base" }) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/** Everyone `myBalances` will name: the caller's co-members, and anyone a plan still has them pay or be paid by. */
export function peopleIn(meId: string, ledgers: readonly GroupLedger[]): string[] {
  const ids = new Set<string>();
  for (const ledger of ledgers) {
    for (const id of ledger.members) if (id !== meId) ids.add(id);
    for (const p of settlePlan(ledger.txns).payments) {
      if (p.toId === meId) ids.add(p.fromId);
      if (p.fromId === meId) ids.add(p.toId);
    }
  }
  return [...ids];
}

/**
 * GET /v1/kitchen/me/balances from the caller's groups' ledgers (by name).
 * A person's net in a group is what that group's settle plan has between you
 * — the numbers Settle up shows — so a person's nets across a group add up to
 * your balance there.
 */
export function myBalances(
  meId: string,
  ledgers: readonly GroupLedger[],
  names: ReadonlyMap<string, DisplayName>,
): MyBalancesResponse {
  const people = new Map<string, PersonGroupNet[]>();
  const totals: CurrencyTotal[] = [];
  const groups = ledgers.map((ledger) => {
    const { group, currency } = ledger;
    const plan = settlePlan(ledger.txns);

    // Everyone in the group at zero, then whatever the plan has between you —
    // including someone who left with money still open.
    const nets = new Map<string, number>();
    for (const id of ledger.members) if (id !== meId) nets.set(id, 0);
    let owedToYouMinor = 0;
    let youOweMinor = 0;
    for (const p of plan.payments) {
      if (p.toId === meId) {
        nets.set(p.fromId, (nets.get(p.fromId) ?? 0) + p.amountMinor);
        owedToYouMinor += p.amountMinor;
      } else if (p.fromId === meId) {
        nets.set(p.toId, (nets.get(p.toId) ?? 0) - p.amountMinor);
        youOweMinor += p.amountMinor;
      }
    }
    for (const [subjectId, netMinor] of nets) {
      const list = people.get(subjectId) ?? [];
      list.push({ orgId: group.publicId, slug: group.slug, name: group.name, currency, netMinor });
      people.set(subjectId, list);
    }

    let total = totals.find((t) => t.currency === currency);
    if (!total) {
      total = { currency, owedToYouMinor: 0, youOweMinor: 0, netMinor: 0 };
      totals.push(total);
    }
    total.owedToYouMinor += owedToYouMinor;
    total.youOweMinor += youOweMinor;
    total.netMinor += owedToYouMinor - youOweMinor;

    return {
      orgId: group.publicId,
      slug: group.slug,
      name: group.name,
      currency,
      balanceMinor: balances(ledger.txns).get(meId) ?? 0,
      role: group.role as KitchenGroupRole,
      memberCount: ledger.members.length,
    };
  });

  const largest = (nets: readonly PersonGroupNet[]) => Math.max(0, ...nets.map((n) => Math.abs(n.netMinor)));
  const list: PersonBalance[] = [...people.entries()]
    .map(([subjectId, nets]) => ({ subjectId, displayName: names.get(subjectId) ?? null, groups: nets }))
    .sort(
      (a, b) =>
        largest(b.groups) - largest(a.groups) ||
        byName({ name: a.displayName, id: a.subjectId }, { name: b.displayName, id: b.subjectId }),
    );
  return { groups, people: list, totals };
}

// ── The person view ─────────────────────────────────────────────────

/** Net pairwise debts in one group: `owes(a, b)` > 0 when a owes b once their debts both ways cancel. */
function pairwiseDebts(txns: readonly Txn[]): (a: string, b: string) => number {
  const directed = new Map<string, number>();
  for (const l of pairLines(txns)) {
    const key = `${l.debtorId}\u0000${l.creditorId}`;
    directed.set(key, (directed.get(key) ?? 0) + l.amountMinor);
  }
  const get = (a: string, b: string) => directed.get(`${a}\u0000${b}`) ?? 0;
  return (a, b) => get(a, b) - get(b, a);
}

/**
 * One three-person step that explains a group shortcut between `meId` and
 * `otherId`, or null. The plan pays across people who never dealt directly:
 * `from` owes `via` and `via` owes `to`, so `from` pays `to`. A step explains
 * the shortcut when collapsing it moves money between you two the way the
 * shortcut does — the third person is either between you (you two pay each
 * other directly) or at one end (one of you is skipped). Steps whose direct
 * payment is in the plan come first, then the largest, then the ones with
 * the third person between you.
 */
export function shortcutStep(
  txns: readonly Txn[],
  payments: readonly Payment[],
  meId: string,
  otherId: string,
  shortcutMinor: number,
): Omit<ShortcutVia, "thirdDisplayName"> & { thirdId: string } | null {
  if (shortcutMinor === 0) return null;
  const owes = pairwiseDebts(txns);
  const people = new Set<string>();
  for (const t of txns) for (const s of t.splits) people.add(s.subjectId);
  people.delete(meId);
  people.delete(otherId);

  type Step = { from: string; via: string; to: string; third: string; rank: number };
  const steps: Step[] = [];
  for (const x of people) {
    // Positive shortcut: more flows from them to you (or less from you to them).
    // Negative: the mirror image. `rank` prefers the third person between you.
    const shapes: Array<[string, string, string, number]> =
      shortcutMinor > 0
        ? [
            [otherId, x, meId, 0], // they owe X, X owes you: they pay you
            [meId, otherId, x, 1], // you owe them, they owe X: you pay X
            [x, meId, otherId, 1], // X owes you, you owe them: X pays them
          ]
        : [
            [meId, x, otherId, 0], // you owe X, X owes them: you pay them
            [x, otherId, meId, 1], // X owes them, they owe you: X pays you
            [otherId, meId, x, 1], // they owe you, you owe X: they pay X
          ];
    for (const [from, via, to, rank] of shapes) {
      if (owes(from, via) > 0 && owes(via, to) > 0) steps.push({ from, via, to, third: x, rank });
    }
  }
  if (steps.length === 0) return null;

  const planned = (s: Step) => payments.some((p) => p.fromId === s.from && p.toId === s.to);
  const strength = (s: Step) => Math.min(owes(s.from, s.via), owes(s.via, s.to));
  steps.sort(
    (a, b) =>
      Number(planned(b)) - Number(planned(a)) ||
      strength(b) - strength(a) ||
      a.rank - b.rank ||
      (a.third < b.third ? -1 : a.third > b.third ? 1 : 0),
  );
  const best = steps[0]!;
  return {
    fromSubjectId: best.from,
    viaSubjectId: best.via,
    toSubjectId: best.to,
    amountMinor: owes(best.from, best.via),
    thirdId: best.third,
  };
}

/** The person view in one group, or null when the two share nothing there (not both in it, and no money between them). */
export function personGroupView(
  meId: string,
  otherId: string,
  ledger: GroupLedger,
): (Omit<PersonGroupView, "shortcutVia"> & { shortcut: ReturnType<typeof shortcutStep> }) | null {
  const view = personView(ledger.txns, meId, otherId);
  const member = ledger.members.includes(otherId);
  if (!member && view.lines.length === 0 && view.planMinor === 0) return null;

  const reversed = new Set(ledger.txns.flatMap((t) => (t.reverses ? [t.reverses] : [])));
  const byId = new Map(ledger.txns.map((t) => [t.id, t] as const));
  // The engine's lines are in ledger order (oldest first); show newest first.
  const lines: PersonLine[] = view.lines
    .map((l) => {
      const reverses = byId.get(l.txnId)?.reverses ?? null;
      return {
        txnId: toPublicId("txn", l.txnId),
        kind: l.kind,
        title: l.title,
        occurredAt: l.occurredAt ?? "",
        signedMinor: l.signedMinor,
        reversed: reversed.has(l.txnId),
        reverses: reverses ? toPublicId("txn", reverses) : null,
      };
    })
    .reverse();

  return {
    orgId: ledger.group.publicId,
    slug: ledger.group.slug,
    name: ledger.group.name,
    currency: ledger.currency,
    role: ledger.group.role as KitchenGroupRole,
    lines,
    pairwiseMinor: view.pairwiseMinor,
    planMinor: view.planMinor,
    shortcutMinor: view.shortcutMinor,
    shortcut: shortcutStep(ledger.txns, settlePlan(ledger.txns).payments, meId, otherId, view.shortcutMinor),
  };
}

/** Σ of what each group's plan has between you, per currency, in the order the groups first use them. */
export function planTotals(groups: readonly Pick<PersonGroupView, "currency" | "planMinor">[]): { currency: string; netMinor: number }[] {
  const out: { currency: string; netMinor: number }[] = [];
  for (const g of groups) {
    const t = out.find((x) => x.currency === g.currency);
    if (t) t.netMinor += g.planMinor;
    else out.push({ currency: g.currency, netMinor: g.planMinor });
  }
  return out;
}
