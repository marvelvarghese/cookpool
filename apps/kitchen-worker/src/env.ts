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
  /**
   * Cookpool AI (AI-2): the Anthropic API key, a runtime secret pushed at
   * deploy from orun secrets (component.yaml), never in config. Without it
   * every AI route answers 503 `ai_unavailable` and GET /me/ai says
   * `available: false`.
   */
  ANTHROPIC_API_KEY?: string;
  /**
   * Cost guardrails (AI-13), plain vars: `on` retries a failed Haiku check
   * once on Sonnet (anything else, or unset: no retry), and the month's AI
   * budget in USD across everyone (unset or not a number ≥ 0: 5).
   */
  AI_ESCALATE?: string;
  AI_MONTHLY_BUDGET_USD?: string;
}
