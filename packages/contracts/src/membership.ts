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

/**
 * GET /v1/join/:code/preview — the join link's group for someone not signed
 * in yet (Cookpool SI-4): what the sign-in page says ("Sign in to join Flat 4B
 * · Anu invited you · 5 people are in"). No session: api-edge routes it behind
 * its signed-out per-IP rate limit, with `Cache-Control: no-store`.
 *
 * These three fields and nothing else: no ids, no slug, no other names, no
 * email. An unknown, malformed or rotated code, or a group that is not
 * active, answers the same 404 `not_found`.
 */
export interface JoinPreviewPublic {
  /** The group's name. */
  groupName: string;
  /**
   * The first word of the inviter's display name. The inviter is the group's
   * first owner (the earliest-joined member holding the owner role): a join
   * code does not record who minted or rotated it. Null when they have set no
   * name or it cannot be read; never their email or any part of it.
   */
  inviterFirstName: string | null;
  /** Active members holding a group role (owner, admin, member or viewer). */
  memberCount: number;
}

/** Every key {@link JoinPreviewPublic} has; anything else on the wire would be a leak. */
export const JOIN_PREVIEW_PUBLIC_KEYS = ["groupName", "inviterFirstName", "memberCount"] as const;

/** The most people one add-members call takes. */
export const ADD_MEMBERS_MAX = 50;

/** Why a person was not added (never fails the call). */
export const ADD_MEMBER_SKIP_REASONS = ["not_in_source_group", "already_member", "groups_per_person", "group_full"] as const;
export type AddMemberSkipReason = (typeof ADD_MEMBER_SKIP_REASONS)[number];

/**
 * POST /v1/organizations/:orgId/members (MY-17) — add people who already share
 * a Spliteco group with the caller, by subject id, as members (`builder`).
 * The caller must be an owner or admin of `:orgId` AND an active member of
 * `sourceGroupId`, a Spliteco group; only people in that group are added. 200
 * with who was added and who was skipped and why; one skip never fails it. A
 * caller who is not allowed gets 404 (the group) or 403 `not_in_source_group`.
 */
export interface AddMembersRequest {
  sourceGroupId: string;
  subjectIds: string[];
}

export interface AddMembersResponse {
  orgId: string;
  added: { subjectId: string; memberId: string }[];
  skipped: { subjectId: string; reason: AddMemberSkipReason }[];
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
 * `details.reason: "last_owner"`. Nobody can leave while they owe or are owed
 * money in the group (Cookpool CP-19): 409 `conflict` with
 * `details.reason: "balance_not_settled"`, `details.balanceMinor` (positive:
 * they are owed) and `details.currency`. membership-worker asks kitchen-worker
 * for the balance; when it cannot answer, leaving fails closed with 503
 * `internal_error` — nobody leaves owing because of an outage.
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
  /**
   * Their membership's public id (`mem_…`), which the member routes take
   * (`PATCH /v1/organizations/{org}/members/{memberId}` changes a role).
   * Since Cookpool CP-9.
   */
  memberId: string;
  /** When they joined (ISO 8601). Since Cookpool CP-9. */
  joinedAt: string;
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
  /** Where the group was made (cookpool-spliteco, migration 530): `cookpool` or `spliteco`. */
  madeIn?: string;
  /** kitchen | trip | home | couple | other | direct (migration 530). */
  kind?: string;
  /**
   * With `?view=spliteco` only: the organization's active members and each
   * one's highest organization role (null when they hold none).
   */
  members?: { subjectId: string; subjectType: string; role: string | null }[];
}

export interface SubjectOrganizationsResponse {
  organizations: SubjectOrganization[];
}

/**
 * `GET /v1/internal/membership/subjects/:subjectId/organizations?view=spliteco`
 * (cookpool-spliteco SE1): the hidden two-person `direct` groups are left out
 * of the default answer (and of every Cookpool list); this view includes them
 * and each organization's members.
 */
export const SUBJECT_ORGANIZATIONS_SPLITECO_VIEW = "spliteco";

/**
 * `POST /v1/internal/membership/direct-groups` (cookpool-spliteco SE1,
 * service-internal): find or make the hidden two-person organization
 * (`kind = 'direct'`, `made_in = 'spliteco'`) two people share expenses
 * outside any group in. Both are owners. The same pair always gets the same
 * organization.
 */
export interface DirectGroupRequest {
  subjects: [{ id: string; type: string }, { id: string; type: string }];
}

export interface DirectGroupResponse {
  organization: { orgId: string; slug: string; name: string; madeIn: string; kind: string };
  created: boolean;
}
