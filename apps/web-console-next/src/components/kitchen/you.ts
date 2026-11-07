/**
 * You (Cookpool SI-6, design §7, the `Account` artboard): your initials, name
 * and email; "Change your name"; "How you sign in"; "Sign out of this phone".
 * Pure (no React, no SDK) so it is unit-testable; `app/(kitchen)/you/page.tsx`
 * renders it. The name rules are the Name step's (`sign-in.ts`), so a name is
 * cleaned the same way wherever it is chosen.
 */

import { qk } from "@/lib/query-keys";
import { cleanDisplayName } from "./sign-in";
import { nameInitials } from "./members";

export const YOU_TITLE = "You";
export const CHANGE_NAME = "Change your name";
export const HOW_YOU_SIGN_IN = "How you sign in";
/** Below 900px (the artboard); "this device" from 900px, where it is rarely a phone. */
export const SIGN_OUT_PHONE = "Sign out of this phone";
export const SIGN_OUT_DEVICE = "Sign out of this device";
export const LAST_USED = "Last used";

interface Person {
  email: string;
  displayName: string | null;
}

/**
 * The name your groups see: the one you chose, else the part of your email
 * before the @ — CP-9's fallback, the same one kitchen-worker gives everyone
 * else — so You never shows a name nobody else sees.
 */
export function shownName(user: Person): string {
  return cleanDisplayName(user.displayName) || (user.email.split("@")[0] ?? "").trim() || user.email;
}

/** Your avatar's initials, from the name your groups see ("Rahul Varghese" → "RV", "anu" → "A"). */
export function personInitials(user: Person): string {
  return nameInitials(shownName(user));
}

/**
 * The name to save from the edit field, or null when there is nothing to
 * save: empty (a name cannot be taken away here, only changed) or the same
 * as now.
 */
export function nameToSave(current: string | null, draft: string): string | null {
  const next = cleanDisplayName(draft);
  if (next === "" || next === cleanDisplayName(current)) return null;
  return next;
}

export type SignInWay = "google" | "code";

export interface SignInRow {
  way: SignInWay;
  label: string;
  /** This device's last sign-in was this way. */
  lastUsed: boolean;
}

/**
 * "How you sign in". identity-worker's profile does not say which providers
 * are linked to a person, so Google is listed only when this device's last
 * sign-in was Google (`lastSignInMethod`). A code to the address always
 * works: identity-worker signs anyone in by a code to their email. "Last
 * used" only when there is a choice (SM-15: the audit found it on the only
 * way there was).
 */
export function signInRows(email: string, last: SignInWay | null): SignInRow[] {
  const rows: SignInRow[] = [];
  if (last === "google") rows.push({ way: "google", label: "Google", lastUsed: true });
  rows.push({ way: "code", label: `A code to ${email}`, lastUsed: last === "code" && rows.length > 0 });
  return rows;
}

/**
 * The reads to refresh after a rename (besides the profile itself, which is
 * written in place): everything that carries people's names (CP-9) — your
 * balances, the people and person views and the inbox (`kitchenMe`), and
 * every group's member list.
 */
export const NAME_READS = [qk.kitchenMe(), qk.kitchenMembersAll()] as const;
