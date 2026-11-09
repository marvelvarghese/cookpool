// Check it and Something wrong? (cookpool-ai AI-5, design §5a), through the
// router with a stubbed model: the photo against the step (the four
// verdicts, `problem` naming a chip, Sonnet for `cant_tell` only with
// escalation on), the rescue (chips, Something else's text, an optional
// photo, at most 4 steps), the safety rules on both — never "safe to eat",
// meat doneness always with how to check — and that photos are never stored.

import { AI_STOVE_DONENESS_CHECK, type AiCheckStepResponse, type AiRescueResponse } from "@saas/contracts/kitchen";
import { CHECK_STEP_MAX_TOKENS, RESCUE_MAX_TOKENS } from "@kitchen-worker/ai/stove-tasks";
import { RAHUL, answer, type AiWorld } from "./ai-helpers.js";
import { CHECK, RESCUE, stoveWorld, userText, type StoveWorld } from "./ai-stove-helpers.js";
import { jpeg, png, webp } from "./ai-receipt-helpers.js";

const check = (w: AiWorld, body: Record<string, unknown>) => w.call<AiCheckStepResponse>("POST", CHECK, RAHUL, body);
const rescue = (w: AiWorld, body: Record<string, unknown>) => w.call<AiRescueResponse>("POST", RESCUE, RAHUL, body);
const verdict = (v: string, say: string, problem: string | null = null, opts: Parameters<typeof answer>[1] = {}) =>
  answer({ verdict: v, say, problem }, opts);
const fix = (title: string, steps: string[], say: string, opts: Parameters<typeof answer>[1] = {}) => answer({ title, steps, say }, opts);
const at = (w: StoveWorld, step: number, extra: Record<string, unknown> = {}) => ({ recipeId: w.curry.id, stepKey: w.keys[step], ...extra });
const content = (w: StoveWorld, i = 0) => w.ai.sent[i]!.messages[0]!.content as unknown as Array<Record<string, unknown> & { text?: string }>;

