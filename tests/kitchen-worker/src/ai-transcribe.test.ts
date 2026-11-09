// Transcription (cookpool-ai AI-5, design §5): a voice clip in the body →
// its words, through a stubbed Workers AI binding — Whisper large v3 turbo,
// the clip in base64. Its checks (type by bytes, ≤ 1 MB, ≤ 15 s), 503
// without the binding, the voice minutes it counts (not actions) and their
// 429, the cost per minute, a failed run, the budget — and that the audio is
// never stored or logged.

import {
  AI_DAILY_ACTIONS,
  AI_DAILY_VOICE_SECONDS,
  AI_TRANSCRIBE_MAX_BYTES,
  AI_TRANSCRIBE_MODEL,
  KITCHEN_AI_ERROR_REASONS,
  type AiStatus,
} from "@saas/contracts/kitchen";
import { RAHUL, me, type AiWorld } from "./ai-helpers.js";
import { heard, mp3, mp4, ogg, speak, stoveWorld, stubAi, wav, webm } from "./ai-stove-helpers.js";

/** Usage rows already spent today: `n` rows of `feature`, each `seconds` long. */
function seed(w: AiWorld, n: number, feature: string, seconds = 0) {
  const insert = w.h.db.prepare(
    `INSERT INTO kitchen_ai_usage (id, user_id, feature, model, input_tokens, cached_tokens, output_tokens, audio_seconds, cost_micros, ok, created_at)
     VALUES (?, ?, ?, 'm', 0, 0, 0, ?, 0, 1, '2026-11-09T08:00:00.000Z')`,
  );
  for (let i = 0; i < n; i++) insert.run(`seed-${feature}-${i}`, RAHUL, feature, seconds);
}

const status = async (w: AiWorld) => (await w.call<AiStatus>("GET", me("ai"), RAHUL)).body.data;

describe("transcription: what Whisper is sent and what comes back (AI-5)", () => {
  it("sends the clip in base64 to whisper-large-v3-turbo and returns the words, trimmed", async () => {
    const w = await stoveWorld();
    const clip = webm(3000);
    w.voice.script.push(heard("  how much   salt now?  ", 2.1));
    const res = await speak(w, clip, 2.5);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ text: "how much salt now?" });
    expect(w.voice.calls).toEqual([{ model: "@cf/openai/whisper-large-v3-turbo", inputs: { audio: Buffer.from(clip).toString("base64"), task: "transcribe" } }]);
    expect(AI_TRANSCRIBE_MODEL).toBe("@cf/openai/whisper-large-v3-turbo");
    // The Anthropic model is never called for a clip.
    expect(w.ai.sent).toHaveLength(0);
    w.close();
  });

  it("reads WebM, Ogg, MP4 and WAV by their bytes, whatever the Content-Type says", async () => {
    const w = await stoveWorld();
    for (const clip of [webm(), ogg(), mp4(), wav()]) {
      w.voice.script.push(heard("next"));
      const res = await speak(w, clip, 1, "application/octet-stream");
      expect(res.status).toBe(200);
      expect(res.body.data.text).toBe("next");
    }
    w.close();
  });

  it("an empty transcript is an empty text, not a failure", async () => {
    const w = await stoveWorld();
    w.voice.script.push(heard("   "));
    const res = await speak(w, webm());
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ text: "" });
    w.close();
  });
});

