/**
 * Workers AI, as kitchen-worker uses it (AI-5): one `run` of a model. The
 * deployed `AI` binding satisfies it; tests stub it. Never called by a test
 * against the real service.
 */
export interface WorkersAi {
  run(model: string, inputs: Record<string, unknown>): Promise<unknown>;
}

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
  /**
   * Voice (AI-5): the Workers AI binding transcription runs Whisper through
   * (`"ai": { "binding": "AI" }`). Not declared for now (voice off, owner's
   * choice): POST /me/ai/transcribe answers 503 `ai_unavailable` and the
   * status read says `voice: false`.
   */
  AI?: WorkersAi;
}
