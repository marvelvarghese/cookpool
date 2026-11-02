// Join-link contracts (Cookpool CP-3): the shapes membership-worker answers
// with and the SDK returns. Mostly compile-time — a field renamed on one side
// breaks this file — plus the error vocabulary the routes rely on, which is
// the pinned ERROR_CODES set (no new codes: reasons ride in `details.reason`).

import {
  JOIN_PREVIEW_PUBLIC_KEYS,
  type JoinCodeResponse,
  type JoinPreview,
  type JoinPreviewPublic,
  type JoinRequest,
  type JoinResponse,
  type LeaveResponse,
} from "@saas/contracts/membership";
import { ERROR_CODES } from "@saas/contracts/errors";

describe("contracts: join links", () => {
  it("describes the join-code, preview, join and leave payloads", () => {
    const code: JoinCodeResponse = { code: "KTCH2345" };
    const preview: JoinPreview = {
      orgId: "org_0123456789abcdef0123456789abcdef",
      name: "Flat 4B",
      slug: "flat-4b",
      memberCount: 4,
      alreadyMember: false,
    };
    const request: JoinRequest = { code: code.code };
    const joined: JoinResponse = { orgId: preview.orgId, slug: preview.slug, memberId: "mem_x", alreadyMember: false };
    const left: LeaveResponse = { orgId: preview.orgId, memberId: joined.memberId, left: true };

    expect(request.code).toBe("KTCH2345");
    expect(Object.keys(preview).sort()).toEqual(["alreadyMember", "memberCount", "name", "orgId", "slug"]);
    expect(Object.keys(joined).sort()).toEqual(["alreadyMember", "memberId", "orgId", "slug"]);
    expect(left.left).toBe(true);
  });

  it("describes the signed-out preview as three fields and no more (Cookpool SI-4)", () => {
    const named: JoinPreviewPublic = { groupName: "Flat 4B", inviterFirstName: "Anu", memberCount: 5 };
    const unnamed: JoinPreviewPublic = { groupName: "Flat 4B", inviterFirstName: null, memberCount: 1 };

    expect([...JOIN_PREVIEW_PUBLIC_KEYS]).toEqual(["groupName", "inviterFirstName", "memberCount"]);
    expect(Object.keys(named).sort()).toEqual([...JOIN_PREVIEW_PUBLIC_KEYS].sort());
    expect(Object.keys(unnamed).sort()).toEqual([...JOIN_PREVIEW_PUBLIC_KEYS].sort());
    // Nothing the signed-in preview carries that identifies the group.
    for (const key of ["orgId", "slug", "alreadyMember"]) {
      expect(JOIN_PREVIEW_PUBLIC_KEYS as readonly string[]).not.toContain(key);
    }
    // Compile-time: no field beyond the three.
    // @ts-expect-error — the signed-out preview has no orgId
    const withId: JoinPreviewPublic = { ...named, orgId: "org_x" };
    expect(withId.groupName).toBe("Flat 4B");
  });

  it("answers refusals with existing error codes", () => {
    // A full group / too many groups → 412; the last owner leaving → 409.
    expect(ERROR_CODES.PRECONDITION_FAILED).toBe("precondition_failed");
    expect(ERROR_CODES.CONFLICT).toBe("conflict");
    expect(ERROR_CODES.NOT_FOUND).toBe("not_found");
    // The signed-out preview: an unknown code → 404, too many from one IP → 429.
    expect(ERROR_CODES.RATE_LIMITED).toBe("rate_limited");
  });
});
