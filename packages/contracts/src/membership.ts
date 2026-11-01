export interface PublicOrganization {
  id: string;
  name: string;
  slug: string;
  /**
   * Lifecycle status (e.g. 'active', 'suspended'). Optional — populated by the
   * organization list so the console can surface a frozen-child warning (MO3);
   * other endpoints may omit it.
   */
  status?: string;
  createdAt: string;
}

export interface CreateOrganizationRequest {
  name: string;
  slug?: string;
}

export interface CreateOrganizationResponse {
  organization: PublicOrganization;
  membership: {
    role: string;
    joinedAt: string;
  };
}

export interface ListOrganizationsResponse {
  organizations: PublicOrganization[];
}

export interface GetOrganizationResponse {
  organization: PublicOrganization;
}

export interface PublicMemberRoleAssignment {
  role: string;
  scopeKind: string;
}

export interface PublicMember {
  id: string;
  subjectType: string;
  subjectId: string;
  status: string;
  joinedAt: string;
  roles: PublicMemberRoleAssignment[];
}

export interface ListMembersResponse {
  members: PublicMember[];
}

export const ORGANIZATION_ROLES = ["owner", "admin", "builder", "viewer", "billing_admin"] as const;
export type InvitationRole = (typeof ORGANIZATION_ROLES)[number];

export interface CreateInvitationRequest {
  email: string;
  role: InvitationRole;
}

export interface PublicInvitation {
  id: string;
  email: string;
  role: string;
  status: string;
  invitedBy: string;
  expiresAt: string;
  createdAt: string;
  acceptedAt: string | null;
  revokedAt: string | null;
}

export interface CreateInvitationResponse {
  invitation: PublicInvitation;
  delivery?: { mode: string; token: string };
}

export interface ListInvitationsResponse {
  invitations: PublicInvitation[];
}

export interface RevokeInvitationResponse {
  invitation: PublicInvitation;
}

export interface UpdateMemberRoleRequest {
  role: string;
}

export interface UpdateMemberRoleResponse {
  member: PublicMember;
}

export interface RemoveMemberResponse {
  member: PublicMember;
}

export interface AcceptInvitationRequest {
  token: string;
}

export interface AcceptInvitationResponse {
  invitation: PublicInvitation;
  membership: {
    id: string;
    role: string;
    joinedAt: string;
    status: string;
  };
}

// ── Join links (Cookpool CP-3) ───────────────────────────────────
// Every organization (a Cookpool group) has a shareable join code. A
// signed-in person who opens the link sees the group and joins it in one
// step, as a `builder` ("member" in the app) — there is no approval queue.
// Owners and admins read and rotate the code; any member can leave.

/**
 * GET  /v1/organizations/:orgId/join-code         — owner/admin; minted on first read.
 * POST /v1/organizations/:orgId/join-code/rotate  — owner/admin; the old code stops working.
 */
export interface JoinCodeResponse {
  /** 8 characters from an alphabet without look-alikes (no 0/O, 1/I/L). */
  code: string;
}

/** GET /v1/join/:code — what the join page shows; any signed-in person. */
export interface JoinPreview {
  orgId: string;
  name: string;
  slug: string;
  /** Active members (pending invitations are not counted). */
  memberCount: number;
  /** True when the caller is already an active member of the group. */
  alreadyMember: boolean;
}

/** POST /v1/join — the code is case-insensitive; spaces and dashes are ignored. */
export interface JoinRequest {
  code: string;
}

/**
 * POST /v1/join — 201 when the caller joined now, 200 (alreadyMember: true)
 * when they were already in the group. A full group answers 412
 * `precondition_failed` with `details.reason` (`limit_reached`, or the
 * billing reason); a person already in the most groups allowed answers 412
 * with `details.reason: "groups_per_person"`.
 */
export interface JoinResponse {
  orgId: string;
  slug: string;
  memberId: string;
  alreadyMember: boolean;
}

/**
 * POST /v1/organizations/:orgId/leave — the caller leaves. The last owner
 * cannot leave while anyone else is still in the group: 409 `conflict` with
 * `details.reason: "last_owner"`.
 */
export interface LeaveResponse {
  orgId: string;
  memberId: string;
  left: true;
}

// ── The group roster (service-internal, Cookpool CP-7) ───────────
// GET /v1/internal/membership/organizations/:orgId/members — for sibling
// workers over a service binding only (api-edge does not route
// /v1/internal/…). kitchen-worker reads it to check that everyone a
// transaction names is in the group. `:orgId` is the organization's UUID (or
// its `org_…` public id); an organization with nobody in it, or none at all,
// answers an empty list.

/** One active member and their highest organization-scoped role. */
export interface RosterMember {
  /** The person's public id (`usr_…`), as role assignments store it. */
  subjectId: string;
  subjectType: string;
  /** owner > admin > builder > viewer > billing_admin; null when they hold no organization-scoped role. */
  role: string | null;
}

export interface RosterResponse {
  members: RosterMember[];
}

// ── A person's groups (service-internal, Cookpool CP-10) ───────────
// GET /v1/internal/membership/subjects/:subjectId/organizations — for sibling
// workers over a service binding only (api-edge does not route
// /v1/internal/…). kitchen-worker reads it for "every pantry I can reach": the
// all-pantries view and search. Active memberships of active organizations,
// by name; a subject in none answers an empty list.

/** One organization the subject is an active member of, and their highest organization-scoped role in it. */
export interface SubjectOrganization {
  /** The organization's public id (`org_…`). */
  orgId: string;
  slug: string;
  name: string;
  /** owner > admin > builder > viewer > billing_admin; null when they hold no organization-scoped role. */
  role: string | null;
}

export interface SubjectOrganizationsResponse {
  organizations: SubjectOrganization[];
}
