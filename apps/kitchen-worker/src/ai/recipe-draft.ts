import {
  AI_RECIPE_PHOTO_DEFAULT_SERVES_HALF,
  AI_RECIPE_PHOTO_MAX_LINES,
  AI_RECIPE_PHOTO_MAX_STEPS,
  MAX_RECIPE_LINE_NAME,
  MAX_RECIPE_MINUTES,
  MAX_RECIPE_NAME,
  MAX_RECIPE_SERVES_HALF,
  MAX_RECIPE_STEP,
  MAX_RECIPE_TOOL,
  MAX_RECIPE_TOOLS,
  MAX_RECIPE_UNIT_WORD,
  MAX_STEP_CHECKPOINT,
  MAX_STEP_HEAT,
  MAX_STEP_SECONDS,
  MAX_STEP_TIP,
  MAX_STEP_WHISTLES,
  RECIPE_UNIT_KEYS,
  isRecipeUnit,
  recipeUnitOf,
  type AiRecipeCheck,
  type AiRecipeDraft,
  type AiRecipeDraftLine,
  type AiRecipeDraftStep,
  type RecipeKind,
  type StepHeat,
  type StepPhase,
  type StepSense,
  type StepTimeRule,
} from "@saas/contracts/kitchen";
import { toMilli } from "@saas/kitchen-engine/units";

// Recipe from a photo (Cookpool AI, AI-4, design §4): the model's read of a
// recipe photo → a draft in the create route's shape, and the checks the
// form marks. One pass does both jobs:
//
//   - **Safe fixes** are made and noted as a check, and do not fail the read:
//     a step's line ref that is out of range or names a line twice (dropped),
//     a time range given backwards (swapped) or as a max alone (min = max), a
//     sense without a checkpoint (dropped), text past its limit (shortened),
//     servings or minutes out of range, more than 30 lines or 20 steps (the
//     first kept), a unit spelled out ("tablespoons" → tbsp).
//   - **Problems** fail the read (→ the one Sonnet retry when AI_ESCALATE is
//     on): a line with no name, an amount that doesn't parse in its unit, a
//     step with no text, a time outside 0–24 h, a flame outside 0–3, whistles
//     outside 1–10 or beside a time, and a read with no line and no step. Each
//     is also mended the way that loses least — the line or step dropped, the
//     amount, time, flame or whistles cleared — with a check, so with
//     escalation off (AI-13) the mended draft is what is returned.
//
// Checks the model asked for (an amount it couldn't read, a flame or a time
// not written on the page, words it couldn't make out) and one the server
// adds (a step on the flame with no time and nothing to watch for) are
// checks only: they never fail the read.

/** The model's answer, as the schema shapes it (../ai/recipe-photo-task.ts). */
export interface RecipeAnswer {
  name: string | null;
  serves: number | null;
  minutes: number | null;
  kind: RecipeKind | null;
  lines: Array<{
    name: string;
    note: string | null;
    quantity: number | null;
    unit: string | null;
    toTaste: boolean;
    amountUnclear: boolean;
  }>;
  steps: Array<{
    text: string;
    phase: StepPhase;
    lines: number[];
    heat: number | null;
    minSeconds: number | null;
    maxSeconds: number | null;
    whistles: number | null;
    handsOff: boolean;
    timeRule: StepTimeRule;
    sense: StepSense | null;
    checkpoint: string | null;
    tip: string | null;
    unclear: Array<"text" | "flame" | "time">;
  }>;
  tools: string[];
}

/** The draft, its checks, and each line's plain ingredient name (for the food list). */
export interface DraftRead {
  draft: AiRecipeDraft;
  checks: AiRecipeCheck[];
  /** `foods[i]` is line i's ingredient without its note ("Onions" for "Onions, sliced"). */
  foods: string[];
}

