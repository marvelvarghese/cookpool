import type { CloudflareEmailSender } from "./providers/cloudflare-email.js";

export interface Env {
  PLATFORM_DB?: D1Database;
  EVENTS_WORKER?: Fetcher;
  /** Cloudflare Email Service send_email binding (cloudflare-email provider). */
  EMAIL?: CloudflareEmailSender;
  ENVIRONMENT: string;
  /** Provider selector: "local-debug" (default) or "cloudflare-email". */
  NOTIFICATIONS_PROVIDER?: string;
  DEBUG_DELIVERY?: string;
  /** Verified sender address for the cloudflare-email provider. */
  EMAIL_FROM_ADDRESS?: string;
  /** Optional sender display name / brand for the cloudflare-email provider. */
  EMAIL_FROM_NAME?: string;
  /**
   * Web Push (Cookpool PW-5): the VAPID public key, base64url of the
   * uncompressed P-256 point (65 bytes) — a plain var per environment, what
   * GET /v1/notifications/push-key hands the app.
   */
  VAPID_PUBLIC_KEY?: string;
  /**
   * The VAPID private key: base64url (no padding) of its PKCS#8 DER — a
   * secret the deploy injects from orun secrets, never in config. With either
   * key missing or the two not a pair, push is off (a log line says why) and
   * email is unaffected. `sub` is `mailto:` EMAIL_FROM_ADDRESS.
   */
  VAPID_PRIVATE_KEY?: string;
}
