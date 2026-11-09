import {
  AI_TRANSCRIBE_MAX_BYTES,
  AI_TRANSCRIBE_MAX_SECONDS,
  AI_TRANSCRIBE_MODEL,
  type AiTranscribeAudioType,
} from "@saas/contracts/kitchen";
import type { Env, WorkersAi } from "../env.js";

// Transcription (Cookpool AI, AI-5, design §5): one short clip → its words,
// through Workers AI's Whisper (`@cf/openai/whisper-large-v3-turbo`) on the
// kitchen-worker's `AI` binding. The clip is the request body; it is read
// into memory (at most AI_TRANSCRIBE_MAX_BYTES — a longer body is cut off and
// refused), sniffed by its first bytes, sent to the model in base64 and
// dropped with the request. It is never stored, logged or written anywhere:
// the usage row keeps only its seconds.

/** The longest transcript returned, in characters: 15 s of speech is far less. */
const TEXT_MAX = 1_000;

/** Is transcription set up on this server? Only the binding decides. */
export function transcribeAvailable(env: Pick<Env, "AI">): env is Pick<Env, "AI"> & { AI: WorkersAi } {
  return typeof env.AI?.run === "function";
}

export type Clip =
  | { ok: true; bytes: Uint8Array; type: AiTranscribeAudioType; seconds: number }
  | { ok: false; fields: Record<string, string[]> };

const ascii = (bytes: Uint8Array, from: number, to: number) => String.fromCharCode(...bytes.slice(from, to));

/** The clip's type by its first bytes; null for anything else. */
export function sniffAudio(bytes: Uint8Array): AiTranscribeAudioType | null {
  if (bytes.length < 12) return null;
  if (bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) return "audio/webm";
  if (ascii(bytes, 0, 4) === "OggS") return "audio/ogg";
  if (ascii(bytes, 4, 8) === "ftyp") return "audio/mp4";
  if (ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 12) === "WAVE") return "audio/wav";
  return null;
}

/** The body, at most `max` bytes; null when it is longer (reading stops there). */
async function readCapped(request: Request, max: number): Promise<Uint8Array | null> {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > max) return null;
  if (!request.body) return new Uint8Array(0);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, at);
    at += chunk.byteLength;
  }
  return bytes;
}

const AUDIO_MESSAGE = "Must be a voice clip: WebM or Ogg (Opus), MP4 (AAC) or WAV";

/**
 * The clip: `?seconds=` (its length, > 0 and ≤ AI_TRANSCRIBE_MAX_SECONDS)
 * and the body (≤ AI_TRANSCRIBE_MAX_BYTES, one of the audio types by its
 * bytes). Field errors on `seconds` and `audio`.
 */
export async function readClip(request: Request): Promise<Clip> {
  const fields: Record<string, string[]> = {};
  const raw = new URL(request.url).searchParams.get("seconds") ?? "";
  const seconds = /^\d{1,3}(\.\d{1,3})?$/.test(raw) ? Number(raw) : Number.NaN;
  if (!(seconds > 0 && seconds <= AI_TRANSCRIBE_MAX_SECONDS)) {
    fields.seconds = [`Must be the clip's length in seconds, more than 0 and at most ${AI_TRANSCRIBE_MAX_SECONDS}`];
  }
  const bytes = await readCapped(request, AI_TRANSCRIBE_MAX_BYTES);
  let type: AiTranscribeAudioType | null = null;
  if (bytes === null) fields.audio = ["Must be at most 1 MB"];
  else if ((type = sniffAudio(bytes)) === null) fields.audio = [AUDIO_MESSAGE];
  if (Object.keys(fields).length > 0 || bytes === null || type === null) return { ok: false, fields };
  return { ok: true, bytes, type, seconds };
}

/** Bytes → base64, in chunks (a 1 MB clip in one spread would overflow the stack). */
export function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

export type Transcript = { ok: true; text: string; seconds: number | null } | { ok: false };

/**
 * Run Whisper on the clip. Never throws: anything the binding throws or an
 * answer without text is `{ ok: false }`, and nothing of it is logged.
 * `seconds` is the length Whisper reports, when it does.
 */
export async function transcribe(ai: WorkersAi, clip: Extract<Clip, { ok: true }>): Promise<Transcript> {
  let out: unknown;
  try {
    out = await ai.run(AI_TRANSCRIBE_MODEL, { audio: toBase64(clip.bytes), task: "transcribe" });
  } catch {
    return { ok: false };
  }
  if (out === null || typeof out !== "object") return { ok: false };
  const { text, transcription_info: info } = out as { text?: unknown; transcription_info?: { duration?: unknown } };
  if (typeof text !== "string") return { ok: false };
  const duration = info && typeof info.duration === "number" && Number.isFinite(info.duration) && info.duration >= 0 ? info.duration : null;
  return { ok: true, text: text.replace(/\s+/g, " ").trim().slice(0, TEXT_MAX), seconds: duration };
}

/** The seconds a clip counts: the longer of what was declared and what Whisper heard, whole seconds up. */
export function countedSeconds(declared: number, heard: number | null): number {
  return Math.ceil(Math.max(declared, heard ?? 0));
}