describe("transcription: the clip's checks (AI-5)", () => {
  const fields = (res: { body: { error?: { details?: Record<string, unknown> } } }) =>
    (res.body.error?.details?.fields ?? {}) as Record<string, string[]>;

  it("refuses an MP3, an empty body and anything that is not a clip, on `audio`, and calls nothing", async () => {
    const w = await stoveWorld();
    for (const bytes of [mp3(), new Uint8Array(0), new TextEncoder().encode('{"audio":"x"}')]) {
      const res = await speak(w, bytes);
      expect(res.status).toBe(422);
      expect(fields(res)).toEqual({ audio: ["Must be a voice clip: WebM or Ogg (Opus), MP4 (AAC) or WAV"] });
    }
    expect(w.voice.calls).toHaveLength(0);
    expect(w.usageRows()).toHaveLength(0);
    w.close();
  });

  it("takes exactly 1 MB, and refuses a byte more", async () => {
    const w = await stoveWorld();
    const over = await speak(w, webm(AI_TRANSCRIBE_MAX_BYTES + 1));
    expect(over.status).toBe(422);
    expect(fields(over)).toEqual({ audio: ["Must be at most 1 MB"] });
    expect(w.voice.calls).toHaveLength(0);
    w.voice.script.push(heard("ok"));
    expect((await speak(w, webm(AI_TRANSCRIBE_MAX_BYTES))).status).toBe(200);
    w.close();
  });

  it("needs ?seconds= above 0 and at most 15", async () => {
    const w = await stoveWorld();
    for (const seconds of [null, "", "0", "15.5", "16", "-1", "abc", "1e1"]) {
      const res = await speak(w, webm(), seconds);
      expect(res.status).toBe(422);
      expect(Object.keys(fields(res))).toEqual(["seconds"]);
    }
    expect(w.voice.calls).toHaveLength(0);
    w.voice.script.push(heard("ok"), heard("ok"));
    expect((await speak(w, webm(), 15)).status).toBe(200);
    expect((await speak(w, webm(), "0.4")).status).toBe(200);
    w.close();
  });

  it("names both fields when both are wrong", async () => {
    const w = await stoveWorld();
    const res = await speak(w, mp3(), 30);
    expect(Object.keys(fields(res)).sort()).toEqual(["audio", "seconds"]);
    w.close();
  });
});

describe("transcription: availability (AI-5)", () => {
  it("without the AI binding: 503 ai_unavailable before the body is read, and the status says voice: false", async () => {
    const w = await stoveWorld({ binding: false });
    const res = await speak(w, mp3());
    expect(res.status).toBe(503);
    expect(res.body.error).toMatchObject({ code: "internal_error", details: { reason: KITCHEN_AI_ERROR_REASONS.AI_UNAVAILABLE } });
    expect(w.usageRows()).toHaveLength(0);
    expect((await status(w)).features.voice).toBe(false);
    w.close();
  });

  it("voice is on in the status only with both the binding and the key", async () => {
    const both = await stoveWorld();
    expect((await status(both)).features).toMatchObject({ voice: true, sayIt: true, receipt: true });
    both.close();
    const noKey = await stoveWorld({ key: false });
    expect((await status(noKey)).features.voice).toBe(false);
    noKey.close();
  });

  it("a binding without run is no binding", async () => {
    const w = await stoveWorld({ binding: false });
    w.h.env.AI = {} as never;
    expect((await speak(w, webm())).status).toBe(503);
    expect((await status(w)).features.voice).toBe(false);
    w.close();
  });
});

