import type {
  GroupMembersResponse,
  KitchenGroupRole,
  MyBalancesResponse,
  PersonViewResponse,
} from "@saas/contracts/kitchen";
import { KITCHEN_GROUP_ROLES, TXN_KINDS } from "@saas/contracts/kitchen";
import type { RosterResponse } from "@saas/contracts/membership";
import type { UsersLookupRequest, UsersLookupResponse } from "@saas/contracts/auth";
import { USERS_LOOKUP_MAX } from "@saas/contracts/auth";

describe("contracts: people across groups (Cookpool CP-9)", () => {
  it("names the four roles that make someone part of a group's kitchen", () => {
    expect(KITCHEN_GROUP_ROLES).toEqual(["owner", "admin", "builder", "viewer"]);
    const role: KitchenGroupRole = "viewer";
    expect(KITCHEN_GROUP_ROLES).toContain(role);
  });

  it("types GET /v1/kitchen/me/balances: groups, people and totals per currency", () => {
    const balances: MyBalancesResponse = {
      groups: [
        { orgId: "org_1", slug: "flat-4b", name: "Flat 4B", currency: "INR", balanceMinor: 1600, role: "owner", memberCount: 4 },
        { orgId: "org_2", slug: "goa", name: "Goa trip", currency: "USD", balanceMinor: -2500, role: "viewer", memberCount: 2 },
      ],
      people: [
        {
          subjectId: "usr_dev",
          displayName: "Dev",
          groups: [
            { orgId: "org_1", slug: "flat-4b", name: "Flat 4B", currency: "INR", netMinor: 1600 },
            { orgId: "org_2", slug: "goa", name: "Goa trip", currency: "USD", netMinor: -2500 },
          ],
        },
        { subjectId: "usr_meera", displayName: null, groups: [{ orgId: "org_1", slug: "flat-4b", name: "Flat 4B", currency: "INR", netMinor: 0 }] },
      ],
      totals: [
        { currency: "INR", owedToYouMinor: 1600, youOweMinor: 0, netMinor: 1600 },
        { currency: "USD", owedToYouMinor: 0, youOweMinor: 2500, netMinor: -2500 },
      ],
    };
    for (const t of balances.totals) expect(t.netMinor).toBe(t.owedToYouMinor - t.youOweMinor);
    expect(new Set(balances.totals.map((t) => t.currency)).size).toBe(balances.totals.length);
  });

  it("types GET /v1/kitchen/me/people/{usr}: lines, the pairwise and plan amounts, and the shortcut", () => {
    const view: PersonViewResponse = {
      subjectId: "usr_dev",
      displayName: "Dev",
      groups: [
        {
          orgId: "org_1",
          slug: "flat-4b",
          name: "Flat 4B",
          currency: "INR",
          role: "builder",
          lines: [
            { txnId: "txn_2", kind: "reversal", title: "Undo: Dinner", occurredAt: "2026-11-02T09:00:00.000Z", signedMinor: -1000, reversed: false, reverses: "txn_1" },
            { txnId: "txn_1", kind: "expense", title: "Dinner", occurredAt: "2026-11-02T08:00:00.000Z", signedMinor: 1000, reversed: true, reverses: null },
          ],
          pairwiseMinor: 0,
          planMinor: 9000,
          shortcutMinor: 9000,
          shortcutVia: { fromSubjectId: "usr_dev", viaSubjectId: "usr_anu", toSubjectId: "usr_rahul", amountMinor: 9000, thirdDisplayName: "Anu" },
        },
      ],
      totals: [{ currency: "INR", netMinor: 9000 }],
    };
    const g = view.groups[0]!;
    expect(g.shortcutMinor).toBe(g.planMinor - g.pairwiseMinor);
    expect(g.lines.reduce((a, l) => a + l.signedMinor, 0)).toBe(g.pairwiseMinor);
    for (const l of g.lines) expect(TXN_KINDS).toContain(l.kind);
  });

  it("types a group's members, the roster they come from, and the names lookup behind them", () => {
    const members: GroupMembersResponse = {
      members: [
        { subjectId: "usr_rahul", displayName: "Rahul", role: "owner", memberId: "mem_1", joinedAt: "2026-11-01T00:00:00.000Z" },
        { subjectId: "usr_anu", displayName: null, role: "builder", memberId: null, joinedAt: null },
      ],
    };
    const roster: RosterResponse = {
      members: [{ subjectId: "usr_rahul", subjectType: "user", role: "owner", memberId: "mem_1", joinedAt: "2026-11-01T00:00:00.000Z" }],
    };
    const ask: UsersLookupRequest = { subjectIds: ["usr_rahul"] };
    const answer: UsersLookupResponse = { users: [{ subjectId: "usr_rahul", displayName: "Rahul", email: "rahul@example.com" }] };
    expect(members.members[0]!.memberId).toBe(roster.members[0]!.memberId);
    expect(answer.users.map((u) => u.subjectId)).toEqual(ask.subjectIds);
    expect(USERS_LOOKUP_MAX).toBe(100);
  });
});
