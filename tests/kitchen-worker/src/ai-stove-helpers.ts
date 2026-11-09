// Voice and help at the stove (cookpool-ai AI-5): a world with a guided
// chicken curry (Rahul's own) and a vegetarian rajma, the stubbed Workers AI
// binding, voice clips with real header bytes, and the calls. No test
// reaches Workers AI or the Anthropic API.

import type { KitchenRecipe, RecipeResponse } from "@saas/contracts/kitchen";
import type { AiMessageParams } from "@kitchen-worker/ai/provider";
import type { WorkersAi } from "@kitchen-worker/env";
import { aiWorld, me, RAHUL, type AiWorld, type Result } from "./ai-helpers.js";
import { envelope } from "./harness.js";

export const TRANSCRIBE = me("ai/transcribe");
export const ASK = me("ai/ask-step");
export const CHECK = me("ai/check-step");
export const RESCUE = me("ai/rescue");

/** Chicken curry, guided: L1 chicken (main, 1 kg), L2 onions, L3 tomatoes, L4 turmeric, L5 salt; five steps. */
export const CURRY = {
  name: "Chicken curry",
  servesHalf: 8,
  minutes: 60,
  kind: "dal_curry",
  lines: [
    { foodKey: "chicken", name: "Chicken", quantity: "1", unit: "kg", isMain: true },
    { foodKey: "onion", name: "Onions, sliced", quantity: 2, unit: "onion" },
    { foodKey: "tomato", name: "Tomatoes", quantity: "200", unit: "g" },
    { foodKey: "turmeric", name: "Turmeric", quantity: "1", unit: "tsp" },
    { foodKey: "salt", name: "Salt", toTaste: true },
  ],
  steps: [
    { text: "Marinate the chicken with turmeric and salt", phase: "prep", lines: [0, 3, 4], minSeconds: 1800, handsOff: true },
    {
      text: "Brown the onions", lines: [1], heat: 2, minSeconds: 480, maxSeconds: 600, timeRule: "partly", sense: "look",
      checkpoint: "golden brown", tip: "Don't crowd the pan",
    },
    { text: "Add the tomatoes and cook them down", lines: [2], heat: 2, minSeconds: 300, sense: "look", checkpoint: "the oil separates" },
    {
      text: "Add the chicken and simmer covered until cooked", lines: [0], heat: 1, minSeconds: 1500, maxSeconds: 1800, timeRule: "linear",
      sense: "look", checkpoint: "the chicken is cooked through",
    },
    "Rest five minutes and serve",
  ],
  tools: ["Kadai with a lid"],
};

/** Rajma, vegetarian: a pressure cooker's whistles. */
export const RAJMA = {
  name: "Rajma",
  servesHalf: 8,
  lines: [
    { foodKey: "rajma", name: "Rajma", quantity: "250", unit: "g", isMain: true },
    { foodKey: "onion", name: "Onions, chopped", quantity: 2, unit: "onion" },
  ],
  steps: [
    { text: "Pressure-cook the rajma", lines: [0], heat: 3, whistles: 6, handsOff: true, sense: "sound", checkpoint: "the sixth whistle" },
    { text: "Fry the onions", lines: [1], heat: 2, minSeconds: 480, sense: "look", checkpoint: "golden brown" },
  ],
};

/** A stubbed Workers AI binding: answers from a script, keeps every input it was sent. */
export interface StubAi extends WorkersAi {
  calls: Array<{ model: string; inputs: Record<string, unknown> }>;
  script: Array<unknown | { throws: unknown }>;
}

export function stubAi(script: unknown[] = []): StubAi {
  const stub: StubAi = {
    calls: [],
    script,
    async run(model, inputs) {
      stub.calls.push({ model, inputs });
      const next = stub.script.shift();
      if (next === undefined) throw new Error("the stub has no answer left");
      if (next !== null && typeof next === "object" && "throws" in next) throw (next as { throws: unknown }).throws;
      return next;
    },
  };
  return stub;
}

/** Whisper's answer, as Workers AI shapes it. */
export const heard = (text: string, duration?: number) => ({
  text,
  word_count: text.split(/\s+/).length,
  ...(duration !== undefined ? { transcription_info: { language: "en", language_probability: 0.98, duration, duration_after_vad: duration } } : {}),
});

export interface StoveWorld extends AiWorld {
  voice: StubAi;
  curry: KitchenRecipe;
  rajma: KitchenRecipe;
  /** The curry's step keys, S1…S5. */
  keys: string[];
}

export async function stoveWorld(opts: Parameters<typeof aiWorld>[0] & { binding?: boolean } = {}): Promise<StoveWorld> {
  const w = aiWorld(opts) as StoveWorld;
  w.voice = stubAi();
  if (opts.binding !== false) w.h.env.AI = w.voice;
  const write = async (body: Record<string, unknown>) => {
    const res = await w.call<RecipeResponse>("POST", me("recipes"), RAHUL, body);
    if (res.status !== 201) throw new Error(`recipe: ${res.status} ${JSON.stringify(res.body.error)}`);
    return res.body.data.recipe;
  };
  w.curry = await write(CURRY);
  w.rajma = await write(RAJMA);
  w.keys = w.curry.guidedSteps!.map((s) => s.key);
  return w;
}

const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));

/** A clip of `bytes` bytes starting with `head`. */
function clip(head: number[], bytes: number): Uint8Array {
  const out = new Uint8Array(bytes).fill(0x33);
  out.set(head);
  return out;
}

export const webm = (bytes = 4000) => clip([0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81, 0x01, 0x42, 0xf7, 0x81], bytes);
export const ogg = (bytes = 4000) => clip([...ascii("OggS"), 0, 2, 0, 0, 0, 0, 0, 0], bytes);
export const mp4 = (bytes = 4000) => clip([0, 0, 0, 0x20, ...ascii("ftypM4A "), 0, 0], bytes);
export const wav = (bytes = 4000) => clip([...ascii("RIFF"), 0x24, 0x08, 0, 0, ...ascii("WAVEfmt ")], bytes);
export const mp3 = (bytes = 4000) => clip([...ascii("ID3"), 4, 0, 0, 0, 0, 0, 0, 0, 0], bytes);

/** POST a clip to the transcription route. */
export async function speak(
  w: AiWorld,
  bytes: Uint8Array,
  seconds: string | number | null = 4,
  contentType = "audio/webm",
): Promise<Result<{ text: string }>> {
  const query = seconds === null ? "" : `?seconds=${seconds}`;
  const res = await w.h.call("POST", `${TRANSCRIBE}${query}`, { as: RAHUL, bytes, headers: { "content-type": contentType } });
  return { status: res.status, body: await envelope<{ text: string }>(res) };
}

/** Everything the model was sent as text in its user turn, joined. */
export function userText(params: AiMessageParams): string {
  const content = params.messages[0]!.content;
  return typeof content === "string" ? content : content.map((b) => (b.type === "text" ? b.text : `[${b.type}]`)).join("\n");
}

/** The whole prompt: system, reference and the user turn. */
export function promptText(params: AiMessageParams): string {
  const system = Array.isArray(params.system) ? params.system.map((b) => b.text).join("\n") : String(params.system ?? "");
  return `${system}\n${userText(params)}`;
}
