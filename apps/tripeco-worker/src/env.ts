export interface Env {
  PLATFORM_DB?: D1Database;
  /** Posting a ride as a Spliteco expense, and reading a group as the caller (TR-3). */
  SPLITECO_WORKER?: Fetcher;
  /** The Tripeco app's origin ("https://tripeco.example"). */
  APP_URL?: string;
  ENVIRONMENT: string;
}
