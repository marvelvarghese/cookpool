export interface Env {
  PLATFORM_DB?: D1Database;
  /** Authorization facts, rosters, a person's groups, group creation and the direct groups. */
  MEMBERSHIP_WORKER?: Fetcher;
  /** The decision for every spliteco.* action. */
  POLICY_WORKER?: Fetcher;
  /** People's names: POST /v1/internal/identity/users/lookup. */
  IDENTITY_WORKER?: Fetcher;
  /** Reminders and "paid you" (SE2): notifications-worker's enqueue, by email and push. */
  NOTIFICATIONS_WORKER?: Fetcher;
  /** The Spliteco app's origin, for the links in what it sends ("https://spliteco.example"). */
  APP_URL?: string;
  ENVIRONMENT: string;
}
