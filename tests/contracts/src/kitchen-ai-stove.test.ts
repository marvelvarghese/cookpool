// Voice and help at the stove in the contract (cookpool-ai AI-5, design §5,
// §5a): the clip's limits and types, Whisper and its per-minute price, the
// word and step limits, the verdicts and the chips, the doneness line, and
// the shapes of the four routes.

import {
  AI_ASK_STEP_QUESTION_MAX,
  AI_AUDIO_PRICES_PER_MINUTE,
  AI_CHECK_VERDICTS,
  AI_RESCUE_MAX_STEPS,
  AI_RESCUE_PROBLEMS,
  AI_RESCUE_TEXT_MAX,
  AI_STOVE_DONENESS_CHECK,
  AI_STOVE_SAY_MAX_WORDS,
  AI_TRANSCRIBE_AUDIO_TYPES,
  AI_TRANSCRIBE_MAX_BYTES,
  AI_TRANSCRIBE_MAX_SECONDS,
  AI_TRANSCRIBE_MODEL,
  aiAudioCostMicros,
  type AiAskStepRequest,
  type AiCheckStepResponse,
  type AiRescueRequest,
  type AiRescueResponse,
  type AiTranscribeResponse,
} from "@saas/contracts";
import * as stove from "@saas/contracts/kitchen-ai-stove";

describe("contracts: voice and help at the stove (AI-5)", () => {
  it("takes clips of at most 15 s and 1 MB, as WebM, Ogg, MP4 or WAV, through Whisper large v3 turbo", () => {
    expect([AI_TRANSCRIBE_MAX_SECONDS, AI_TRANSCRIBE_MAX_BYTES]).toEqual([15, 1024 * 1024]);
    expect(AI_TRANSCRIBE_AUDIO_TYPES).toEqual(["audio/webm", "audio/ogg", "audio/mp4", "audio/wav"]);
    expect(AI_TRANSCRIBE_MODEL).toBe("@cf/openai/whisper-large-v3-turbo");
    expect(stove.AI_TRANSCRIBE_MODEL).toBe(AI_TRANSCRIBE_MODEL);
  });

  it("prices audio at $0.0005 a minute, and an unpriced model never as free", () => {
    expect(AI_AUDIO_PRICES_PER_MINUTE).toEqual({ "@cf/openai/whisper-large-v3-turbo": 0.0005 });
    expect(aiAudioCostMicros(AI_TRANSCRIBE_MODEL, 60)).toBeCloseTo(500);
    expect(aiAudioCostMicros(AI_TRANSCRIBE_MODEL, 15)).toBeCloseTo(125);
    expect(aiAudioCostMicros("@cf/someone/else", 60)).toBeCloseTo(500);
    expect(aiAudioCostMicros(AI_TRANSCRIBE_MODEL, -5)).toBe(0);
  });

  it("limits answers to 60 words, questions to 300 characters, a rescue to 4 steps and Something else to 200", () => {
    expect([AI_STOVE_SAY_MAX_WORDS, AI_ASK_STEP_QUESTION_MAX, AI_RESCUE_MAX_STEPS, AI_RESCUE_TEXT_MAX]).toEqual([60, 300, 4, 200]);
  });

  it("names the four verdicts and the seven chips", () => {
    expect(AI_CHECK_VERDICTS).toEqual(["looks_right", "not_yet", "problem", "cant_tell"]);
    expect(AI_RESCUE_PROBLEMS).toEqual(["too_salty", "burning", "too_watery", "too_thick", "split", "not_cooking", "other"]);
  });

  it("the doneness line says the thickest piece, no pink, clear juices and 74 °C for chicken", () => {
    for (const part of ["thickest piece", "no pink", "juices run clear", "74 °C", "chicken"]) expect(AI_STOVE_DONENESS_CHECK).toContain(part);
  });

  it("shapes the routes", () => {
    const transcript: AiTranscribeResponse = { text: "next" };
    const asked: AiAskStepRequest = { recipeId: "rcp_1", factor: 1500, stepKey: "abc", question: "How long?" };
    const checked: AiCheckStepResponse = { verdict: "problem", say: "Flame off.", problem: "burning" };
    const rescue: AiRescueRequest = { recipeId: "rcp_1", stepKey: "abc", problem: "other", text: "lumpy" };
    const fixed: AiRescueResponse = { title: "Save it", steps: ["Flame off."], say: "Flame off." };
    expect([transcript.text, asked.factor, checked.problem, rescue.problem, fixed.steps.length]).toEqual(["next", 1500, "burning", "other", 1]);
  });
});
