export interface Env {
  PLATFORM_DB?: D1Database;
  /** Authorization facts, rosters, a person's groups, group creation and the direct groups. */
  MEMBERSHIP_WORKER?: Fetcher;
  /** The decision for every spliteco.* action. */
  POLICY_WORKER?: Fetcher;
  /** People's names: POST /v1/internal/identity/users/lookup. */
  IDENTITY_WORKER?: Fetcher;
  ENVIRONMENT: string;
}
