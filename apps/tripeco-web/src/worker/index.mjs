// The Tripeco Worker's entry (wrangler.jsonc `main`), as the console's
// (apps/web-console-next/src/worker/index.mjs): `/api/*` goes to api-edge
// over the API_EDGE binding (./api-forward.mjs); everything else to OpenNext,
// imported lazily on the first page request.
import { createConsoleWorker } from "./api-forward.mjs";

export { DOQueueHandler } from "../../.open-next/.build/durable-objects/queue.js";
export { DOShardedTagCache } from "../../.open-next/.build/durable-objects/sharded-tag-cache.js";

export default createConsoleWorker(() => import("../../.open-next/worker.js"));
