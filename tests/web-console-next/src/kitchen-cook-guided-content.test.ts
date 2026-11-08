import { readFileSync } from "node:fs";
import { cwd } from "node:process";
import {
  KITCHEN_TIMER_BODY_MAX,
  KITCHEN_TIMER_LABEL_MAX,
  type KitchenRecipeStep,
  type StepHeat,
  type StepPhase,
  type StepSense,
  type StepTimeRule,
} from "@saas/contracts/kitchen";
import { blankSession, type CookSession } from "@web-console-next/components/kitchen/cook-session";
import {
  chooseMode,
  cookSteps,
  countWhistle,
  guideFromRecipe,
  longPrepDone,
  longPrepSteps,
  markStepDone,
  startCooking,
  startTimer,
  timerBody,
  timerLabel,
  timerWork,
} from "@web-console-next/components/kitchen/cook-guided";
import { doneScreen, promptView, stepScreen, waitScreen } from "@web-console-next/components/kitchen/cook-guided-screens";
import { guideStepLog } from "@web-console-next/components/kitchen/cook-guide-draft";

// cookpool-guided GC-5 against GC-4's content: Cookpool's 42 recipes, as
// migration 390 writes their guided steps, each cooked through guided mode
// from the prompt to Done — every step shows, every timer's push fits GC-3's
// bounds, whistles count, and the step log has every cook step.

const SQL = readFileSync(`${cwd()}/../../packages/db/src/migrations/390_kitchen_cookpool_guided/up.sql`, "utf8");
const NOW = new Date("2026-11-08T12:00:00.000Z");
const at = (seconds: number) => new Date(NOW.getTime() + seconds * 1000);

/** One SQL row's values: quoted strings ('' for a quote), numbers and NULL. */
function values(row: string): (string | number | null)[] {
  const out: (string | number | null)[] = [];
  let i = row.indexOf("(") + 1;
  while (i < row.length) {
    while (row[i] === " " || row[i] === ",") i++;
    if (row[i] === ")") break;
    if (row[i] === "'") {
      let text = "";
      i++;
      for (;;) {
        if (row[i] === "'" && row[i + 1] === "'") {
          text += "'";
          i += 2;
        } else if (row[i] === "'") {
          i++;
          break;
        } else text += row[i++];
      }
      out.push(text);
    } else {
      const end = row.slice(i).search(/[,)]/);
      const word = row.slice(i, i + end).trim();
      out.push(word === "NULL" ? null : Number(word));
      i += end;
    }
  }
  return out;
}

interface Content {
  id: string;
  name: string;
  tools: string[];
  steps: KitchenRecipeStep[];
}

/** 390's recipes: their names (from each block's heading), tools and guided steps. */
function cookpoolRecipes(): Content[] {
  const byId = new Map<string, Content>();
  let name = "";
  for (const line of SQL.split("\n")) {
    const heading = /^-- \d{2} (.+?): \d+ steps/.exec(line);
    if (heading) name = heading[1]!;
    const tools = /^UPDATE kitchen_recipes SET tools = '(.*)' WHERE id = '([^']+)';/.exec(line);
    if (tools) byId.set(tools[2]!, { id: tools[2]!, name, tools: JSON.parse(tools[1]!.replace(/''/g, "'")) as string[], steps: [] });
    if (!line.startsWith("  ('c00c0360-")) continue;
    const [recipeId, position, key, phase, text, lineRefs, heat, minSeconds, maxSeconds, whistles, handsOff, timeRule, sense, checkpoint, tip] = values(line);
    byId.get(recipeId as string)!.steps.push({
      position: position as number,
      key: key as string,
      text: text as string,
      phase: phase as StepPhase,
      lines: JSON.parse(lineRefs as string) as number[],
      heat: heat as StepHeat | null,
      minSeconds: minSeconds as number | null,
      maxSeconds: maxSeconds as number | null,
      whistles: whistles as number | null,
      handsOff: handsOff === 1,
      timeRule: timeRule as StepTimeRule,
      sense: sense as StepSense | null,
      checkpoint: checkpoint as string | null,
      tip: tip as string | null,
    });
  }
  return [...byId.values()];
}