export interface DraftBuild extends DraftRead {
  /** What failed the read; empty when it passes. */
  problems: string[];
  /** Nothing usable: no line and no step. */
  empty: boolean;
}

/** Spellings a recipe writes its units in, folded to the app's units. Anything else that is a word is a count word ("clove"). */
const UNIT_SPELLINGS: Record<string, string> = {
  g: "g", gm: "g", gms: "g", gr: "g", gram: "g", grams: "g", gramme: "g", grammes: "g",
  kg: "kg", kgs: "kg", kilo: "kg", kilos: "kg", kilogram: "kg", kilograms: "kg",
  ml: "ml", mls: "ml", millilitre: "ml", millilitres: "ml", milliliter: "ml", milliliters: "ml",
  l: "L", ltr: "L", ltrs: "L", litre: "L", litres: "L", liter: "L", liters: "L",
  pc: "pcs", pcs: "pcs", piece: "pcs", pieces: "pcs", no: "pcs", nos: "pcs",
  tsp: "tsp", tsps: "tsp", teaspoon: "tsp", teaspoons: "tsp",
  tbsp: "tbsp", tbsps: "tbsp", tbs: "tbsp", tbl: "tbsp", tablespoon: "tbsp", tablespoons: "tbsp",
  cup: "cup", cups: "cup",
};

/** A count word as the create route takes it: letters (and spaces between), 1 to MAX_RECIPE_UNIT_WORD. */
const UNIT_WORD_RE = new RegExp(`^[a-z](?:[a-z ]{0,${MAX_RECIPE_UNIT_WORD - 2}}[a-z])?$`);

/** A unit as the create route would store it: one of the app's (any case or spelling), else a count word; null when neither. */
export function recipeUnit(raw: string | null): string | null {
  if (raw === null) return null;
  const word = raw.trim().replace(/\.$/, "").toLowerCase().replace(/\s+/g, " ");
  const known = RECIPE_UNIT_KEYS.find((u) => u.toLowerCase() === word) ?? UNIT_SPELLINGS[word];
  if (known) return known;
  return UNIT_WORD_RE.test(word) ? word : null;
}

/** Trimmed text, whitespace folded, cut at `max` (on a word when one is near): null when empty. */
function clip(text: string | null, max: number): { text: string | null; cut: boolean } {
  const folded = text?.replace(/\s+/g, " ").trim() ?? "";
  if (folded === "") return { text: null, cut: false };
  if (folded.length <= max) return { text: folded, cut: false };
  const head = folded.slice(0, max);
  const space = head.lastIndexOf(" ");
  return { text: (space > max * 0.6 ? head.slice(0, space) : head).trim(), cut: true };
}

const plain3 = (n: number): number => Math.round(n * 1000) / 1000;
const whole = (n: number | null, min: number, max: number): boolean => n === null || (Number.isSafeInteger(n) && n >= min && n <= max);

