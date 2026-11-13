// Types for api-forward.mjs (Cookpool SM-4). Structural, so neither the app
// nor its tests need the Workers types.

/** What the binding needs to be: something with a Workers `fetch`. */
export interface ApiEdgeBinding {
  fetch(request: Request): Promise<Response>;
}

/** The Worker's `env`, as far as this module reads it. */
export interface ConsoleWorkerEnv {
  API_EDGE?: ApiEdgeBinding;
  [key: string]: unknown;
}

/** A module worker's default export. */
export interface ModuleWorker {
  fetch(request: Request, env: ConsoleWorkerEnv, ctx: unknown): Promise<Response>;
}

export declare const API_PREFIX: "/api";
export declare const CLIENT_IP_HEADER: "x-console-client-ip";
export declare const BINDING_PROPS: Readonly<{ caller: "tripeco-web" }>;
export declare const ADDRESS_HEADERS: readonly string[];

export declare function isApiPath(pathname: string): boolean;
export declare function apiEdgeRequest(request: Request): Request;
export declare function forwardToApiEdge(request: Request, binding: ApiEdgeBinding | undefined): Promise<Response>;
export declare function createConsoleWorker(loadOpenNext: () => Promise<{ default: ModuleWorker }>): ModuleWorker;
