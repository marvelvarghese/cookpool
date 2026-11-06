// The little of node this package's tests read from disk (it has no
// @types/node): the manifest test checks the icon files the console serves;
// the static-pages and browser-config tests read the app's routes and its
// wrangler.jsonc; the service-worker tests (PW-4) build a fake
// `.open-next/assets` tree and read the worker's modules.
declare module "node:fs" {
  export function readFileSync(path: string): Uint8Array;
  export function readFileSync(path: string, encoding: "utf8"): string;
  export function existsSync(path: string): boolean;
  export function readdirSync(path: string, options: { recursive: true }): string[];
  export function mkdtempSync(prefix: string): string;
  export function mkdirSync(path: string, options: { recursive: true }): void;
  export function writeFileSync(path: string, data: string): void;
  export function rmSync(path: string, options: { recursive: true; force: true }): void;
}
declare module "node:process" {
  export function cwd(): string;
}
declare module "node:os" {
  export function tmpdir(): string;
}
