// Which sign-in codes are shown on screen instead of emailed (Cookpool SI-2).
//
// DEBUG_DELIVERY_DOMAINS is a comma-separated list of email domains whose codes
// login/start returns inline (`delivery.code`, mode `local_debug`) and does not
// email. `*` means every domain. Local and dev carry `*`, stage
// `cookpool.test` (testers sign in as name@cookpool.test), prod nothing. An
// address outside the list is emailed and its code never leaves the worker.
//
// It replaced DEBUG_DELIVERY=true, which put every code on screen on stage, so
// anyone could sign in to stage as anyone. `wrangler deploy` replaces a
// worker's vars with the ones in its config (no keep_vars here), so no deployed
// identity-worker carries the old flag next to this code; it is not read.

export interface DebugDeliveryDomains {
  /** `*` was listed: every address gets its code inline. */
  all: boolean;
  /** The domains listed, lower-cased (empty when `all`). */
  domains: string[];
}

export function parseDebugDeliveryDomains(raw: string | undefined): DebugDeliveryDomains {
  const entries = (raw ?? "")
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry.length > 0);
  if (entries.includes("*")) return { all: true, domains: [] };
  return { all: false, domains: [...new Set(entries)] };
}

/** Whether `email`'s code is returned in the response instead of emailed. */
export function deliversCodeInline(raw: string | undefined, email: string): boolean {
  const { all, domains } = parseDebugDeliveryDomains(raw);
  if (all) return true;
  const at = email.lastIndexOf("@");
  if (at < 0) return false;
  const domain = email.slice(at + 1).trim().toLowerCase();
  return domains.includes(domain);
}
