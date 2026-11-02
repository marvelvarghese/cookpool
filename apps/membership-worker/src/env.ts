export interface Env {
  PLATFORM_DB?: D1Database;
  POLICY_WORKER?: Fetcher;
  BILLING_WORKER?: Fetcher;
  NOTIFICATIONS_WORKER?: Fetcher;
  /**
   * Cookpool's kitchen-worker (CP-19): leaving a group asks it for the
   * caller's balance there (GET /v1/internal/kitchen/organizations/{org}/
   * subjects/{usr}/balance). Unbound or unreachable, leaving fails closed.
   */
  KITCHEN_WORKER?: Fetcher;
  ENVIRONMENT: string;
  DEBUG_DELIVERY?: string;
  /** M0 / Solo profile switch — see ./solo-mode.ts. */
  SOLO_MODE?: string;
  /** Cookpool open groups — every group stands alone; see ./open-groups.ts. */
  OPEN_GROUPS?: string;
}
