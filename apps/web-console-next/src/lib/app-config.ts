// Instance identity for the web console (saas-bootstrap-factory BF3 seam).
//
// Branding strings, deployment hostnames, contact addresses, and storage-key
// namespaces live here so a new instance of the starter retargets one file.
// Do not add behavior — values and trivial derivations only.
//
// THE BROWSER RESOLVES IT (Cookpool SM-2). The pages are prerendered files
// (no request reaches a server to render them), so the browser builds the
// config itself, synchronously, on the first call: the compiled-in values
// below plus the page's own host, which names the environment — a custom
// domain through `customDomains`, a workers.dev host through its `-<env>`
// (saas-console-artifact CA2). Nothing can call the API before that, since
// every API client is made from it (risk SM-C).
//
// On the server (the Worker's routes that still render: the admin console,
// the manifest) every field can still be overridden by the Worker's `vars`
// (wrangler.jsonc), which OpenNext copies into `process.env` (CA1). The
// browser does not see those vars, so the literals here must equal them;
// tests/web-console-next keeps the two in step. They are what the rebrand
// rewrites, so they stay this tree's own identity.

export interface AppConfig {
  /** Product/brand name shown across the console. */
  productName: string;
  /** Marketing-facing product description (document metadata). */
  productDescription: string;
  /** The Cloudflare account's workers.dev subdomain serving this instance. */
  workersDevSubdomain: string;
  /** api-edge worker name without its `-<env>` suffix. */
  apiWorkerPrefix: string;
  /** Namespace prefix for console localStorage keys. */
  storagePrefix: string;
  /** Sales contact surfaced by the billing upgrade UX. */
  salesEmail: string;
  /**
   * Where Can't sign in?'s "Write to us" mails (Cookpool PK-3). Empty by
   * default: with no address the button is not shown.
   */
  supportEmail: string;
  /**
   * Custom domains and the environment each serves (Cookpool SI-12):
   * `stage=stage.cookpool.store,prod=cookpool.store`.
   */
  customDomains: string;
  /**
   * The MCP connector URL assistants add, per environment (cookpool-mcp
   * MC-4): `stage=https://…/mcp,prod=https://…/mcp`. mcp-worker's own origin
   * (where the consent page's `/connect/*` calls go) is the URL's origin.
   */
  mcpPublicUrls: string;
  /** The single environment this deploy serves; unset offers every target. */
  deployEnv: string | undefined;
}

// `process.env.NEXT_PUBLIC_DEPLOY_ENV` is inlined at build time and must stay
// verbatim. The local declaration lets the node-types-free test compiler type
// this file; it shadows harmlessly under the app build.
declare const process: { env: Record<string, string | undefined> } | undefined;

const BUILD_DEPLOY_ENV: string | undefined =
  typeof process !== "undefined" ? process.env.NEXT_PUBLIC_DEPLOY_ENV || undefined : undefined;

/** This tree's own identity: what a deploy with no runtime `vars` serves. */
export const DEFAULT_APP_CONFIG: AppConfig = {
  productName: "cookpool",
  productDescription: "Next-gen control plane for your projects, environments, and entitlements.",
  workersDevSubdomain: "cookpool",
  apiWorkerPrefix: "cookpool-api-edge",
  storagePrefix: "cookpool.next",
  salesEmail: "sales@sourceplane.ai",
  supportEmail: "",
  customDomains: "stage=stage.cookpool.store,prod=cookpool.store",
  // mcp-worker's workers.dev hosts (MC-3: `workers_dev: true` in stage and prod).
  // TODO(cookpool-mcp, risk MC-D): once the owner attaches mcp.cookpool.store
  // (and a stage name) in the Cloudflare dashboard, point these at the custom
  // domain, with mcp-worker's MCP_PUBLIC_ORIGIN.
  mcpPublicUrls:
    "stage=https://cookpool-mcp-worker-stage.cookpool.workers.dev/mcp,prod=https://cookpool-mcp-worker-prod.cookpool.workers.dev/mcp",
  deployEnv: BUILD_DEPLOY_ENV,
};

/** The Worker `vars` that override each field at runtime. */
export const RUNTIME_KEYS: Record<keyof AppConfig, string> = {
  productName: "CONSOLE_PRODUCT_NAME",
  productDescription: "CONSOLE_PRODUCT_DESCRIPTION",
  workersDevSubdomain: "CONSOLE_WORKERS_DEV_SUBDOMAIN",
  apiWorkerPrefix: "CONSOLE_API_WORKER_PREFIX",
  storagePrefix: "CONSOLE_STORAGE_PREFIX",
  salesEmail: "CONSOLE_SALES_EMAIL",
  supportEmail: "CONSOLE_SUPPORT_EMAIL",
  customDomains: "CONSOLE_CUSTOM_DOMAINS",
  mcpPublicUrls: "CONSOLE_MCP_PUBLIC_URLS",
  deployEnv: "CONSOLE_DEPLOY_ENV",
};

/** The environments a console deploy can be locked to: the API targets. */
export const DEPLOY_ENVIRONMENTS = ["stage", "prod"] as const;

/** The Worker var mapping custom domains to environments (Cookpool SI-12). */
export const CUSTOM_DOMAINS_KEY = RUNTIME_KEYS.customDomains;

/**
 * `CONSOLE_CUSTOM_DOMAINS` parsed: `stage=stage.cookpool.store,prod=cookpool.store`
 * → host → environment. Unknown environments and malformed entries are
 * dropped; hosts are lower-cased.
 */
