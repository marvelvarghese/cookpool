"use client";

/**
 * The account remembered on this device (Cookpool PK-3): who signed in here
 * last, by name and email, and how (Google or the email code), so Sign in
 * can say "Welcome back, Rahul" and offer "Continue as Rahul". Saved after
 * each successful sign-in; "Use another account" forgets it.
 *
 * Unlike the first-run records (`first-run.ts`), it outlives signing out:
 * welcoming the person back after they signed out is what it is for. It
 * holds no token and nothing the sign-in page did not already show.
 *
 * Beside it, in this tab only (sessionStorage), the address last typed on the
 * sign-in page, so Can't sign in? can say which address the code went to and
 * "Send a new code" comes back with it filled in.
 */

import { appConfig } from "./app-config";
import { parseRememberedAccount, rememberedFrom, type RememberedAccount, type RememberedMethod } from "@/components/kitchen/sign-in-screens";

// Built per call: the storage prefix is runtime config (saas-console-artifact CA1).
const accountKey = (): string => `${appConfig().storagePrefix}.remembered-account`;
const typedKey = (): string => `${appConfig().storagePrefix}.login-email`;

function store(kind: "local" | "session"): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return kind === "local" ? window.localStorage : window.sessionStorage;
  } catch {
    return null;
  }
}

export function readRememberedAccount(): RememberedAccount | null {
  try {
    return parseRememberedAccount(store("local")?.getItem(accountKey()));
  } catch {
    return null;
  }
}

export function writeRememberedAccount(account: RememberedAccount | null): void {
  try {
    const s = store("local");
    if (!s) return;
    if (account) s.setItem(accountKey(), JSON.stringify(account));
    else s.removeItem(accountKey());
  } catch {
    /* ignore: without storage there is no "Welcome back" */
  }
}

/** Remember who just signed in, and how. */
export function rememberAccount(user: { email: string; displayName?: string | null }, method: RememberedMethod): void {
  const account = rememberedFrom(user, method);
  if (account) writeRememberedAccount(account);
}

/** A name was just saved (Create account, the Name step): the remembered account takes it, if it is this person's. */
export function rememberAccountName(email: string, name: string): void {
  const current = readRememberedAccount();
  if (current && current.email.toLowerCase() === email.trim().toLowerCase()) {
    writeRememberedAccount({ ...current, name: name.trim() });
  }
}

/** "Use another account". */
export function forgetRememberedAccount(): void {
  writeRememberedAccount(null);
}

export function rememberTypedEmail(email: string): void {
  try {
    const s = store("session");
    if (!s) return;
    if (email.trim()) s.setItem(typedKey(), email.trim());
    else s.removeItem(typedKey());
  } catch {
    /* ignore */
  }
}

export function typedEmail(): string | null {
  try {
    return store("session")?.getItem(typedKey()) ?? null;
  } catch {
    return null;
  }
}