/** Build the draft from the model's answer: every safe fix and mend made, every check and problem noted. */
export function buildDraft(answer: RecipeAnswer): DraftBuild {
  const checks: AiRecipeCheck[] = [];
  const problems: string[] = [];
  const check = (path: string, message: string) => {
    if (!checks.some((c) => c.path === path && c.message === message)) checks.push({ path, message });
  };
  /** A problem fails the read; its mend is noted as a check either way. */
  const problem = (what: string, path: string, message: string) => {
    problems.push(what);
    check(path, message);
  };

  // ── The recipe ──
  const name = clip(answer.name, MAX_RECIPE_NAME);
  if (!name.text) check("name", "No name on the page: name it");
  else if (name.cut) check("name", "Shortened: check the name");

  let servesHalf: number = AI_RECIPE_PHOTO_DEFAULT_SERVES_HALF;
  if (answer.serves === null) check("servesHalf", "Serves isn't on the page: check it");
  else {
    const half = Number.isFinite(answer.serves) ? Math.round(answer.serves * 2) : Number.NaN;
    if (half >= 1 && half <= MAX_RECIPE_SERVES_HALF) servesHalf = half;
    else check("servesHalf", "Couldn't read how many it serves: check it");
  }

  let minutes: number | null = null;
  if (answer.minutes !== null) {
    if (whole(answer.minutes, 1, MAX_RECIPE_MINUTES)) minutes = answer.minutes;
    else check("minutes", "Couldn't read the time it takes: check it");
  }

  // ── Lines ──
  const lines: AiRecipeDraftLine[] = [];
  const foods: string[] = [];
  /** The model's line index → the draft's position, or -1 when the line was dropped. */
  const lineAt: number[] = [];
  if (answer.lines.length > AI_RECIPE_PHOTO_MAX_LINES) check("lines", `Only the first ${AI_RECIPE_PHOTO_MAX_LINES} lines were kept`);
  answer.lines.slice(0, AI_RECIPE_PHOTO_MAX_LINES).forEach((raw, i) => {
    const food = clip(raw.name, MAX_RECIPE_LINE_NAME).text;
    if (!food) {
      lineAt.push(-1);
      return problem(`lines[${i}]: no name`, "lines", "A line couldn't be read: check the list against the photo");
    }
    const at = `lines[${lines.length}]`;
    const note = clip(raw.note, MAX_RECIPE_LINE_NAME).text;
    const full = clip(note ? `${food}, ${note}` : food, MAX_RECIPE_LINE_NAME).text!;
    let quantity: number | null = null;
    let unit: string | null = null;
    if (!raw.toTaste) {
      if (raw.quantity === null && raw.unit === null) check(`${at}.quantity`, "No amount on the page: add one, or say to taste");
      else {
        const u = recipeUnit(raw.unit);
        const q = raw.quantity !== null && Number.isFinite(raw.quantity) ? plain3(raw.quantity) : null;
        let parses = false;
        if (u !== null && q !== null && q > 0) {
          try {
            toMilli(q, isRecipeUnit(u) ? u : "pcs");
            parses = true;
          } catch {
            parses = false;
          }
        }
        if (parses) {
          quantity = q;
          unit = u;
          if (raw.amountUnclear) check(`${at}.quantity`, "Check the amount against the photo");
        } else {
          problem(`lines[${i}]: the amount does not parse`, `${at}.quantity`, "Couldn't read the amount: add it");
        }
      }
    }
    lineAt.push(lines.length);
    lines.push({ foodKey: null, name: full, quantity, unit, toTaste: raw.toTaste, isMain: false });
    foods.push(food);
  });
  // The main line, by the create route's rule: the first by weight, else the first with an amount.
  const main =
    lines.find((l) => l.quantity !== null && l.unit !== null && recipeUnitOf(l.unit).dimension === "mass") ??
    lines.find((l) => l.quantity !== null);
  if (main) main.isMain = true;
  else if (lines.length > 0) check("lines", "No line has an amount: add one to scale the recipe by");

  // ── Steps ──
  const steps: AiRecipeDraftStep[] = [];
  if (answer.steps.length > AI_RECIPE_PHOTO_MAX_STEPS) check("steps", `Only the first ${AI_RECIPE_PHOTO_MAX_STEPS} steps were kept`);
  answer.steps.slice(0, AI_RECIPE_PHOTO_MAX_STEPS).forEach((raw, j) => {
    const said = clip(raw.text, MAX_RECIPE_STEP);
    if (!said.text) return problem(`steps[${j}]: no text`, "steps", "A step couldn't be read: check the steps against the photo");
    const at = `steps[${steps.length}]`;
    if (said.cut) check(`${at}.text`, "Shortened: check the words");

    // Its lines: the draft's positions, each once; a ref to no line (or a dropped one) is dropped.
    const refs: number[] = [];
    let badRef = false;
    for (const ref of raw.lines) {
      const to = Number.isSafeInteger(ref) && ref >= 0 && ref < lineAt.length ? lineAt[ref]! : -1;
      if (to < 0 || refs.includes(to)) badRef = true;
      else refs.push(to);
    }
    if (badRef) check(`${at}.lines`, "A line it named isn't in the list: check its lines");

    let heat: StepHeat | null = null;
    if (whole(raw.heat, 0, MAX_STEP_HEAT)) heat = raw.heat as StepHeat | null;
    else problem(`steps[${j}]: the flame is out of range`, `${at}.heat`, "Couldn't read the flame: set it");

    let minSeconds: number | null = null;
    let maxSeconds: number | null = null;
    if (whole(raw.minSeconds, 0, MAX_STEP_SECONDS) && whole(raw.maxSeconds, 0, MAX_STEP_SECONDS)) {
      minSeconds = raw.minSeconds ?? raw.maxSeconds;
      maxSeconds = raw.maxSeconds ?? raw.minSeconds;
      if (minSeconds !== null && maxSeconds !== null && maxSeconds < minSeconds) {
        [minSeconds, maxSeconds] = [maxSeconds, minSeconds];
        check(`${at}.minSeconds`, "Check the time against the photo");
      }
    } else {
      problem(`steps[${j}]: the time is out of range`, `${at}.minSeconds`, "Couldn't read the time: set it");
    }

    let whistles: number | null = null;
    if (!whole(raw.whistles, 1, MAX_STEP_WHISTLES)) {
      problem(`steps[${j}]: whistles out of range`, `${at}.whistles`, "Couldn't read the whistles: set them");
    } else if (raw.whistles !== null && (raw.minSeconds !== null || raw.maxSeconds !== null)) {
      // A pressure cooker counts whistles: they are the more exact of the two.
      whistles = raw.whistles;
      minSeconds = null;
      maxSeconds = null;
      problem(`steps[${j}]: whistles and a time`, `${at}.whistles`, "Both whistles and a time: check which");
    } else {
      whistles = raw.whistles;
    }

    const checkpoint = clip(raw.checkpoint, MAX_STEP_CHECKPOINT).text;
    const tip = clip(raw.tip, MAX_STEP_TIP).text;
    const step: AiRecipeDraftStep = {
      text: said.text,
      phase: raw.phase,
      lines: refs,
      heat,
      minSeconds,
      maxSeconds,
      whistles,
      handsOff: raw.handsOff,
      timeRule: raw.timeRule,
      sense: checkpoint ? raw.sense : null,
      checkpoint,
      tip,
    };

    if (raw.unclear.includes("text")) check(`${at}.text`, "Check the words against the photo");
    if (raw.unclear.includes("flame")) check(`${at}.heat`, "The flame isn't on the page: check it");
    if (raw.unclear.includes("time")) check(`${at}.minSeconds`, "Check the time against the photo");
    const untimed = step.minSeconds === null && step.whistles === null && step.checkpoint === null;
    if (step.phase === "cook" && step.heat !== null && step.heat > 0 && untimed && !checks.some((c) => c.path === `${at}.minSeconds`)) {
      check(`${at}.minSeconds`, "No time for this step: add one, or what to watch for");
    }
    steps.push(step);
  });

  // ── Tools: trimmed, each once, at most MAX_RECIPE_TOOLS ──
  const tools: string[] = [];
  for (const raw of answer.tools) {
    const tool = clip(raw, MAX_RECIPE_TOOL).text;
    if (tool && !tools.some((t) => t.toLowerCase() === tool.toLowerCase()) && tools.length < MAX_RECIPE_TOOLS) tools.push(tool);
  }

  const empty = lines.length === 0 && steps.length === 0;
  if (empty) problems.push("nothing was read: no line and no step");
  return {
    draft: { name: name.text ?? "", servesHalf, minutes, kind: answer.kind, lines, steps, tools },
    checks,
    foods,
    problems,
    empty,
  };
}