export function parseCustomDomains(raw: string | null | undefined): Map<string, string> {
  const map = new Map<string, string>();
  for (const entry of (raw ?? "").split(",")) {
    const [env, host] = entry.split("=").map((s) => s.trim().toLowerCase());
    if (!env || !host || !(DEPLOY_ENVIRONMENTS as readonly string[]).includes(env)) continue;
    map.set(host, env);
  }
  return map;
}

/**
 * The environment a request's host names. A custom domain listed in
 * `CONSOLE_CUSTOM_DOMAINS` names its environment exactly (SI-12: one console
 * Worker per environment also answers on `cookpool.store` or
 * `stage.cookpool.store`, which carry no `-<env>`). Otherwise the Worker naming
 * every console deploy follows (`<worker>-<env>.<subdomain>.workers.dev`): the
 * first label's last `-` segment, when that is a known environment.
 */
export function environmentFromHost(
  host: string | null | undefined,
  customDomains?: string | null,
): string | undefined {
  const hostname = (host ?? "").toLowerCase().split(":")[0]!;
  const mapped = parseCustomDomains(customDomains).get(hostname);
  if (mapped) return mapped;
  const label = hostname.split(".")[0]!;
  const suffix = label.slice(label.lastIndexOf("-") + 1);
  return label.includes("-") && (DEPLOY_ENVIRONMENTS as readonly string[]).includes(suffix) ? suffix : undefined;
}

/**
 * The config for one host: each field from its runtime var when that is a
 * non-empty string, else the default. The deploy environment falls back
 * further, to the one the host names (saas-console-artifact CA2), so one
 * build serves every environment without being told which at build time.
 * Pure, so it is unit-testable.
 */
export function resolveAppConfig(
  env: Record<string, string | undefined>,
  defaults: AppConfig = DEFAULT_APP_CONFIG,
  host?: string | null,
): AppConfig {
  const pick = (key: keyof AppConfig): string | undefined => {
    const value = env[RUNTIME_KEYS[key]];
    return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
  };
  const customDomains = pick("customDomains") ?? defaults.customDomains;
  return {
    productName: pick("productName") ?? defaults.productName,
    productDescription: pick("productDescription") ?? defaults.productDescription,
    workersDevSubdomain: pick("workersDevSubdomain") ?? defaults.workersDevSubdomain,
    apiWorkerPrefix: pick("apiWorkerPrefix") ?? defaults.apiWorkerPrefix,
    storagePrefix: pick("storagePrefix") ?? defaults.storagePrefix,
    salesEmail: pick("salesEmail") ?? defaults.salesEmail,
    supportEmail: pick("supportEmail") ?? defaults.supportEmail,
    customDomains,
    mcpPublicUrls: pick("mcpPublicUrls") ?? defaults.mcpPublicUrls,
    deployEnv: pick("deployEnv") ?? defaults.deployEnv ?? environmentFromHost(host, customDomains),
  };
}

/**
 * The config a browser page resolves for itself: the compiled-in values and
 * the page's host (no runtime vars reach a static page). Pure.
 */
export function browserAppConfig(host: string, defaults: AppConfig = DEFAULT_APP_CONFIG): AppConfig {
  return resolveAppConfig({}, defaults, host);
}

/**
 * The config on the server for one request's host (cookpool-recipes RC-2: the
 * manifest's shortcuts follow the environment the host names): the Worker's
 * vars, then the host.
 */
export function requestAppConfig(host: string | null | undefined): AppConfig {
  return resolveAppConfig(typeof process !== "undefined" ? process.env : {}, DEFAULT_APP_CONFIG, host);
}

let browser: AppConfig | null = null;

/**
 * The config in force. On the server it is resolved from the Worker's vars on
 * every call (there is no host: the environment comes from
 * `CONSOLE_DEPLOY_ENV` or the build, else none). In the browser it is
 * resolved once, on the first call, from `window.location.host`, before
 * anything can have made an API client.
 */
export function appConfig(): AppConfig {
  if (typeof window === "undefined") {
    return resolveAppConfig(typeof process !== "undefined" ? process.env : {}, DEFAULT_APP_CONFIG, null);
  }
  // (`location` is always there in a browser; some tests fake a window without it.)
  browser ??= browserAppConfig(window.location?.host ?? "");
  return browser;
}

/** Forget the browser's resolution, so the next call resolves again. For tests. */
export function resetAppConfigForTests(): void {
  browser = null;
}

/** Browser/document title of the console. */
export function consoleTitle(config: AppConfig = appConfig()): string {
  return `${config.productName} Console`;
}

/** api-edge workers.dev URL for a given environment name. */
export function apiEdgeWorkersDevUrl(environment: string, config: AppConfig = appConfig()): string {
  return `https://${config.apiWorkerPrefix}-${environment}.${config.workersDevSubdomain}.workers.dev`;
}

/**
 * The MCP connector URL for an environment (cookpool-mcp MC-4): what an
 * assistant adds, from `mcpPublicUrls`. Only an https URL counts; null when
 * the environment has none (a local build that names no environment).
 */
export function mcpPublicUrl(environment: string | null | undefined, config: AppConfig = appConfig()): string | null {
  if (!environment) return null;
  for (const entry of (config.mcpPublicUrls ?? "").split(",")) {
    const at = entry.indexOf("=");
    if (at < 0 || entry.slice(0, at).trim().toLowerCase() !== environment) continue;
    try {
      const url = new URL(entry.slice(at + 1).trim());
      return url.protocol === "https:" ? url.toString() : null;
    } catch {
      return null;
    }
  }
  return null;
}

/** mcp-worker's origin for an environment, where the consent page's `/connect/*` calls go; null without one. */
export function mcpOrigin(environment: string | null | undefined, config: AppConfig = appConfig()): string | null {
  const url = mcpPublicUrl(environment, config);
  return url ? new URL(url).origin : null;
}
