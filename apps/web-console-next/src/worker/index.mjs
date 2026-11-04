// The console Worker's entry (wrangler.jsonc `main`; Cookpool SM-4).
//
// Static assets never reach it (Workers Static Assets answers them first,
// SM-2), except `/api/*`, which `assets.run_worker_first` sends here. Those go
// to api-edge over the `API_EDGE` binding (./api-forward.mjs); everything
// else to OpenNext's own worker.
//
// OPENNEXT IS IMPORTED LAZILY, on the first request that is not `/api`.
// wrangler bundles this file with esbuild into one script, and esbuild turns
// a dynamic `import()` of a bundled module into a deferred initializer: the
// OpenNext and Next code is in the upload, but none of its module code runs
// until that first page request. An isolate that only ever answers `/api`
// evaluates this file, the forwarder and the two small classes below, and no
// Next. A static `import` here would undo that.
import { createConsoleWorker } from "./api-forward.mjs";

// What OpenNext's worker exports besides its handler (its Durable Object
// classes), so the deploy exports what it did before. Small and self-contained.
export { DOQueueHandler } from "../../.open-next/.build/durable-objects/queue.js";
export { DOShardedTagCache } from "../../.open-next/.build/durable-objects/sharded-tag-cache.js";

export default createConsoleWorker(() => import("../../.open-next/worker.js"));
