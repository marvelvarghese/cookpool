import { handleAiStatus, handleAiUses } from "./handlers/ai.js";
import { handleAiReceipt } from "./handlers/ai-receipt.js";
import { handleAiAskStep, handleAiCheckStep, handleAiRescue, handleAiTranscribe } from "./handlers/ai-stove.js";
import { handleAiRecipePhoto } from "./handlers/ai-recipe-photo.js";
import type { MeRoute } from "./router.js";

// Cookpool AI (cookpool-ai AI-2, design §1, §2): the caller's own routes under
// /v1/kitchen/me/ai. AI-3…AI-6 add theirs here (receipt, recipe-photo,
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
  {
    name: "kitchen.me.ai.receipt",
    pattern: /^\/v1\/kitchen\/me\/ai\/receipt$/,
    methods: { POST: handleAiReceipt },
  },
  // Voice and help at the stove (AI-5).
  {
    name: "kitchen.me.ai.transcribe",
    pattern: /^\/v1\/kitchen\/me\/ai\/transcribe$/,
    methods: { POST: handleAiTranscribe },
  },
  {
    name: "kitchen.me.ai.ask-step",
    pattern: /^\/v1\/kitchen\/me\/ai\/ask-step$/,
    methods: { POST: handleAiAskStep },
  },
  {
    name: "kitchen.me.ai.check-step",
    pattern: /^\/v1\/kitchen\/me\/ai\/check-step$/,
    methods: { POST: handleAiCheckStep },
  },
  {
    name: "kitchen.me.ai.rescue",
    pattern: /^\/v1\/kitchen\/me\/ai\/rescue$/,
    methods: { POST: handleAiRescue },
  },
  {
    // Recipe from a photo (AI-4): photo only, by the owner's scope.
    name: "kitchen.me.ai.recipe-photo",
    pattern: /^\/v1\/kitchen\/me\/ai\/recipe-photo$/,
    methods: { POST: handleAiRecipePhoto },
  },
];
