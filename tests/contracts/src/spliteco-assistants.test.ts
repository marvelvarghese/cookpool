import { DELEGATION_SCOPES } from "@saas/contracts/delegations";
import { ASSISTANT_DEFAULT_SCOPES, ASSISTANT_SCOPES } from "@saas/contracts/mcp-connect";
import {
  SPLITECO_DRAFT_MINUTES,
  SPLITECO_DRAFT_TOKEN_RE,
  SPLITECO_ERROR_REASONS,
  type SplitecoActivityEntry,
  type SplitecoDraftRequest,
} from "@saas/contracts/spliteco";

// cookpool-spliteco SE-6: assistants log splits through Cookpool's MCP server
// under money.write, from a draft the person saw, and never record a payment.

describe("contracts: Spliteco's assistants (SE-6)", () => {
  it("adds money.write to the delegation and assistant scopes, off by default on the consent page", () => {
    expect(DELEGATION_SCOPES).toContain("money.write");
    expect([...ASSISTANT_SCOPES]).toEqual([...DELEGATION_SCOPES]);
    expect(ASSISTANT_DEFAULT_SCOPES).not.toContain("money.write");
    expect(ASSISTANT_DEFAULT_SCOPES).not.toContain("money.read");
  });

  it("pins the draft's life and token shape", () => {
    expect(SPLITECO_DRAFT_MINUTES).toBe(10);
    expect(SPLITECO_DRAFT_TOKEN_RE.test(`drf_${"0a".repeat(16)}`)).toBe(true);
    for (const t of ["drf_", `drf_${"A".repeat(32)}`, `txn_${"0".repeat(32)}`, `drf_${"0".repeat(33)}`]) expect(SPLITECO_DRAFT_TOKEN_RE.test(t)).toBe(false);
  });

  it("names the refusals an assistant can meet", () => {
    expect(SPLITECO_ERROR_REASONS).toMatchObject({
      DRAFT_REQUIRED: "draft_required",
      DRAFT_EXPIRED: "draft_expired",
      SCOPE: "scope",
      NOT_FROM_AN_ASSISTANT: "not_from_an_assistant",
    });
  });

  it("types the three drafts and the activity's via", () => {
    const drafts: SplitecoDraftRequest[] = [
      { action: "add", groupId: "org_1", expense: { title: "Cruise", totalMinor: 100, payers: [], split: { method: "equal", participants: [] } } },
      { action: "edit", expenseId: "txn_1", expense: { title: "Cruise", totalMinor: 100, payers: [], split: { method: "equal", participants: [] } } },
      { action: "move", expenseId: "txn_1", toGroupId: "org_2" },
    ];
    expect(drafts.map((d) => d.action)).toEqual(["add", "edit", "move"]);
    const via: Pick<SplitecoActivityEntry, "viaDelegation" | "viaAssistant"> = { viaDelegation: "dlg_1", viaAssistant: "Claude" };
    expect(via.viaAssistant).toBe("Claude");
  });
});
