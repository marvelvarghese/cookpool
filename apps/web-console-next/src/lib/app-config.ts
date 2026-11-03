// Instance identity for the web console (saas-bootstrap-factory BF3 seam).
//
// Branding strings, deployment hostnames, contact addresses, and storage-key
// namespaces live here so a new instance of the starter retargets one file.
// Do not add behavior — values and trivial derivations only.
//
// RUNTIME, NOT BUILD (saas-console-artifact CA1). Every value below can be
// overridden per request by the Worker's `vars` (wrangler.jsonc), which the
// OpenNext runtime copies into `process.env`. So one build of the console can
// serve any product and any environment: the root layout resolves the config
// on the server and hands it to the client through <AppConfigProvider>. The
// literals here are the fallback — what a deploy with no `vars` gets — and are
// what the rebrand rewrites, so they stay this tree's own identity.

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
  deployEnv: "CONSOLE_DEPLOY_ENV",
};

/** The environments a console deploy can be locked to: the API targets. */
export const DEPLOY_ENVIRONMENTS = ["stage", "prod"] as const;

/** The Worker var mapping custom domains to environments (Cookpool SI-12). */
export const CUSTOM_DOMAINS_KEY = "CONSOLE_CUSTOM_DOMAINS";

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
 * The config for one request: each field from its runtime var when that is a
 * non-empty string, else the default. The deploy environment falls back
 * further, to the one the request's host names (saas-console-artifact CA2), so
 * one build serves every environment without being told which at build time.
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
  return {
    productName: pick("productName") ?? defaults.productName,
    productDescription: pick("productDescription") ?? defaults.productDescription,
    workersDevSubdomain: pick("workersDevSubdomain") ?? defaults.workersDevSubdomain,
    apiWorkerPrefix: pick("apiWorkerPrefix") ?? defaults.apiWorkerPrefix,
    storagePrefix: pick("storagePrefix") ?? defaults.storagePrefix,
    salesEmail: pick("salesEmail") ?? defaults.salesEmail,
    deployEnv: pick("deployEnv") ?? defaults.deployEnv ?? environmentFromHost(host, env[CUSTOM_DOMAINS_KEY]),
  };
}

let current: AppConfig = DEFAULT_APP_CONFIG;
let serverHost: string | null = null;

/**
 * Record the host the server is answering on (the root layout calls this per
 * request). Every console Worker serves one environment, so every request an
 * isolate sees names the same one: concurrent requests cannot disagree.
 */
export function rememberRequestHost(host: string | null): void {
  if (host) serverHost = host;
}

/**
 * The config in force. On the server it is resolved from the request's
 * environment (and the host the layout recorded) on every call, so a server
 * component never depends on the root layout having rendered first. In the
 * browser it is what <Providers> installed from the layout's resolution.
 */
export function appConfig(): AppConfig {
  if (typeof window === "undefined" && typeof process !== "undefined") {
    return resolveAppConfig(process.env, DEFAULT_APP_CONFIG, serverHost);
  }
  return current;
}

/** Install the resolved config in the browser. Idempotent; called by <Providers> on render. */
export function setAppConfig(config: AppConfig): void {
  current = config;
}

/** Browser/document title of the console. */
export function consoleTitle(config: AppConfig = appConfig()): string {
  return `${config.productName} Console`;
}

/** api-edge workers.dev URL for a given environment name. */
export function apiEdgeWorkersDevUrl(environment: string, config: AppConfig = appConfig()): string {
  return `https://${config.apiWorkerPrefix}-${environment}.${config.workersDevSubdomain}.workers.dev`;
}
