import type { Env } from "./env.js";
import { handleHealth } from "./handlers/health.js";
import { handleCreateOrganization } from "./handlers/create-organization.js";
import { handleListOrganizations } from "./handlers/list-organizations.js";
import { handleGetOrganization } from "./handlers/get-organization.js";
import { handleListMembers } from "./handlers/list-members.js";
import { handleUpdateMemberRole } from "./handlers/update-member-role.js";
import { handleRemoveMember } from "./handlers/remove-member.js";
import { handleCreateInvitation } from "./handlers/create-invitation.js";
import { handleListInvitations } from "./handlers/list-invitations.js";
import { handleRevokeInvitation } from "./handlers/revoke-invitation.js";
import { handleAcceptInvitation } from "./handlers/accept-invitation.js";
import { handleAuthorizationContext } from "./handlers/authorization-context.js";
import { handleSyncAccountChildren } from "./handlers/sync-account-children.js";
import { handleResolveBillingParent } from "./handlers/resolve-billing-parent.js";
import { handleCreateServicePrincipalBinding, handleListServicePrincipalBindings, handleRevokeServicePrincipalBinding } from "./handlers/service-principal-bindings.js";
import { handleGetJoinCode, handleRotateJoinCode, handlePreviewJoin, handleJoin } from "./handlers/join.js";
import { handlePublicJoinPreview } from "./handlers/join-preview-public.js";
import { handleLeaveOrganization } from "./handlers/leave.js";
import { handleInternalMembers } from "./handlers/internal-members.js";
import { handleInternalSubjectOrganizations } from "./handlers/internal-subject-organizations.js";
import { errorResponse, notFound, methodNotAllowed } from "./http.js";
import { generateRequestId } from "./ids.js";

const REQUEST_ID_RE = /^[\w-]{1,128}$/;

export interface ActorContext {
  subjectId: string;
  subjectType: string;
}

function resolveRequestId(request: Request): string {
  const header = request.headers.get("x-request-id");
  if (header && REQUEST_ID_RE.test(header)) return header;
  return generateRequestId();
}

function resolveActor(request: Request): ActorContext | null {
  const subjectId = request.headers.get("x-actor-subject-id");
  const subjectType = request.headers.get("x-actor-subject-type");
  if (!subjectId || !subjectType) return null;
  return { subjectId, subjectType };
}

const ORG_ID_RE = /^\/v1\/organizations\/([^/]+)$/;
const ORG_MEMBERS_RE = /^\/v1\/organizations\/([^/]+)\/members$/;
const ORG_MEMBER_ID_RE = /^\/v1\/organizations\/([^/]+)\/members\/([^/]+)$/;
const ORG_INVITATIONS_ACCEPT_RE = /^\/v1\/organizations\/([^/]+)\/invitations\/accept$/;
const ORG_INVITATIONS_RE = /^\/v1\/organizations\/([^/]+)\/invitations$/;
const ORG_INVITATION_ID_RE = /^\/v1\/organizations\/([^/]+)\/invitations\/([^/]+)$/;
// Join links (Cookpool CP-3) — see ./handlers/join.ts and ./handlers/leave.ts.
const JOIN_PATH = "/v1/join";
const JOIN_CODE_PREVIEW_RE = /^\/v1\/join\/([^/]+)$/;
// The signed-out preview (Cookpool SI-4): exactly one code segment, then
// `/preview`; no actor — see ./handlers/join-preview-public.ts.
const JOIN_CODE_PUBLIC_PREVIEW_RE = /^\/v1\/join\/([^/]+)\/preview$/;
const ORG_JOIN_CODE_RE = /^\/v1\/organizations\/([^/]+)\/join-code$/;
const ORG_JOIN_CODE_ROTATE_RE = /^\/v1\/organizations\/([^/]+)\/join-code\/rotate$/;
const ORG_LEAVE_RE = /^\/v1\/organizations\/([^/]+)\/leave$/;
const SP_BINDINGS_PATH = "/v1/internal/membership/service-principal-bindings";
const SP_BINDING_ID_RE = /^\/v1\/internal\/membership\/service-principal-bindings\/([^/]+)$/;
const INTERNAL_ORG_MEMBERS_RE = /^\/v1\/internal\/membership\/organizations\/([^/]+)\/members$/;
const INTERNAL_SUBJECT_ORGS_RE = /^\/v1\/internal\/membership\/subjects\/([^/]+)\/organizations$/;

