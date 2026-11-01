/**
 * M0 / Solo profile — the console (UI) side of the single SOLO_MODE switch.
 *
 * The api-edge ENFORCES the profile (404s suppressed routes); this flag makes
 * the console match it: hide org/team/project surfaces, drop the org switcher,
 * relabel "Organization" → "Account", and land on the one auto-provisioned
 * personal workspace. See specs/profiles/solo-m0.md.
 *
 * Sourced from `NEXT_PUBLIC_SOLO_MODE`, inlined at build time (next.config.mjs
 * defaults it to "true" for this Cookpool instance). Set it to "false" and rebuild
 * to restore the full multi-tenant baseline — nothing here is removed, only
 * gated, so the switch is fully reversible.
 */

// Module-scoped typing for the build-time env. The literal
// `process.env.NEXT_PUBLIC_SOLO_MODE` is what Next's DefinePlugin inlines, so it
// must stay verbatim. This local declaration lets the (node-types-free) test
// compiler type-check this file while shadowing harmlessly under the app build.
declare const process: { env: Record<string, string | undefined> } | undefined;

export const SOLO_MODE: boolean =
  typeof process !== "undefined" && process.env.NEXT_PUBLIC_SOLO_MODE === "true";

/**
 * An org's landing page under the active profile: its projects in the
 * baseline, its Account (settings) surface in Solo, where projects are
 * suppressed at the edge and the projects page could only show
 * "Route not found: /v1/organizations/<id>/projects". Every link that means
 * "this org's home" goes through here, never a hard-coded `/projects`.
 */
export function orgHomePath(orgSlug: string, soloMode: boolean = SOLO_MODE): string {
  return soloMode ? `/orgs/${orgSlug}/settings` : `/orgs/${orgSlug}/projects`;
}

/** The tenant noun shown in user-facing copy under the active profile. In Solo
 *  the user IS the tenant, so the organization reads as their "Account". */
export const TENANT_NOUN: string = SOLO_MODE ? "Account" : "Organization";
