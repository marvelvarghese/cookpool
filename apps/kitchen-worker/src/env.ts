export interface Env {
  PLATFORM_DB?: D1Database;
  MEMBERSHIP_WORKER?: Fetcher;
  POLICY_WORKER?: Fetcher;
  // Cookpool's emails (CP-18): the use-soon digest, a dish posted for claims,
  // a use or expense logged for someone else — POST /v1/notifications through
  // @saas/notifications-client.
  NOTIFICATIONS_WORKER?: Fetcher;
  // People's names (CP-9) and email addresses (CP-18):
  // POST /v1/internal/identity/users/lookup.
  IDENTITY_WORKER?: Fetcher;
  ENVIRONMENT: string;
  /** The app's origin (https://cookpool.store, https://stage.cookpool.store): links in emails start here. */
  APP_URL?: string;
}