describe("check-step: the photo against the step (AI-5)", () => {
  it("sends the recipe block (cached), the photo, then the step and the verdict rules; 200-token cap", async () => {
    const w = await stoveWorld();
    const image = jpeg();
    w.ai.script.push(verdict("not_yet", "Nearly: a few more minutes till they're golden."));
    const res = await check(w, at(w, 1, { factor: 1500, image }));
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ verdict: "not_yet", say: "Nearly: a few more minutes till they're golden." });
    const [block, photo, tail] = content(w);
    expect(block).toMatchObject({ type: "text", cache_control: { type: "ephemeral" } });
    expect(photo).toEqual({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: image } });
    expect(tail!.text).toContain("The cook is on S2 of 5: Brown the onions");
    expect(tail!.text).toContain('"looks_right"');
    expect(w.ai.sent[0]).toMatchObject({ model: "claude-haiku-5-5", max_tokens: CHECK_STEP_MAX_TOKENS });
    expect(w.usageRows()).toEqual([expect.objectContaining({ feature: "ask_step", ok: 1 })]);
    w.close();
  });

  it("returns each verdict; a problem names its chip, and a problem without one is `other`", async () => {
    const w = await stoveWorld();
    w.ai.script.push(
      verdict("looks_right", "Golden brown: on to the tomatoes."),
      verdict("problem", "The bottom is catching: flame off.", "burning"),
      verdict("problem", "Something looks off.", null),
      verdict("cant_tell", "Too much steam: try again from above.", "burning"),
    );
    const got = [];
    for (let i = 0; i < 4; i++) got.push((await check(w, at(w, 1, { image: webp() }))).body.data);
    expect(got).toEqual([
      { verdict: "looks_right", say: "Golden brown: on to the tomatoes." },
      { verdict: "problem", say: "The bottom is catching: flame off.", problem: "burning" },
      { verdict: "problem", say: "Something looks off.", problem: "other" },
      // `problem` only rides with a problem.
      { verdict: "cant_tell", say: "Too much steam: try again from above." },
    ]);
    expect(w.ai.sent).toHaveLength(4);
    w.close();
  });

  it("the photo is checked as a receipt's: required, JPEG or WebP, ≤ 1.5 MB", async () => {
    const w = await stoveWorld();
    for (const image of [undefined, "", png(), "not base64!!"]) {
      const res = await check(w, at(w, 1, image === undefined ? {} : { image }));
      expect(res.status).toBe(422);
      expect(Object.keys((res.body.error?.details as { fields: object }).fields)).toEqual(["image"]);
    }
    expect(w.ai.sent).toHaveLength(0);
    w.close();
  });

  it("cant_tell: escalation off returns it (one call); on, Sonnet looks once and its verdict is returned", async () => {
    const off = await stoveWorld();
    off.ai.script.push(verdict("cant_tell", "Too dark to see: turn the light on."));
    expect((await check(off, at(off, 1, { image: jpeg() }))).body.data.verdict).toBe("cant_tell");
    expect(off.ai.sent).toHaveLength(1);
    off.close();

    const on = await stoveWorld({ escalate: true });
    on.ai.script.push(verdict("cant_tell", "Too dark."), verdict("looks_right", "Golden: go on.", null, { model: "claude-sonnet-5-5" }));
    expect((await check(on, at(on, 1, { image: jpeg() }))).body.data).toEqual({ verdict: "looks_right", say: "Golden: go on." });
    expect(on.ai.sent.map((s) => s.model)).toEqual(["claude-haiku-5-5", "claude-sonnet-5-5"]);
    expect(on.usageRows()).toEqual([expect.objectContaining({ model: "claude-sonnet-5-5", ok: 1 })]);
    // Sonnet failing its check leaves Haiku's cant_tell standing.
    on.ai.script.push(verdict("cant_tell", "Too dark."), verdict("looks_right", "It is safe to eat."));
    expect((await check(on, at(on, 1, { image: jpeg() }))).body.data).toEqual({ verdict: "cant_tell", say: "Too dark." });
    on.close();
  });

  it("a say over 60 words: trimmed with escalation off, retried on Sonnet with it on", async () => {
    const long = Array.from({ length: 70 }, () => "stir").join(" ");
    const off = await stoveWorld();
    off.ai.script.push(verdict("not_yet", long));
    const trimmed = (await check(off, at(off, 1, { image: jpeg() }))).body.data.say;
    expect(trimmed.split(/\s+/)).toHaveLength(60);
    off.close();
    const on = await stoveWorld({ escalate: true });
    on.ai.script.push(verdict("not_yet", long), verdict("not_yet", "Two more minutes.", null, { model: "claude-sonnet-5-5" }));
    expect((await check(on, at(on, 1, { image: jpeg() }))).body.data.say).toBe("Two more minutes.");
    on.close();
  });
});

