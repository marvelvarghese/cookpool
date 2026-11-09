// Keeping a connection alive (design §1, §2).
//
// An assistant's access token lasts an hour and its refresh token rotates on
// every use (the provider). The delegated token in the grant lasts 90 days
// (identity); when a refresh finds it inside its last ROTATE_WITHIN_DAYS,
// identity rotates it (the old token dies at once) and the grant keeps the
// new one, with its new 90 days. When identity says the
// delegation is gone (revoked on Disconnect, or expired), the refresh fails
// with invalid_grant, which also deletes the grant: the assistant has to
// connect again.

import { GrantType, OAuthError, type TokenExchangeCallbackOptions, type TokenExchangeCallbackResult } from "@cloudflare/workers-oauth-provider";
import type { Env, GrantProps } from "./env.js";
import { randomToken } from "./http.js";
import { refreshDelegation } from "./identity.js";

/** Rotate the delegated token when this little of its life is left. */
export const ROTATE_WITHIN_DAYS = 45;
const DAY_MS = 24 * 60 * 60 * 1000;

export async function onTokenExchange(
  options: TokenExchangeCallbackOptions<Env>,
): Promise<TokenExchangeCallbackResult | void> {
  if (options.grantType !== GrantType.REFRESH_TOKEN) return;
  const props = options.props as GrantProps;
  const endsAt = props.delegatedExpiresAt ? Date.parse(props.delegatedExpiresAt) : NaN;
  // Unknown expiry: leave it; a dead token shows up as "Reconnect" on the next call.
  if (!Number.isFinite(endsAt) || endsAt - Date.now() > ROTATE_WITHIN_DAYS * DAY_MS) return;

  const result = await refreshDelegation(options.env, props.delegationId, `req_${randomToken(12)}`);
  if (result.kind === "gone") {
    throw new OAuthError("invalid_grant", { description: "This connection has ended. Connect Cookpool again." });
  }
  if (result.kind === "unavailable") {
    throw new OAuthError("temporarily_unavailable", { description: "Cookpool is unavailable. Try again shortly.", statusCode: 503 });
  }
  const newProps: GrantProps = { ...props, delegatedToken: result.token, delegatedExpiresAt: result.expiresAt };
  return { newProps, accessTokenProps: newProps };
}
