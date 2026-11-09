// Voice and help at the stove in the contract (cookpool-ai AI-5, design §5,
// §5a): transcription, a question about the step, Check it from a photo, and
// a fix for something gone wrong. All the caller's own routes; nothing is
// written but a usage row, and audio and photos are never stored or logged.
//
//   POST /v1/kitchen/me/ai/transcribe?seconds=   audio body → AiTranscribeResponse
//        The clip's bytes as the body (WebM/Opus, Ogg/Opus, MP4/AAC or WAV,
//        ≤ AI_TRANSCRIBE_MAX_BYTES), its length in `?seconds=` (> 0,
//        ≤ AI_TRANSCRIBE_MAX_SECONDS). Workers AI's Whisper, through the
//        kitchen-worker's `AI` binding: without it, 503 `ai_unavailable`.
//        Counts voice seconds (30 minutes a day, `voice_daily_limit`), not
//        actions.
//   POST /v1/kitchen/me/ai/ask-step     AiAskStepRequest → AiAskStepResponse
//   POST /v1/kitchen/me/ai/check-step   AiCheckStepRequest → AiCheckStepResponse
//   POST /v1/kitchen/me/ai/rescue       AiRescueRequest → AiRescueResponse
//        Each one action of the day's 50. The recipe must be one the caller
//        may see (a link recipe's `code` too), else the opaque 404; a step key
//        that is not one of its steps is 422 on `stepKey`.
//
// What the model is sent: the recipe's name, its lines scaled to `factor`,
// its steps (heat, time at that size, checkpoint, tip), which step the cook
// is on and the next one, and the question, photo or problem. Never money,
// people, groups or the recipe's owner.
//
// Safety (design §5a): no answer says food is safe to eat; when the doneness
// of meat, eggs or seafood comes up, the answer says how to check
// (AI_STOVE_DONENESS_CHECK) — the server adds it when the model did not.

/** The longest clip transcribed, in seconds. */
export const AI_TRANSCRIBE_MAX_SECONDS = 15;
/** The largest clip, in bytes: 1 MB. */
export const AI_TRANSCRIBE_MAX_BYTES = 1_048_576;
/** What a clip may be, by its bytes (the Content-Type is not trusted). */
export const AI_TRANSCRIBE_AUDIO_TYPES = ["audio/webm", "audio/ogg", "audio/mp4", "audio/wav"] as const;
export type AiTranscribeAudioType = (typeof AI_TRANSCRIBE_AUDIO_TYPES)[number];
/** The Workers AI model the clips are transcribed with. */
export const AI_TRANSCRIBE_MODEL = "@cf/openai/whisper-large-v3-turbo";

/** POST /v1/kitchen/me/ai/transcribe: what was said, trimmed ("" for silence). */
export interface AiTranscribeResponse {
  text: string;
}

/** The longest question ask-step takes, in characters (after trimming). */
export const AI_ASK_STEP_QUESTION_MAX = 300;
/** The longest spoken answer or `say`, in words. */
export const AI_STOVE_SAY_MAX_WORDS = 60;
/** A rescue's steps: at most this many. */
export const AI_RESCUE_MAX_STEPS = 4;
/** The longest "Something else" text, in characters. */
export const AI_RESCUE_TEXT_MAX = 200;

/**
 * The line every doneness answer about meat, eggs or seafood carries (and the
 * app shows under the Check it buttons).
 */
export const AI_STOVE_DONENESS_CHECK =
  "To be sure, cut the thickest piece: no pink and the juices run clear, or 74 °C inside for chicken; eggs set, fish opaque.";

/**
 * Which recipe, at which size, at which step. `factor` is the size in
 * thousandths, as `?f=` on the recipe routes (RECIPE_MIN_FACTOR_MILLI to
 * RECIPE_MAX_FACTOR_MILLI; default 1000 = as written; 1500 is × 1.5).
 * `code` is the link code of a link recipe the caller opened by its link.
 */
export interface AiStoveStepRef {
  recipeId: string;
  factor?: number;
  stepKey: string;
  code?: string;
}

/** POST /v1/kitchen/me/ai/ask-step: `question`, 1–AI_ASK_STEP_QUESTION_MAX characters. */
export interface AiAskStepRequest extends AiStoveStepRef {
  question: string;
}

/** At most AI_STOVE_SAY_MAX_WORDS words, to show and read aloud. */
export interface AiAskStepResponse {
  answer: string;
}

/** The chips of Something wrong? ("other" is Something else, with `text`). */
export const AI_RESCUE_PROBLEMS = ["too_salty", "burning", "too_watery", "too_thick", "split", "not_cooking", "other"] as const;
export type AiRescueProblem = (typeof AI_RESCUE_PROBLEMS)[number];

/** POST /v1/kitchen/me/ai/check-step: `image`, a base64 JPEG or WebP ≤ AI_RECEIPT_MAX_BYTES (as a receipt's). */
export interface AiCheckStepRequest extends AiStoveStepRef {
  image: string;
}

/**
 * A photo against the step's checkpoint:
 *   looks_right  it matches what the step waits for
 *   not_yet      on its way: keep going (`say` says what to wait for)
 *   problem      something is wrong (`problem` names the chip to fix it with)
 *   cant_tell    the photo does not show enough
 */
export const AI_CHECK_VERDICTS = ["looks_right", "not_yet", "problem", "cant_tell"] as const;
export type AiCheckVerdict = (typeof AI_CHECK_VERDICTS)[number];

export interface AiCheckStepResponse {
  verdict: AiCheckVerdict;
  /** What to do, at most AI_STOVE_SAY_MAX_WORDS words. */
  say: string;
  /** Only with verdict `problem`: the Something wrong? chip that fixes it. */
  problem?: AiRescueProblem;
}

/**
 * POST /v1/kitchen/me/ai/rescue. `text` (≤ AI_RESCUE_TEXT_MAX) is required
 * for `other` and optional otherwise; `image` is an optional photo, as
 * check-step's.
 */
export interface AiRescueRequest extends AiStoveStepRef {
  problem: AiRescueProblem;
  text?: string;
  image?: string;
}

/** A fix: a short title, 1–AI_RESCUE_MAX_STEPS steps, and what to say aloud (≤ AI_STOVE_SAY_MAX_WORDS words). */
export interface AiRescueResponse {
  title: string;
  steps: string[];
  say: string;
}
