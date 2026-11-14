import type {
  AddMembersRequest,
  AddMembersResponse,
  AcceptInvitationRequest,
  AcceptInvitationResponse,
  CreateInvitationRequest,
  CreateInvitationResponse,
  JoinCodeResponse,
  JoinPreview,
  JoinPreviewPublic,
  JoinRequest,
  JoinResponse,
  LeaveResponse,
  ListInvitationsResponse,
  ListMembersResponse,
  RemoveMemberResponse,
  RevokeInvitationResponse,
  UpdateMemberRoleRequest,
  UpdateMemberRoleResponse,
} from "@saas/contracts/membership";

import type { RequestOptions, Transport } from "./transport.js";

/**
 * Memberships resource client.
 *
 * Covers the org-facade member, invitation and join-link surface served by
 * `apps/membership-worker`. The flat-method shape mirrors Stripe's
 * `client.invitations.create()` style; sub-resources are namespaced via
 * the verb (`listMembers`, `listInvitations`) so call sites stay grep-able.
 */
export class MembershipsClient {
  constructor(private readonly transport: Transport) {}

  // -------------------------------------------------------------------------
  // Members
  // -------------------------------------------------------------------------

  /** GET /v1/organizations/:orgId/members */
  listMembers(orgId: string, opts: RequestOptions = {}): Promise<ListMembersResponse> {
    return this.transport.request<ListMembersResponse>(
      {
        method: "GET",
        path: `/v1/organizations/${encodeURIComponent(orgId)}/members`,
      },
      opts,
    );
  }

  /**
   * POST /v1/organizations/:orgId/members — add people by subject id from a
   * Spliteco group you share (owner/admin of `orgId` only). Each person is
   * added or skipped with a reason; send an Idempotency-Key.
   */
  addMembers(orgId: string, body: AddMembersRequest, opts: RequestOptions = {}): Promise<AddMembersResponse> {
    return this.transport.request<AddMembersResponse>(
      { method: "POST", path: `/v1/organizations/${encodeURIComponent(orgId)}/members`, body },
      opts,
    );
  }

  /** PATCH /v1/organizations/:orgId/members/:memberId */
  updateMemberRole(
    orgId: string,
    memberId: string,
    body: UpdateMemberRoleRequest,
    opts: RequestOptions = {},
  ): Promise<UpdateMemberRoleResponse> {
    return this.transport.request<UpdateMemberRoleResponse>(
      {
        method: "PATCH",
        path: `/v1/organizations/${encodeURIComponent(orgId)}/members/${encodeURIComponent(memberId)}`,
        body,
      },
      opts,
    );
  }

  /** DELETE /v1/organizations/:orgId/members/:memberId */
  removeMember(
    orgId: string,
    memberId: string,
    opts: RequestOptions = {},
  ): Promise<RemoveMemberResponse> {
    return this.transport.request<RemoveMemberResponse>(
      {
        method: "DELETE",
        path: `/v1/organizations/${encodeURIComponent(orgId)}/members/${encodeURIComponent(memberId)}`,
      },
      opts,
    );
  }

  // -------------------------------------------------------------------------
  // Invitations
  // -------------------------------------------------------------------------

  /** GET /v1/organizations/:orgId/invitations */
  listInvitations(
    orgId: string,
    opts: RequestOptions = {},
  ): Promise<ListInvitationsResponse> {
    return this.transport.request<ListInvitationsResponse>(
      {
        method: "GET",
        path: `/v1/organizations/${encodeURIComponent(orgId)}/invitations`,
      },
      opts,
    );
  }

  /**
   * POST /v1/organizations/:orgId/invitations
   *
   * Pass `idempotencyKey` in `opts` for safe retry semantics.
   */
  createInvitation(
    orgId: string,
    body: CreateInvitationRequest,
    opts: RequestOptions = {},
  ): Promise<CreateInvitationResponse> {
    return this.transport.request<CreateInvitationResponse>(
      {
        method: "POST",
        path: `/v1/organizations/${encodeURIComponent(orgId)}/invitations`,
        body,
      },
      opts,
    );
  }

  /** DELETE /v1/organizations/:orgId/invitations/:invitationId */
  revokeInvitation(
    orgId: string,
    invitationId: string,
    opts: RequestOptions = {},
  ): Promise<RevokeInvitationResponse> {
    return this.transport.request<RevokeInvitationResponse>(
      {
        method: "DELETE",
        path: `/v1/organizations/${encodeURIComponent(orgId)}/invitations/${encodeURIComponent(invitationId)}`,
      },
      opts,
    );
  }

