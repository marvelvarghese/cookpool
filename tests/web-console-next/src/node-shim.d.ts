// The little of node this package's tests read from disk (it has no
// @types/node): the manifest test checks the icon files the console serves;
// the static-pages and browser-config tests read the app's routes and its
// wrangler.jsonc.
declare module "node:fs" {
  export function readFileSync(path: string): Uint8Array;
  export function existsSync(path: string): boolean;
  export function readdirSync(path: string, options: { recursive: true }): string[];
}
declare module "node:process" {
  export function cwd(): string;
}
