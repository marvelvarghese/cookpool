// Join-link contracts (Cookpool CP-3): the shapes membership-worker answers
// with and the SDK returns. Mostly compile-time — a field renamed on one side
// breaks this file — plus the error vocabulary the routes rely on, which is
// the pinned ERROR_CODES set (no new codes: reasons ride in `details.reason`).

import type {
  JoinCodeResponse,
  JoinPreview,
  JoinRequest,
  JoinResponse,
  LeaveResponse,
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

  it("answers refusals with existing error codes", () => {
    // A full group / too many groups → 412; the last owner leaving → 409.
    expect(ERROR_CODES.PRECONDITION_FAILED).toBe("precondition_failed");
    expect(ERROR_CODES.CONFLICT).toBe("conflict");
    expect(ERROR_CODES.NOT_FOUND).toBe("not_found");
  });
});
