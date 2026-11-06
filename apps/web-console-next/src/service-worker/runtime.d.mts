// Types for runtime.mjs (plain JavaScript so the build can bundle it into
// /sw.js). See that file for what each export is.

export declare const DATA_CACHE_LIMIT: number;

export interface WorkerEnv {
  buildId: string;
  precache: readonly string[];
  origin: string;
  caches: CacheStorage;
  fetch: (request: Request) => Promise<Response>;
  clients?: { claim(): Promise<void> };
  registration?: { navigationPreload?: { enable(): Promise<void> } };
  skipWaiting?: () => Promise<void>;
  subtle?: SubtleCrypto;
  setTimeout?: (fn: () => void, ms: number) => unknown;
  clearTimeout?: (id: unknown) => void;
  now?: () => number;
}

export interface RespondContext {
  preloadResponse?: Promise<Response | undefined> | undefined;
  waitUntil?: (job: Promise<unknown>) => void;
}

export interface ServiceWorkerRuntime {
  buildId: string;
  install(): Promise<void>;
  activate(): Promise<void>;
  respond(request: Request, ctx?: RespondContext): Promise<Response> | null;
  message(data: unknown, reply?: (answer: { adopted: boolean }) => void): Promise<void>;
  account(): Promise<{ subjectId: string; tokenHash: string } | null>;
}

export declare function createServiceWorker(env: WorkerEnv): ServiceWorkerRuntime;
