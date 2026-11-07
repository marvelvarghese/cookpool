// Types for protocol.mjs (plain JavaScript so the build can bundle it into
// /sw.js). See that file for what each export is.

export declare const CACHE_PREFIX: "cookpool-";
export declare const STATIC_CACHE_PREFIX: "cookpool-static-";
export declare const DATA_CACHE_PREFIX: "cookpool-data-";
export declare const DATA_CACHE_VERSION: string;
export declare const META_CACHE: "cookpool-meta";
export declare const ACCOUNT_PATH: string;
export declare const CACHED_AT_HEADER: "x-cookpool-cached-at";
export declare const MESSAGE: Readonly<{
  account: "cookpool:account";
  signedOut: "cookpool:signed-out";
  activate: "cookpool:activate";
  adopt: "cookpool:adopt";
  pushRenewed: "cookpool:push-renewed";
}>;
export declare function staticCacheName(buildId: string): string;
export declare function isSubjectId(value: unknown): value is string;
export declare function isTokenHash(value: unknown): value is string;
export declare function dataCacheName(subjectId: string): string;
export declare function accountUrl(origin: string): string;
export declare function bearerToken(authorization: string | null | undefined): string | null;
export declare function tokenHash(token: string, subtle?: SubtleCrypto): Promise<string>;