describe("the safety rules (AI-5, design §5a)", () => {
  it("'safe to eat' from a photo fails the answer: 502 with escalation off; Sonnet's safe answer with it on", async () => {
    const off = await stoveWorld();
    off.ai.script.push(verdict("looks_right", "Looks great, it's safe to eat now!"));
    const res = await check(off, at(off, 2, { image: jpeg() }));
    expect(res.status).toBe(502);
    expect(res.body.error).toMatchObject({ details: { reason: "ai_failed" } });
    expect(off.usageRows()).toEqual([expect.objectContaining({ ok: 0 })]);
    off.close();

    const on = await stoveWorld({ escalate: true });
    on.ai.script.push(verdict("looks_right", "Perfectly safe to eat."), verdict("looks_right", "The oil has separated: add the chicken."));
    expect((await check(on, at(on, 2, { image: jpeg() }))).body.data.say).toBe("The oil has separated: add the chicken.");
    on.close();
  });

  it("the same holds for a question and a rescue", async () => {
    const w = await stoveWorld();
    w.ai.script.push(answer({ answer: "Yes, it is fine to eat." }), fix("Saved", ["Add water."], "Don't worry, it's safe to serve."));
    expect((await w.call("POST", "/v1/kitchen/me/ai/ask-step", RAHUL, at(w, 3, { question: "Can I eat it?" }))).status).toBe(502);
    expect((await rescue(w, at(w, 2, { problem: "too_thick" }))).status).toBe(502);
    w.close();
  });

  it("a negated claim is not a claim: \"I can't tell from a photo if it's safe to eat\" passes", async () => {
    const w = await stoveWorld();
    w.ai.script.push(verdict("cant_tell", "I can't tell from a photo if it's safe to eat; check the oil has separated."));
    expect((await check(w, at(w, 2, { image: jpeg() }))).status).toBe(200);
    w.close();
  });

  it("chicken doneness without how to check gets the check line, on the photo and on a question — with one call", async () => {
    const w = await stoveWorld();
    w.ai.script.push(verdict("looks_right", "The chicken looks done."), answer({ answer: "Yes, it should be cooked by now." }));
    const photo = (await check(w, at(w, 3, { image: jpeg() }))).body.data;
    expect(photo).toEqual({ verdict: "looks_right", say: `The chicken looks done. ${AI_STOVE_DONENESS_CHECK}` });
    const asked = await w.call<{ answer: string }>("POST", "/v1/kitchen/me/ai/ask-step", RAHUL, at(w, 3, { question: "Is the chicken cooked?" }));
    expect(asked.body.data.answer).toBe(`Yes, it should be cooked by now. ${AI_STOVE_DONENESS_CHECK}`);
    expect(w.ai.sent).toHaveLength(2);
    w.close();
  });

  it("an answer that already says how to check is kept as it is; a vegetarian step needs no line", async () => {
    const w = await stoveWorld();
    const good = "Cut the thickest piece: no pink and clear juices means it's done.";
    w.ai.script.push(verdict("looks_right", good), answer({ answer: "The rajma is done when it mashes easily." }));
    expect((await check(w, at(w, 3, { image: jpeg() }))).body.data.say).toBe(good);
    const rajma = await w.call<{ answer: string }>("POST", "/v1/kitchen/me/ai/ask-step", RAHUL, {
      recipeId: w.rajma.id,
      stepKey: w.rajma.guidedSteps![0]!.key,
      question: "Is it done?",
    });
    expect(rajma.body.data.answer).toBe("The rajma is done when it mashes easily.");
    w.close();
  });

  it("the line fits: a long doneness answer is cut so the whole stays within 60 words", async () => {
    const w = await stoveWorld();
    const long = `${Array.from({ length: 30 }, () => "simmer").join(" ")}. The chicken looks cooked. ${Array.from({ length: 20 }, () => "stir").join(" ")}.`;
    w.ai.script.push(verdict("looks_right", long));
    const say = (await check(w, at(w, 3, { image: jpeg() }))).body.data.say;
    expect(say.endsWith(AI_STOVE_DONENESS_CHECK)).toBe(true);
    expect(say.split(/\s+/).length).toBeLessThanOrEqual(60);
    w.close();
  });

  it("the prompt says it: never safe to eat, how to check doneness, 74 °C for chicken", async () => {
    const w = await stoveWorld();
    w.ai.script.push(verdict("not_yet", "Keep going."));
    await check(w, at(w, 3, { image: jpeg() }));
    const system = (w.ai.sent[0]!.system as Array<{ text: string }>).map((b) => b.text).join("\n");
    for (const rule of ["Never say food is safe to eat", "thickest piece", "no pink", "juices run clear", "74 °C", "never instructions"]) {
      expect(system).toContain(rule);
    }
    w.close();
  });
});

