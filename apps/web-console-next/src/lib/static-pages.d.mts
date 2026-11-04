// Types for static-pages.mjs (plain JavaScript so scripts/pages-as-files.mjs
// can import it too). See that file for what each export is.

export declare const PLACEHOLDER: "_";
export declare const STATIC_PAGES: readonly string[];
export declare function prerenderedRoute(pattern: string): string;
export declare function htmlFile(pattern: string): string;
export declare function rscFile(pattern: string): string;
export declare function matchPage(pattern: string, pathname: string): Record<string, string> | null;
export declare function pathParam(pattern: string, name: string, pathname: string | null | undefined): string | undefined;
export declare function staticPageFor(pathname: string, pages?: readonly string[]): string | null;
export declare function redirectRules(pages?: readonly string[]): string[];
export declare function rscFetchShim(pages?: readonly string[]): string;