  /**
   * POST /v1/organizations/:orgId/invitations/accept
   *
   * Accept an invitation via the one-time token returned at create time.
   */
  acceptInvitation(
    orgId: string,
    body: AcceptInvitationRequest,
    opts: RequestOptions = {},
  ): Promise<AcceptInvitationResponse> {
    return this.transport.request<AcceptInvitationResponse>(
      {
        method: "POST",
        path: `/v1/organizations/${encodeURIComponent(orgId)}/invitations/accept`,
        body,
      },
      opts,
    );
  }

  // -------------------------------------------------------------------------
  // Join links (a group's shareable code — joining by it needs no approval)
  // -------------------------------------------------------------------------

  /**
   * GET /v1/organizations/:orgId/join-code — the group's join code, minted on
   * first read. Owners and admins only; anyone else gets a `NotFoundError`.
   */
  getJoinCode(orgId: string, opts: RequestOptions = {}): Promise<JoinCodeResponse> {
    return this.transport.request<JoinCodeResponse>(
      {
        method: "GET",
        path: `/v1/organizations/${encodeURIComponent(orgId)}/join-code`,
      },
      opts,
    );
  }

  /**
   * POST /v1/organizations/:orgId/join-code/rotate — replace the code; links
   * with the old one stop working. Owners and admins only.
   */
  rotateJoinCode(orgId: string, opts: RequestOptions = {}): Promise<JoinCodeResponse> {
    return this.transport.request<JoinCodeResponse>(
      {
        method: "POST",
        path: `/v1/organizations/${encodeURIComponent(orgId)}/join-code/rotate`,
      },
      opts,
    );
  }

  /**
   * GET /v1/join/:code — what the join page shows: the group's name, slug and
   * member count, and whether the caller is already in it. An unknown code is
   * a `NotFoundError`.
   */
  previewJoin(code: string, opts: RequestOptions = {}): Promise<JoinPreview> {
    return this.transport.request<JoinPreview>(
      {
        method: "GET",
        path: `/v1/join/${encodeURIComponent(code)}`,
      },
      opts,
    );
  }

  /**
   * GET /v1/join/:code/preview — the join link's group for someone not signed
   * in yet: `{ groupName, inviterFirstName, memberCount }` and nothing else.
   * Needs no session, and sends none: the request carries no credential even
   * from a signed-in client. An unknown, malformed or rotated code is a
   * `NotFoundError`; too many from one network is a `RateLimitError`.
   */
  previewJoinPublic(code: string, opts: RequestOptions = {}): Promise<JoinPreviewPublic> {
    return this.transport.request<JoinPreviewPublic>(
      {
        method: "GET",
        path: `/v1/join/${encodeURIComponent(code)}/preview`,
        anonymous: true,
      },
      opts,
    );
  }

  /**
   * POST /v1/join — join the group the code names, as a member. Resolves for
   * someone already in the group too (`alreadyMember: true`). A full group is
   * a `PreconditionFailedError` with `details.reason`.
   *
   * Pass `idempotencyKey` in `opts` for safe retry semantics. Make it random
   * per join attempt (e.g. `crypto.randomUUID()`), never derived from the code
   * alone: `/v1/join` is not under an org path, so the edge's replay cache is
   * not scoped to a tenant, and a shared key would replay someone else's join.
   */
  join(code: string, opts: RequestOptions = {}): Promise<JoinResponse> {
    const body: JoinRequest = { code };
    return this.transport.request<JoinResponse>(
      {
        method: "POST",
        path: "/v1/join",
        body,
      },
      opts,
    );
  }

  /**
   * POST /v1/organizations/:orgId/leave — the caller leaves the group. The
   * last owner cannot leave while others remain (`ConflictError`,
   * `details.reason: "last_owner"`), and nobody can while they owe or are
   * owed money in it (`ConflictError`, `details.reason: "balance_not_settled"`
   * with `balanceMinor` and `currency`). When the balance cannot be checked,
   * leaving is refused with a 503 (`InternalError`): try again.
   */
  leave(orgId: string, opts: RequestOptions = {}): Promise<LeaveResponse> {
    return this.transport.request<LeaveResponse>(
      {
        method: "POST",
        path: `/v1/organizations/${encodeURIComponent(orgId)}/leave`,
      },
      opts,
    );
  }
}
