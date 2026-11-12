/**
 * Faces for people (Cookpool SM-7, design §2 "Faces everywhere", rule 4):
 * Use, Dish and Bill pick people from the same row of faces, and the main
 * button says who it is for — "You + Anu · ₹8.50 each", "Anu · 1 portion".
 * This is the pure half (order, colours, toggling, the words); `FaceRow` and
 * `Face` (faces-ui.tsx) draw it. Dependency-free apart from the engine's
 * money formatting, so it is unit-testable.
 */

import { formatMinor } from "@saas/kitchen-engine/money";
import { memberLabel, sortMembers, type MemberNames } from "./members";

/** You first, then everyone else by name (the order faces and names are shown in). */
export function faceOrder(people: readonly string[], meId: string | null, names?: MemberNames | null): string[] {
  return sortMembers(people, meId, names);
}

/**
 * Your face is the app's green; everyone else's is one of these, by their id
 * (the canvas's colours, white text 4.8:1 or more). They are the `.cookpool`
 * face tokens (RV-19, globals.css), as CSS colours for a `style`, so yours
 * follows the accent into dark mode.
 */
export const ME_FACE = "hsl(var(--cp-face-me))";
export const FACE_COLORS: readonly string[] = [1, 2, 3, 4, 5, 6].map((n) => `hsl(var(--cp-face-${n}))`);

/** A person's colour: the same on every screen, on every device. */
export function faceColor(subjectId: string, meId: string | null): string {
  if (meId && subjectId === meId) return ME_FACE;
  let h = 0;
  for (const ch of subjectId) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return FACE_COLORS[h % FACE_COLORS.length]!;
}

/** Tap a face: in if out, out if in. Never mutates `chosen`. */
export function toggleFace(chosen: ReadonlySet<string>, subjectId: string): Set<string> {
  const next = new Set(chosen);
  if (next.has(subjectId)) next.delete(subjectId);
  else next.add(subjectId);
  return next;
}

/**
 * Who it is for, in the button: "You", "You + Anu", "You + Anu + Dev", "You +
 * Anu + 2 more" — in the order given (you first, as `faceOrder` and the
 * requests put it). Empty for nobody.
 */
export function forWhom(ids: readonly string[], meId: string | null, names?: MemberNames | null): string {
  const labels = ids.map((id) => memberLabel(id, meId, names));
  if (labels.length <= 3) return labels.join(" + ");
  return `${labels.slice(0, 2).join(" + ")} + ${labels.length - 2} more`;
}

/**
 * What each pays: "₹8.50 each" when the split is even, "≈ ₹3.33 each" when
 * the engine's rounding gives someone a paisa more; null for one person or
 * none (there is no "each").
 */
export function eachText(amounts: readonly number[], currency: string): string | null {
  if (amounts.length < 2) return null;
  const min = Math.min(...amounts);
  const max = Math.max(...amounts);
  if (min === max) return `${formatMinor(min, currency)} each`;
  const sum = amounts.reduce((s, a) => s + a, 0);
  return `≈ ${formatMinor(Math.round(sum / amounts.length), currency)} each`;
}

/** The button's second line: "You + Anu · ₹8.50 each", "Anu" — null for nobody. */
export function whoLine(input: {
  ids: readonly string[];
  meId: string | null;
  names?: MemberNames | null | undefined;
  /** What each person pays, in the same order (the engine's split); omit when it is not one amount each. */
  amounts?: readonly number[] | null | undefined;
  currency?: string | undefined;
}): string | null {
  const who = forWhom(input.ids, input.meId, input.names);
  if (!who) return null;
  const each = input.amounts && input.currency ? eachText(input.amounts, input.currency) : null;
  return each ? `${who} · ${each}` : who;
}