/** A session from Cookpool's recipe, as written (no lines needed here: the chips are tested on fixtures). */
function sessionOf(r: Content): CookSession {
  const guide = guideFromRecipe({ guidedSteps: r.steps, tools: r.tools });
  return { ...blankSession(NOW), recipeId: `rcp_${r.id.replace(/-/g, "")}`, factorMilli: 1000, name: r.name, mine: false, ...(guide ? { guide } : {}) };
}

const RECIPES = cookpoolRecipes();

describe("Cookpool's 42 recipes in guided mode (GC-4's 390)", () => {
  it("are all read from 390, each with guided steps and a name", () => {
    expect(RECIPES).toHaveLength(42);
    // What guided mode has to handle is all there: pressure cookers, hands-off timers, long prep.
    expect(RECIPES.filter((r) => r.steps.some((st) => st.whistles !== null)).length).toBeGreaterThan(0);
    expect(RECIPES.filter((r) => r.steps.some((st) => st.phase === "cook" && st.handsOff && st.minSeconds !== null)).length).toBeGreaterThan(0);
    for (const r of RECIPES) {
      expect([r.name, r.steps.length > 0, cookSteps(guideFromRecipe({ guidedSteps: r.steps, tools: r.tools })!).length > 0]).toEqual([r.name, true, true]);
    }
  });

  it("each opens on the prompt; long prep comes first and holds the start", () => {
    const withLong = RECIPES.filter((r) => longPrepSteps(sessionOf(r).guide!).length > 0).map((r) => r.name);
    expect(withLong.length).toBeGreaterThanOrEqual(4);
    for (const r of RECIPES) {
      const v = promptView(sessionOf(r), NOW)!;
      expect([r.name, v.dimmed]).toEqual([r.name, withLong.includes(r.name)]);
      for (const l of v.longPrep) expect(l.startLabel).toMatch(/ now · ping me$/);
    }
  });

  it("each cooks from the first step to Done: every step shows, every push fits, whistles count, the log has every cook step", () => {
    for (const r of RECIPES) {
      let s = chooseMode(sessionOf(r), "guided", NOW);
      for (const l of longPrepSteps(s.guide!)) s = longPrepDone(s, l.key, NOW);
      s = startCooking(s, NOW);
      const cook = cookSteps(s.guide!);
      let t = 0;
      for (const step of cook) {
        const g = s.guide!;
        expect([r.name, timerLabel(g, step, r.name).length <= KITCHEN_TIMER_LABEL_MAX, timerBody(g, step).length <= KITCHEN_TIMER_BODY_MAX]).toEqual([r.name, true, true]);
        const shown = s.guide!.current === step.key ? s : { ...s, guide: { ...g, current: step.key, screen: "step" as const } };
        const v = stepScreen(shown, at(t))!;
        expect([r.name, v.text]).toEqual([r.name, step.text]);
        if (v.checkpoint) expect(v.checkpoint.text).toMatch(/^Until /);
        if (step.whistles !== null) {
          expect([r.name, v.waiting, v.whistles?.of]).toEqual([r.name, true, step.whistles]);
          expect(waitScreen(shown, v, at(t))!.header).toMatch(/PRESSURE COOKER$/);
        } else if (step.handsOff && v.timer) {
          expect(v.timer.startLabel).toBe("Start and go on");
          const timed = startTimer(shown, step.key, at(t));
          for (const c of timerWork(timed, at(t + 1), true).create) {
            expect(c.request.label.length).toBeLessThanOrEqual(KITCHEN_TIMER_LABEL_MAX);
            expect(c.request.url).toBe("/cook/session");
          }
        }
        t += 60;
        s = { ...s, guide: { ...s.guide!, current: step.key, screen: "step", shownAt: at(t - 60).toISOString() } };
        if (step.whistles !== null) {
          for (let w = 0; w < step.whistles; w++) s = countWhistle(s, step.key, at(t));
        } else {
          s = markStepDone(s, step.key, at(t));
        }
      }
      const done = doneScreen(s, at(t))!;
      expect([r.name, s.guide!.screen, done.stats[1]!.value]).toEqual([r.name, "done", `${cook.length} of ${cook.length}`]);
      expect([r.name, guideStepLog(s.guide).length]).toEqual([r.name, cook.length]);
    }
  });
});
