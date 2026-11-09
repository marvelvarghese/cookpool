import type { AiStatus } from "@saas/contracts/kitchen";
import { AI_SENT_LINES, AI_SETTINGS_HREF, aiSettingsView, todayBars, voiceMinutes } from "@web-console-next/components/kitchen/ai-settings";
import { aiSwitchOn, parseAiSwitches, type AiSwitchKey } from "@web-console-next/lib/ai-switches";

// cookpool-ai AI-7 (design §7, the canvas's AiSettings): You → Cookpool AI —
// this device's switches, today's use against the limits, the month's
// budget, and what is sent.

const status = (o: Partial<AiStatus> & { f?: Partial<AiStatus["features"]> } = {}): AiStatus => ({
  available: o.available ?? true,
  features: { sayIt: true, receipt: true, import: false, voice: false, swaps: false, ...(o.f ?? {}) },
  ...(o.budget === undefined ? { budget: "ok" as const } : { budget: o.budget }),
  today: o.today ?? { actions: 9, actionsLimit: 50, voiceSeconds: 0, voiceSecondsLimit: 1800, receipts: 2, receiptsLimit: 10 },
});
const allOn = () => true;
const keys = (v: ReturnType<typeof aiSettingsView>) => v.switches.map((s) => s.key);

describe("You → Cookpool AI", () => {
  it("lives at /you/ai", () => {
    expect(AI_SETTINGS_HREF).toBe("/you/ai");
  });

  it("lists Say what you used and Scan receipts always, the others once the server offers them", () => {
    expect(keys(aiSettingsView(status(), { loading: false, switchOn: allOn }))).toEqual(["sayIt", "receipt"]);
    expect(keys(aiSettingsView(status({ f: { import: true, voice: true, swaps: true } }), { loading: false, switchOn: allOn }))).toEqual(["sayIt", "receipt", "import", "voice", "swaps"]);
    expect(keys(aiSettingsView(status({ f: { voice: true } }), { loading: false, switchOn: allOn }))).toEqual(["sayIt", "receipt", "voice"]);
    expect(aiSettingsView(status({ f: { import: true, voice: true, swaps: true } }), { loading: false, switchOn: allOn }).switches.map((s) => s.label)).toEqual([
      "Say what you used",
      "Scan receipts",
      "Recipe from a photo",
      "Voice while cooking",
      "Swaps",
    ]);
    // Loading: the two that are always there.
    expect(keys(aiSettingsView(null, { loading: true, switchOn: allOn }))).toEqual(["sayIt", "receipt"]);
  });

  it("shows each switch as this device keeps it (AI-8's store)", () => {
    const raw = '{"receipt":false}';
    const v = aiSettingsView(status(), { loading: false, switchOn: (k: AiSwitchKey) => aiSwitchOn(raw, k) });
    expect(v.switches.map((s) => [s.key, s.on])).toEqual([
      ["sayIt", true],
      ["receipt", false],
    ]);
    expect(parseAiSwitches("not json")).toEqual({});
  });

  it("says why AI is off: no key, or the month's budget spent; and loading or failed", () => {
    expect(aiSettingsView(status(), { loading: false, switchOn: allOn })).toMatchObject({ state: "ready", notice: null, budget: "This month's AI budget · OK" });
    expect(aiSettingsView(status({ available: false }), { loading: false, switchOn: allOn })).toMatchObject({ state: "unset", notice: "AI isn't set up yet" });
    expect(aiSettingsView(status({ available: false, budget: "reached" }), { loading: false, switchOn: allOn })).toMatchObject({
      state: "resting",
      notice: "Cookpool AI is resting until the 1st",
      budget: "This month's AI budget · resting until the 1st",
    });
    expect(aiSettingsView(null, { loading: true, switchOn: allOn })).toMatchObject({ state: "loading", today: [], budget: null });
    expect(aiSettingsView(null, { loading: false, switchOn: allOn })).toMatchObject({ state: "failed" });
    // A status from before AI-13 has no budget: no budget line.
    const old: AiStatus = { available: true, features: status().features, today: { actions: 1, actionsLimit: 50, voiceSeconds: 0, voiceSecondsLimit: 1800 } };
    expect(aiSettingsView(old, { loading: false, switchOn: allOn }).budget).toBeNull();
  });

  it("shows today's use against the limits as bars: actions, receipts, and voice minutes once voice is offered", () => {
    expect(todayBars(status())).toEqual([
      { label: "AI actions", text: "9 of 50", pct: 18, full: false },
      { label: "Receipts", text: "2 of 10", pct: 20, full: false },
    ]);
    const voice = todayBars(status({ f: { voice: true }, today: { actions: 50, actionsLimit: 50, voiceSeconds: 250, voiceSecondsLimit: 1800, receipts: 10, receiptsLimit: 10 } }));
    expect(voice).toEqual([
      { label: "AI actions", text: "50 of 50", pct: 100, full: true },
      { label: "Receipts", text: "10 of 10", pct: 100, full: true },
      { label: "Voice minutes", text: "5 of 30", pct: 17, full: false },
    ]);
    // Over the limit (the limits are soft): the bar stays full.
    expect(todayBars(status({ today: { actions: 52, actionsLimit: 50, voiceSeconds: 0, voiceSecondsLimit: 1800 } }))).toEqual([{ label: "AI actions", text: "52 of 50", pct: 100, full: true }]);
    expect(voiceMinutes(0)).toBe(0);
    expect(voiceMinutes(10)).toBe(1);
    expect(voiceMinutes(1800)).toBe(30);
  });

  it("says what is sent, the first-name exception included, and never money or groups", () => {
    expect(AI_SENT_LINES).toEqual([
      "Item names, amounts and the sentence you typed.",
      "First names of people in your groups, to read “Anu and I”.",
      "Never: money, balances, group names or full names.",
      "Receipt and recipe photos and voice clips are read, then deleted.",
    ]);
    expect(aiSettingsView(status(), { loading: false, switchOn: allOn }).sent).toBe(AI_SENT_LINES);
  });
});
