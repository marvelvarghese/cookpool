import { AI_STOVE_DONENESS_CHECK, AI_STOVE_SAY_MAX_WORDS } from "@saas/contracts/kitchen";

// The stove's safety rules (Cookpool AI, AI-5, design §5a), checked on every
// answer the model gives — not only asked for in the prompt:
//
//   1. Never that food is safe to eat. "It's safe to eat", "fine to eat",
//      "safe for consumption", "won't make you sick" fail the answer, unless
//      negated ("I can't tell from a photo whether it's safe to eat").
//   2. Meat, eggs and seafood: when the step or the lines used so far have
//      them, and the question or the answer is about doneness (or a photo is
//      judged against a step that waits for doneness), the answer must say
//      how to check (the thickest piece, no pink, clear juices, 74 °C, set,
//      opaque, flakes). When it does not, the server adds
//      AI_STOVE_DONENESS_CHECK itself — so the rule holds whatever the model
//      says, without paying for a retry.

const PROTEIN =
  /\b(chicken|murgh|mutton|lamb|goat|gosht|beef|pork|bacon|ham|sausages?|meat|keema|kheema|mince|turkey|duck|eggs?|anda|omelet(te)?|fish|machh?(i|li)|salmon|tuna|pomfret|surmai|bangda|rohu|prawns?|shrimps?|jhinga|crabs?|lobsters?|squid|calamari|mussels?|clams?|oysters?|seafood)\b/i;

const DONENESS =
  /\b(done|cooked|undercooked|under-cooked|cook(ed)? through|raw|pink|rare|ready|juices?|tender|runny|opaque|safe|temperature|°c|degrees)\b/i;

const HOW_TO_CHECK =
  /(thickest|cut (it|one|a piece|into|open)|no pink|not pink|pink inside|juices? (run|are|is) clear|clear juices?|\b7[0-9]\s*°\s*c\b|\b7[0-9]\s*degrees\b|thermometer|opaque|flakes?\b|fully set|whites? (is |are )?set|yolks? (is |are )?set)/i;

const SAFE_TO_EAT =
  /\b(safe|fine|ok|okay|good|alright|all right)\s+(to|for)\s+(eat|eating|serve|serving|consume|consumption|have)\b|\bsafe for consumption\b|\bwon'?t (make (you|anyone) sick|harm you)\b|\bno risk\b|\bperfectly safe\b|\bcompletely safe\b/gi;

const NEGATION = /\b(not|never|no|cannot|can'?t|can ?not|couldn'?t|isn'?t|aren'?t|don'?t|unable|whether|if)\b|n't\b/i;

/** Does `text` claim food is safe to eat (a claim that is not negated just before it)? */
export function claimsSafeToEat(text: string): boolean {
  for (const match of text.matchAll(SAFE_TO_EAT)) {
    // Only the five words before it in its own clause count: a full stop, a
    // semicolon or a comma ends a negation ("Don't worry, it's safe to eat" claims it).
    const clause = text.slice(0, match.index ?? 0).split(/[.;:!?,]/).pop() ?? "";
    const near = clause.trim().split(/\s+/).slice(-5).join(" ");
    if (!NEGATION.test(near)) return true;
  }
  return false;
}

/**
 * Is this about the doneness of meat, eggs or seafood? `scope` is the step
 * and the lines used so far; `about` the question and the answer. A photo
 * judged against a step that waits for doneness ("until the chicken is
 * cooked") is about doneness whatever was asked.
 */
export function isProteinDoneness(scope: string, about: string, photo = false): boolean {
  return PROTEIN.test(`${scope}\n${about}`) && (DONENESS.test(about) || (photo && DONENESS.test(scope)));
}

/** Does the answer say how to check doneness? */
export function saysHowToCheck(text: string): boolean {
  return HOW_TO_CHECK.test(text);
}

/** The words of `text` (runs of non-space). */
export function wordCount(text: string): number {
  return text.trim() === "" ? 0 : text.trim().split(/\s+/).length;
}

/**
 * `text` in at most `max` words: cut at the last sentence end that fits,
 * else at `max` words with "…".
 */
export function fitWords(text: string, max = AI_STOVE_SAY_MAX_WORDS): string {
  const words = text.trim().split(/\s+/);
  if (words.length <= max) return text.trim();
  const head = words.slice(0, max).join(" ");
  const end = Math.max(head.lastIndexOf(". "), head.lastIndexOf("! "), head.lastIndexOf("? "));
  if (end > 0) return head.slice(0, end + 1);
  return /[.!?]$/.test(head) ? head : `${head}…`;
}

/** `text` with the doneness line added, the whole still within `max` words. */
export function withDonenessCheck(text: string, max = AI_STOVE_SAY_MAX_WORDS): string {
  const room = max - wordCount(AI_STOVE_DONENESS_CHECK);
  const head = fitWords(text, room);
  return head === "" ? AI_STOVE_DONENESS_CHECK : `${head}${/[.!?…]$/.test(head) ? "" : "."} ${AI_STOVE_DONENESS_CHECK}`;
}

/** Does the answer need the doneness line it lacks? */
export function needsDonenessCheck(text: string, scope: string, asked: string, photo = false): boolean {
  return isProteinDoneness(scope, `${asked}\n${text}`, photo) && !saysHowToCheck(text);
}
