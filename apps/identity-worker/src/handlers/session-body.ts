import type { LoginCompleteResponse } from "@saas/contracts/auth";
import type { Env } from "../env.js";
import type { CompleteLoginResult } from "../services/auth.js";
import { successResponse } from "../http.js";
import { ensurePersonalOrg } from "../solo-mode.js";

/**
 * The 200 a sign-in answers with: the session body of POST
 * /v1/auth/login/complete, which a passkey sign-in (PK-2) returns exactly too.
 */
export async function sessionBodyResponse(env: Env, requestId: string, result: CompleteLoginResult): Promise<Response> {
  // M0 / Solo profile: ensure the user's one invisible personal workspace
  // exists before the console loads. No-op (and zero latency) off the profile.
  await ensurePersonalOrg(env, requestId, result.user);

  return successResponse<LoginCompleteResponse>(
    {
      token: result.token,
      tokenType: "bearer" as const,
      expiresAt: result.expiresAt.toISOString(),
      user: result.user,
    },
    requestId,
    200,
  );
}
