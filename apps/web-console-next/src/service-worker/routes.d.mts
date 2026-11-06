// Types for routes.mjs (plain JavaScript so the build can bundle it into
// /sw.js). See that file for what each export is.

export declare const NETWORK_CUTOFF_MS: number;
export declare const API_PREFIX: "/api";
export declare const UNCACHED_PAGES: readonly string[];
export declare const API_READS: readonly string[];

export interface RequestShape {
  method: string;
  url: string;
  mode?: string;
  rsc?: boolean;
}

export type Route =
  | { strategy: "network-first"; fallback: string }
  | { strategy: "cache-first" }
  | { strategy: "data" }
  | { strategy: "network-only" };

export declare function apiRead(pathname: string): string | null;
export declare function classify(request: RequestShape, origin: string, pages?: readonly string[]): Route;
