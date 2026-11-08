import { handleAiStatus, handleAiUses } from "./handlers/ai.js";
import type { MeRoute } from "./router.js";

// Cookpool AI (cookpool-ai AI-2, design §1, §2): the caller's own routes under
// /v1/kitchen/me/ai. AI-3…AI-6 add theirs here (receipt, recipe-import,
// transcribe, ask-step, swaps, idea), each with its handler in its own file.
export const AI_ROUTES: readonly MeRoute[] = [
  {
    name: "kitchen.me.ai",
    pattern: /^\/v1\/kitchen\/me\/ai$/,
    methods: { GET: handleAiStatus },
  },
  {
    name: "kitchen.me.ai.uses",
    pattern: /^\/v1\/kitchen\/me\/ai\/uses$/,
    methods: { POST: handleAiUses },
  },
];