export async function route(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const requestId = resolveRequestId(request);

  try {
    if (url.pathname === "/health" && request.method === "GET") {
      return handleHealth(env, requestId);
    }

    if (url.pathname === "/v1/internal/membership/authorization-context") {
      if (request.method === "POST") {
        return handleAuthorizationContext(request, env, requestId);
      }
      return methodNotAllowed(requestId);
    }

    // Internal child re-sync (MO3): billing-worker calls this after a billing
    // parent's plan changes to re-fan-out (upgrade) or freeze (downgrade) its
    // children. Service-binding only — not routed by api-edge.
    if (url.pathname === "/v1/internal/membership/account/children-sync") {
      if (request.method === "POST") {
        return handleSyncAccountChildren(request, env, requestId);
      }
      return methodNotAllowed(requestId);
    }

    // Internal billing-parent resolution (MO4): billing-worker resolves a child
    // org to the parent whose subscription covers it. Service-binding only.
    if (url.pathname === "/v1/internal/membership/organizations/billing-parent") {
      if (request.method === "POST") {
        return handleResolveBillingParent(request, env, requestId);
      }
      return methodNotAllowed(requestId);
    }

    // Internal group roster (Cookpool CP-7): kitchen-worker checks that the
    // people a transaction names are in the group. Service-binding only — not
    // routed by api-edge.
    const internalMembersMatch = url.pathname.match(INTERNAL_ORG_MEMBERS_RE);
    if (internalMembersMatch) {
      if (request.method === "GET") {
        return handleInternalMembers(env, requestId, internalMembersMatch[1]!);
      }
      return methodNotAllowed(requestId);
    }

    // Internal: a person's groups (Cookpool CP-10): kitchen-worker reads every
    // pantry a person can reach. Service-binding only — not routed by api-edge.
    const internalSubjectOrgsMatch = url.pathname.match(INTERNAL_SUBJECT_ORGS_RE);
    if (internalSubjectOrgsMatch) {
      if (request.method === "GET") {
        return handleInternalSubjectOrganizations(env, requestId, internalSubjectOrgsMatch[1]!);
      }
      return methodNotAllowed(requestId);
    }

    // Internal service-principal binding routes
    const spBindingIdMatch = url.pathname.match(SP_BINDING_ID_RE);
    if (spBindingIdMatch) {
      if (request.method === "DELETE") {
        return handleRevokeServicePrincipalBinding(env, requestId, spBindingIdMatch[1]!, url);
      }
      return methodNotAllowed(requestId);
    }

    if (url.pathname === SP_BINDINGS_PATH) {
      if (request.method === "POST") {
        return handleCreateServicePrincipalBinding(request, env, requestId);
      }
      if (request.method === "GET") {
        return handleListServicePrincipalBindings(env, requestId, url);
      }
      return methodNotAllowed(requestId);
    }

    if (url.pathname === "/v1/organizations") {
      if (request.method === "POST") {
        const actor = resolveActor(request);
        if (!actor) {
          return errorResponse("unauthenticated", "Authentication required", 401, requestId);
        }
        return handleCreateOrganization(request, env, requestId, actor);
      }
      if (request.method === "GET") {
        const actor = resolveActor(request);
        if (!actor) {
          return errorResponse("unauthenticated", "Authentication required", 401, requestId);
        }
        return handleListOrganizations(env, requestId, actor, url);
      }
      return methodNotAllowed(requestId);
    }

    if (url.pathname === JOIN_PATH) {
      if (request.method === "POST") {
        const actor = resolveActor(request);
        if (!actor) {
          return errorResponse("unauthenticated", "Authentication required", 401, requestId);
        }
        return handleJoin(request, env, requestId, actor);
      }
      return methodNotAllowed(requestId);
    }

    const joinPreviewMatch = url.pathname.match(JOIN_CODE_PREVIEW_RE);
    if (joinPreviewMatch) {
      if (request.method === "GET") {
        const actor = resolveActor(request);
        if (!actor) {
          return errorResponse("unauthenticated", "Authentication required", 401, requestId);
        }
        return handlePreviewJoin(env, requestId, actor, joinPreviewMatch[1]!);
      }
      return methodNotAllowed(requestId);
    }

    // No actor is read here, on purpose: this answers people with no account,
    // and any x-actor-* header sent with it is ignored.
    const joinPublicPreviewMatch = url.pathname.match(JOIN_CODE_PUBLIC_PREVIEW_RE);
    if (joinPublicPreviewMatch) {
      if (request.method === "GET") {
        return handlePublicJoinPreview(env, requestId, joinPublicPreviewMatch[1]!);
      }
      return methodNotAllowed(requestId);
    }

    const joinCodeMatch = url.pathname.match(ORG_JOIN_CODE_RE);
    if (joinCodeMatch) {
      if (request.method === "GET") {
        const actor = resolveActor(request);
        if (!actor) {
          return errorResponse("unauthenticated", "Authentication required", 401, requestId);
        }
        return handleGetJoinCode(env, requestId, actor, joinCodeMatch[1]!);
      }
      return methodNotAllowed(requestId);
    }

    const joinCodeRotateMatch = url.pathname.match(ORG_JOIN_CODE_ROTATE_RE);
    if (joinCodeRotateMatch) {
      if (request.method === "POST") {
        const actor = resolveActor(request);
        if (!actor) {
          return errorResponse("unauthenticated", "Authentication required", 401, requestId);
        }
        return handleRotateJoinCode(env, requestId, actor, joinCodeRotateMatch[1]!);
      }
      return methodNotAllowed(requestId);
    }

    const leaveMatch = url.pathname.match(ORG_LEAVE_RE);
    if (leaveMatch) {
      if (request.method === "POST") {
        const actor = resolveActor(request);
        if (!actor) {
          return errorResponse("unauthenticated", "Authentication required", 401, requestId);
        }
        return handleLeaveOrganization(env, requestId, actor, leaveMatch[1]!);
      }
      return methodNotAllowed(requestId);
    }

    const acceptMatch = url.pathname.match(ORG_INVITATIONS_ACCEPT_RE);
    if (acceptMatch) {
      if (request.method === "POST") {
        const actor = resolveActor(request);
        if (!actor) {
          return errorResponse("unauthenticated", "Authentication required", 401, requestId);
        }
        const actorEmail = request.headers.get("x-actor-email");
        if (!actorEmail) {
          return errorResponse("unauthenticated", "Authentication required", 401, requestId);
        }
        return handleAcceptInvitation(request, env, requestId, { ...actor, email: actorEmail }, acceptMatch[1]!);
      }
      return methodNotAllowed(requestId);
    }

    const invitationIdMatch = url.pathname.match(ORG_INVITATION_ID_RE);
    if (invitationIdMatch) {
      if (request.method === "DELETE") {
        const actor = resolveActor(request);
        if (!actor) {
          return errorResponse("unauthenticated", "Authentication required", 401, requestId);
        }
        return handleRevokeInvitation(env, requestId, actor, invitationIdMatch[1]!, invitationIdMatch[2]!);
      }
      return methodNotAllowed(requestId);
    }

    const invitationsMatch = url.pathname.match(ORG_INVITATIONS_RE);
    if (invitationsMatch) {
      if (request.method === "POST") {
        const actor = resolveActor(request);
        if (!actor) {
          return errorResponse("unauthenticated", "Authentication required", 401, requestId);
        }
        return handleCreateInvitation(request, env, requestId, actor, invitationsMatch[1]!);
      }
      if (request.method === "GET") {
        const actor = resolveActor(request);
        if (!actor) {
          return errorResponse("unauthenticated", "Authentication required", 401, requestId);
        }
        return handleListInvitations(env, requestId, actor, invitationsMatch[1]!, url);
      }
      return methodNotAllowed(requestId);
    }

    const orgMembersMatch = url.pathname.match(ORG_MEMBERS_RE);
    if (orgMembersMatch) {
      if (request.method === "GET") {
        const actor = resolveActor(request);
        if (!actor) {
          return errorResponse("unauthenticated", "Authentication required", 401, requestId);
        }
        return handleListMembers(env, requestId, actor, orgMembersMatch[1]!, url);
      }
      return methodNotAllowed(requestId);
    }

    const memberIdMatch = url.pathname.match(ORG_MEMBER_ID_RE);
    if (memberIdMatch) {
      const actor = resolveActor(request);
      if (!actor) {
        return errorResponse("unauthenticated", "Authentication required", 401, requestId);
      }
      if (request.method === "PATCH") {
        return handleUpdateMemberRole(request, env, requestId, actor, memberIdMatch[1]!, memberIdMatch[2]!);
      }
      if (request.method === "DELETE") {
        return handleRemoveMember(env, requestId, actor, memberIdMatch[1]!, memberIdMatch[2]!);
      }
      return methodNotAllowed(requestId);
    }

    const orgMatch = url.pathname.match(ORG_ID_RE);
    if (orgMatch) {
      if (request.method === "GET") {
        const actor = resolveActor(request);
        if (!actor) {
          return errorResponse("unauthenticated", "Authentication required", 401, requestId);
        }
        return handleGetOrganization(env, requestId, actor, orgMatch[1]!);
      }
      return methodNotAllowed(requestId);
    }

    return notFound(requestId, url.pathname);
  } catch {
    return errorResponse("internal_error", "An unexpected error occurred", 500, requestId);
  }
}
