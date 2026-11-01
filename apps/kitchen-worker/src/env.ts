export interface Env {
  PLATFORM_DB?: D1Database;
  MEMBERSHIP_WORKER?: Fetcher;
  POLICY_WORKER?: Fetcher;
  // Bound now so the worker's first deploy carries every binding it will use;
  // the kitchen's emails (use_soon, dish_posted, logged_for_you) arrive later.
  NOTIFICATIONS_WORKER?: Fetcher;
  // People's names (CP-9): POST /v1/internal/identity/users/lookup.
  IDENTITY_WORKER?: Fetcher;
  ENVIRONMENT: string;
}