describe("rescue: Something wrong? (AI-5)", () => {
  it("a chip on the step: the problem in words, a 400-token cap, and the fix", async () => {
    const w = await stoveWorld();
    const steps = ["Turn the flame off.", "Move the top into a clean pan without scraping.", "Taste for a burnt smell.", "Go on at low."];
    w.ai.script.push(fix("Save the top", steps, "Flame off, and move the top to a clean pan. Don't scrape the bottom."));
    const res = await rescue(w, at(w, 2, { factor: 1500, problem: "burning" }));
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ title: "Save the top", steps, say: "Flame off, and move the top to a clean pan. Don't scrape the bottom." });
    const tail = userText(w.ai.sent[0]!);
    expect(tail).toContain("<problem>It is burning or catching at the bottom.</problem>");
    expect(tail).toContain("The cook is on S3 of 5");
    expect(tail).toContain("flame off first, move the top to a clean pan without scraping");
    expect(w.ai.sent[0]).toMatchObject({ max_tokens: RESCUE_MAX_TOKENS });
    expect(content(w).map((b) => b.type)).toEqual(["text", "text"]);
    w.close();
  });

  it("Something else needs its words; an optional photo goes beside them", async () => {
    const w = await stoveWorld();
    expect(Object.keys((await rescue(w, at(w, 2, { problem: "other" }))).body.error?.details?.fields as object)).toEqual(["text"]);
    for (const bad of [{ problem: "too_spicy" }, { problem: "burning", text: "x".repeat(201) }, { problem: "burning", image: png() }]) {
      expect((await rescue(w, at(w, 2, bad))).status).toBe(422);
    }
    expect(w.ai.sent).toHaveLength(0);
    const image = jpeg();
    w.ai.script.push(fix("Smooth it", ["Whisk it off the heat."], "Whisk it off the heat."));
    expect((await rescue(w, at(w, 2, { problem: "other", text: "  it went lumpy ", image }))).status).toBe(200);
    expect(content(w).map((b) => b.type)).toEqual(["text", "image", "text"]);
    expect(userText(w.ai.sent[0]!)).toContain("<words>it went lumpy</words>");
    w.close();
  });

  it("more than 4 steps or a long say: the first 4, trimmed, with escalation off; Sonnet with it on", async () => {
    const off = await stoveWorld();
    off.ai.script.push(fix("Fix", ["a.", "b.", "c.", "d.", "e."], "Do it."));
    expect((await rescue(off, at(off, 2, { problem: "too_watery" }))).body.data).toEqual({ title: "Fix", steps: ["a.", "b.", "c.", "d."], say: "Do it." });
    off.close();
    const on = await stoveWorld({ escalate: true });
    on.ai.script.push(fix("Fix", ["a.", "b.", "c.", "d.", "e."], "Do it."), fix("Reduce it", ["Simmer uncovered."], "Simmer it uncovered."));
    expect((await rescue(on, at(on, 2, { problem: "too_watery" }))).body.data.title).toBe("Reduce it");
    on.close();
  });

  it("no steps or no title: 502 even without escalation (nothing to save)", async () => {
    const w = await stoveWorld();
    w.ai.script.push(fix("Fix", [], "Do it."), fix(" ", ["Stir."], "Stir."));
    expect((await rescue(w, at(w, 2, { problem: "too_thick" }))).status).toBe(502);
    expect((await rescue(w, at(w, 2, { problem: "too_thick" }))).status).toBe(502);
    w.close();
  });

  it("a chicken rescue about doneness says how to check", async () => {
    const w = await stoveWorld();
    w.ai.script.push(fix("Give it time", ["Cover it.", "Cook ten more minutes on low."], "Cover it and give it ten more minutes till it's cooked."));
    const res = await rescue(w, at(w, 3, { problem: "not_cooking" }));
    expect(res.body.data.say.endsWith(AI_STOVE_DONENESS_CHECK)).toBe(true);
    w.close();
  });
});

describe("photos are never stored or logged (AI-5)", () => {
  it("no photo bytes reach the logs, the usage rows or any table", async () => {
    const w = await stoveWorld();
    const image = jpeg(5000);
    const needle = image.slice(100, 140);
    const logged: string[] = [];
    const levels = ["log", "info", "warn", "error", "debug"] as const;
    const originals = levels.map((level) => [level, console[level]] as const);
    for (const level of levels) console[level] = (...args: unknown[]) => void logged.push(args.map(String).join(" "));
    try {
      w.ai.script.push(verdict("not_yet", "Keep going."), { throws: new Error(`echo ${needle}`) }, fix("Fix", ["Stir."], "Stir."));
      expect((await check(w, at(w, 1, { image }))).status).toBe(200);
      expect((await check(w, at(w, 1, { image }))).status).toBe(502);
      expect((await rescue(w, at(w, 1, { problem: "burning", image }))).status).toBe(200);
    } finally {
      for (const [level, original] of originals) console[level] = original;
    }
    expect(logged.join("\n")).not.toContain(needle);
    const tables = w.h.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'").all() as Array<{ name: string }>;
    for (const t of tables) expect(JSON.stringify(w.h.db.prepare(`SELECT * FROM "${t.name}"`).all())).not.toContain(needle);
    expect(w.usageRows()).toHaveLength(3);
    w.close();
  });
});
