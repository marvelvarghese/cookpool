import { appConfig } from "./app-config";

/**
 * The new frame (cookpool-recipes design §1.1): on wherever the app is not
 * prod — dev, stage, local, and a workers.dev host without an environment.
 * Read at runtime from the host the page is served on (`appConfig()`, CA2),
 * so one build serves every environment. Prod keeps today's app until RC5.
 */
export function newFrame(): boolean {
  return appConfig().deployEnv !== "prod";
}
