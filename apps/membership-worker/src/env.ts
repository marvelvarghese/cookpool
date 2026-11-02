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
  /**
   * identity-worker (Cookpool SI-4): the signed-out join preview names the
   * group's first owner through its service-internal lookup
   * (POST /v1/internal/identity/users/lookup). Unbound or unreachable, the
   * preview answers without a name.
   */
  IDENTITY_WORKER?: Fetcher;
  ENVIRONMENT: string;
  DEBUG_DELIVERY?: string;
  /** M0 / Solo profile switch — see ./solo-mode.ts. */
  SOLO_MODE?: string;
  /** Cookpool open groups — every group stands alone; see ./open-groups.ts. */
  OPEN_GROUPS?: string;
}
