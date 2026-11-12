"use client";

// Sign in with a passkey (SE3): the same passkeys as Cookpool — identity-worker
// takes this app's origin under Cookpool's RP ID (WebAuthn related origins,
// listed at Cookpool's /.well-known/webauthn). The browser's sheet, then the
// session body identity answers a code sign-in with.

import { startAuthentication, type PublicKeyCredentialRequestOptionsJSON } from "@simplewebauthn/browser";
import type { LoginCompleteResponse } from "@saas/contracts/auth";
import type { PasskeyAuthenticationResponseJSON } from "@saas/contracts/passkeys";
import type { Cookpool } from "@saas/sdk";

/** WebAuthn exists here (a secure page in a browser that has it). */
export function passkeysRunHere(): boolean {
  return typeof window !== "undefined" && window.isSecureContext && typeof window.PublicKeyCredential === "function";
}

/** The sheet, then the session; null when the person closed the sheet. */
export async function passkeySignIn(client: Cookpool): Promise<LoginCompleteResponse | null> {
  const { options } = await client.auth.passkeyLoginOptions();
  let response: PasskeyAuthenticationResponseJSON;
  try {
    response = (await startAuthentication({ optionsJSON: options as PublicKeyCredentialRequestOptionsJSON })) as PasskeyAuthenticationResponseJSON;
  } catch (err) {
    if (err instanceof Error && (err.name === "NotAllowedError" || err.name === "AbortError")) return null;
    throw err;
  }
  return client.auth.passkeyLoginVerify({ response });
}
