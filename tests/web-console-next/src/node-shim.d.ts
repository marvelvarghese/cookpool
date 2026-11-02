// The little of node this package's tests read from disk (it has no
// @types/node): the manifest test checks the icon files the console serves.
declare module "node:fs" {
  export function readFileSync(path: string): Uint8Array;
  export function existsSync(path: string): boolean;
}
declare module "node:process" {
  export function cwd(): string;
}