describe("transcription: voice minutes and cost (AI-5)", () => {
  it("counts the longer of ?seconds= and what Whisper heard, whole seconds up, priced at $0.0005 a minute", async () => {
    const w = await stoveWorld();
    w.voice.script.push(heard("add the chicken", 4.6), heard("next"));
    await speak(w, webm(), 4.2);
    await speak(w, webm(), "7.01");
    // Same clock: order by the seconds counted.
    const rows = w.usageRows().sort((a, b) => Number(a.audio_seconds) - Number(b.audio_seconds));
    expect(rows.map((r) => [r.feature, r.model, r.audio_seconds, r.input_tokens, r.output_tokens, r.ok])).toEqual([
      ["transcribe", AI_TRANSCRIBE_MODEL, 5, 0, 0, 1],
      ["transcribe", AI_TRANSCRIBE_MODEL, 8, 0, 0, 1],
    ]);
    // 5 s = 5/60 min × $0.0005 = 41.7 µ$; 8 s = 66.7 µ$.
    expect(rows.map((r) => r.cost_micros)).toEqual([42, 67]);
    const today = (await status(w)).today;
    expect(today).toMatchObject({ voiceSeconds: 13, voiceSecondsLimit: AI_DAILY_VOICE_SECONDS, actions: 0 });
    w.close();
  });

  it("at 30 minutes today: 429 voice_daily_limit and no call; one second under still runs", async () => {
    const w = await stoveWorld();
    seed(w, 1, "transcribe", AI_DAILY_VOICE_SECONDS - 1);
    w.voice.script.push(heard("next"));
    expect((await speak(w, webm(), 4)).status).toBe(200);
    const res = await speak(w, webm(), 4);
    expect(res.status).toBe(429);
    expect(res.body.error).toMatchObject({
      code: "rate_limited",
      details: { reason: "voice_daily_limit", limit: 1800, used: 1803, resetsAt: "2026-11-10T00:00:00.000Z" },
    });
    expect(w.voice.calls).toHaveLength(1);
    w.close();
  });

  it("the 50 actions don't stop a clip, and a clip isn't an action", async () => {
    const w = await stoveWorld();
    seed(w, AI_DAILY_ACTIONS, "uses");
    w.voice.script.push(heard("next"));
    expect((await speak(w, webm())).status).toBe(200);
    expect((await status(w)).today.actions).toBe(AI_DAILY_ACTIONS);
    w.close();
  });

  it("a failed run is 502 ai_failed, still counted (the clip was sent); an answer without text fails too", async () => {
    const w = await stoveWorld();
    w.voice.script.push({ throws: new Error("InferenceUpstreamError") }, { result: "nope" }, "just a string");
    for (let i = 0; i < 3; i++) {
      const res = await speak(w, webm(), 3);
      expect(res.status).toBe(502);
      expect(res.body.error).toMatchObject({ code: "internal_error", details: { reason: KITCHEN_AI_ERROR_REASONS.AI_FAILED } });
    }
    expect(w.usageRows().map((r) => [r.ok, r.audio_seconds])).toEqual([[0, 3], [0, 3], [0, 3]]);
    w.close();
  });

  it("at the month's budget: 503 budget, no call", async () => {
    const w = await stoveWorld({ env: { AI_MONTHLY_BUDGET_USD: "0" } });
    const res = await speak(w, webm());
    expect(res.status).toBe(503);
    expect(res.body.error).toMatchObject({ details: { reason: KITCHEN_AI_ERROR_REASONS.BUDGET } });
    expect(w.voice.calls).toHaveLength(0);
    w.close();
  });
});

describe("transcription: the audio is never stored or logged (AI-5)", () => {
  const TABLES = "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'";

  it("no audio bytes reach the logs, the usage rows or any table — on a transcript and a failure", async () => {
    const w = await stoveWorld();
    const clip = webm(6000);
    for (let i = 12; i < clip.length; i++) clip[i] = (i * 7) % 251;
    const needle = Buffer.from(clip).toString("base64").slice(200, 240);
    const counts = () =>
      (w.h.db.prepare(TABLES).all() as Array<{ name: string }>)
        .filter((t) => t.name !== "kitchen_ai_usage")
        .map((t) => [t.name, (w.h.db.prepare(`SELECT COUNT(*) AS n FROM "${t.name}"`).get() as { n: number }).n]);
    const before = counts();
    const logged: string[] = [];
    const levels = ["log", "info", "warn", "error", "debug"] as const;
    const originals = levels.map((level) => [level, console[level]] as const);
    for (const level of levels) console[level] = (...args: unknown[]) => void logged.push(args.map((a) => String(a)).join(" "));
    try {
      w.voice.script.push(heard("next"), { throws: new Error(`echoed ${needle}`) });
      expect((await speak(w, clip)).status).toBe(200);
      expect((await speak(w, clip)).status).toBe(502);
    } finally {
      for (const [level, original] of originals) console[level] = original;
    }
    expect(logged.join("\n")).not.toContain(needle);
    expect(counts()).toEqual(before);
    for (const t of w.h.db.prepare(TABLES).all() as Array<{ name: string }>) {
      expect(JSON.stringify(w.h.db.prepare(`SELECT * FROM "${t.name}"`).all())).not.toContain(needle);
    }
    w.close();
  });

  it("stubAi keeps what it was sent (the test's own record, not the worker's)", () => {
    expect(stubAi().calls).toEqual([]);
  });
});
