/**
 * Share this cook? (cookpool-community CM-6, design §4, the canvas's
 * `ShareCook`), as data:
 *
 * - **When it's offered**: the cook's own dish that isn't canceled — open
 *   or finalized, split or not (CM-8 relaxed the server's rule; CM-9 dropped
 *   the "share on Finalize" gating) — from Cooked!'s Post to Community and
 *   the dish page's Post (cookpool-community CM-9, `cooked.ts`).
 * - **The composer**: the dish's name and recipe line, the photo slot (CM-4),
 *   the caption, WHAT IT SHOWS (size, time, how many ate, steps — values
 *   previewed from what the app already has; the server computes the real
 *   ones), and WHO SEES IT (Followers, Public, Just me; a private profile's
 *   Public reaches followers only; without a profile only Just me).
 * - **What Post sends**: the dish, the caption, the audience and the `show`
 *   flags — never a value.
 *
 * Pure (contract types and helpers), so unit-testable.
 */

import {
  DEFAULT_POST_AUDIENCE,
  POST_CAPTION_MAX,
  POST_SHOW_KEYS,
  type CreatePostRequest,
  type KitchenDish,
  type MyProfile,
  type PostAudience,
  type PostShow,
} from "@saas/contracts/kitchen";
import { amountText, halvesText, minutesText } from "./recipes";
import { guideStepLog, type CookGuide } from "./cook-guide-draft";
import { dishHref } from "./dish";
import { cookedHref, servingsOf } from "./cooked";

// ── When it's offered ─────────────────────────────────────────────

/** Whether a dish can be posted now: any that isn't canceled, before or after a split, open or finalized (CM-8's rule). */
export function dishPostable(dish: Pick<KitchenDish, "orgId" | "state">): boolean {
  return dish.state !== "canceled";
}

/** The dish page offers Share: the new frame, your own dish, postable. */
export function offersShare(isNewFrame: boolean, dish: Pick<KitchenDish, "cook" | "orgId" | "state">, meId: string | null): boolean {
  return isNewFrame && meId !== null && dish.cook === meId && dishPostable(dish);
}

/** The dish page with Share this cook? open: where Finish lands in the new frame. */
export function shareHref(dishId: string): string {
  return `${dishHref(dishId)}?share=1`;
}

/** Where Finish goes once the dish is cooked: Cooked! in the new frame (CM-9), else the dish as before. */
export function afterFinishHref(dish: Pick<KitchenDish, "id" | "orgId" | "state">, isNewFrame: boolean): string {
  return isNewFrame ? cookedHref(dish.id) : dishHref(dish.id);
}

// ── What the app knows of the cook ────────────────────────────────

/** The cook's step log, as the session had it (the dish read doesn't carry it). */
export interface StepSeed {
  /** The logged steps' total, in whole minutes (at least 1); null without a log. */
  minutes: number | null;
  /** Steps logged of the recipe's cook steps; null without a log. */
  steps: { done: number; total: number } | null;
}

export const NO_STEPS: StepSeed = Object.freeze({ minutes: null, steps: null });

/** From a finished session's guide: the logged cook steps' total time, and how many of all its cook steps. */
export function stepSeedOf(guide: CookGuide | null | undefined): StepSeed {
  const log = guideStepLog(guide);
  if (!guide || log.length === 0) return NO_STEPS;
  const seconds = log.reduce((s, e) => s + Math.max(0, (Date.parse(e.doneAt) - Date.parse(e.startedAt)) / 1000), 0);
  const total = guide.steps.filter((s) => s.phase === "cook").length;
  return { minutes: Math.max(1, Math.round(seconds / 60)), steps: total > 0 ? { done: Math.min(log.length, total), total } : null };
}

/** Where the session leaves its step seed for the dish page: this tab only (sessionStorage). */
export function stepSeedKey(dishId: string): string {
  return `cookpool.share.steps.${dishId}`;
}

/** A stored seed, as read back; NO_STEPS for anything else. */
export function parseStepSeed(raw: string | null | undefined): StepSeed {
  if (!raw) return NO_STEPS;
  try {
    const v = JSON.parse(raw) as Partial<StepSeed>;
    const minutes = typeof v.minutes === "number" && v.minutes > 0 ? Math.round(v.minutes) : null;
    const s = v.steps;
    const steps = s && typeof s.done === "number" && typeof s.total === "number" && s.total > 0 ? { done: s.done, total: s.total } : null;
    return { minutes, steps };
  } catch {
    return NO_STEPS;
  }
}

// ── The composer ──────────────────────────────────────────────────

export const SHARE_TITLE = "Share this cook?";
export const NEVER_SHOWN = "Never shown: prices, balances, your groups, who owes whom.";
export const PHOTO_SOON = "Photos coming soon";
export const PICK_HANDLE_TO_SHARE = "Pick a handle to share";
export const CAPTION_PLACEHOLDER = "How did it go?";
export { POST_CAPTION_MAX };

/** The line above the title: where the dish stands ("✓ Cooked · just you", "✓ Split with Flat 4B"). */
export function shareTopLine(dish: Pick<KitchenDish, "orgId">, groupName: string | null): string {
  if (!dish.orgId) return "✓ Cooked · just you";
  return `✓ Split with ${groupName ?? "your group"}`;
}

/** What the composer previews (the server computes the real values from the dish and its step log). */
export interface SharePreview {
  /** The main line at the size cooked ("450 g"), else null. */
  main: { qtyMilli: number; unit: string } | null;
  portionsHalf: number;
  ate: number;
  steps: StepSeed;
  /** The dish named a recipe. */
  hasRecipe: boolean;
  /** It is one of your recipes (else a copy, or Cookpool's). */
  ownRecipe: boolean;
}

export function previewOf(
  dish: Pick<KitchenDish, "orgId" | "shares" | "portionsHalf" | "recipeId">,
  extra: { main: { qtyMilli: number; unit: string } | null; ownRecipe: boolean; steps: StepSeed },
): SharePreview {
  return {
    main: extra.main,
    portionsHalf: dish.portionsHalf,
    // How many ate is the dish's servings (CM-8), as the server counts it.
    ate: servingsOf(dish.portionsHalf),
    steps: extra.steps,
    hasRecipe: !!dish.recipeId,
    ownRecipe: extra.ownRecipe,
  };
}

/** The line under the dish's name: "Your recipe · cooked at 450 g", "From a recipe", or the portions. */
export function composerRecipeLine(p: SharePreview): string {
  const parts: string[] = [];
  if (p.hasRecipe) parts.push(p.ownRecipe ? "Your recipe" : "From a recipe");
  if (p.main) parts.push(`cooked at ${amountText(p.main.qtyMilli, p.main.unit)}`);
  else parts.push(`${halvesText(p.portionsHalf)} ${p.portionsHalf <= 2 ? "portion" : "portions"}`);
  return parts.join(" · ");
}

export interface ShowRow {
  id: keyof PostShow;
  label: string;
  /** The value it shows, as the app knows it; null when only the server can tell (a step log it has). */
  value: string | null;
  /** The server has nothing to show for it (no step log, as far as the app knows): it can still be turned on. */
  unknown: boolean;
}

/** WHAT IT SHOWS, in the canvas's order: Size, Time, How many ate, Steps done. */
export function showRows(p: SharePreview): ShowRow[] {
  const size = p.main ? amountText(p.main.qtyMilli, p.main.unit) : `${halvesText(p.portionsHalf)} ${p.portionsHalf <= 2 ? "portion" : "portions"}`;
  const time = p.steps.minutes !== null ? minutesText(p.steps.minutes) : null;
  const steps = p.steps.steps ? `${p.steps.steps.done} of ${p.steps.steps.total}` : null;
  return [
    { id: "size", label: "Size", value: size, unknown: false },
    { id: "time", label: "Time", value: time, unknown: time === null },
    { id: "ate", label: "How many ate", value: String(p.ate), unknown: false },
    { id: "steps", label: "Steps done", value: steps, unknown: steps === null },
  ];
}

export interface ShareDraft {
  caption: string;
  show: PostShow;
  audience: PostAudience;
}

/**
 * The composer as it opens: no caption; size and how many ate on, time on
 * when there's a time to show, steps off (the canvas); Followers — or Just
 * me without a profile.
 */
export function shareDefaults(p: SharePreview, hasProfile: boolean): ShareDraft {
  return {
    caption: "",
    show: { size: true, time: p.steps.minutes !== null, ate: true, steps: false },
    audience: hasProfile ? DEFAULT_POST_AUDIENCE : "me",
  };
}

export interface AudienceOption {
  id: PostAudience;
  label: string;
  sub: string;
}

/**
 * WHO SEES IT: Followers ("12 people"), Public ("anyone"), Just me ("your
 * profile"). A private profile's Public reads "Followers only — your profile
 * is private" (the server keeps it to followers). Without a profile only Just
 * me, and `needsHandle`.
 */
export function audienceOptions(profile: Pick<MyProfile, "privacy"> | null, followers: number | null): { options: AudienceOption[]; needsHandle: boolean } {
  const me: AudienceOption = { id: "me", label: "Just me", sub: "your profile" };
  if (!profile) return { options: [me], needsHandle: true };
  const people = followers === null ? "your followers" : followers === 1 ? "1 person" : `${followers} people`;
  return {
    options: [
      { id: "followers", label: "Followers", sub: people },
      { id: "public", label: "Public", sub: profile.privacy === "private" ? "Followers only — your profile is private" : "anyone" },
      me,
    ],
    needsHandle: false,
  };
}

/** What Post sends: the dish, the caption trimmed (none when empty), the audience, and only the `show` flags. */
export function createPostRequest(dishId: string, draft: ShareDraft): CreatePostRequest {
  const caption = draft.caption.trim().slice(0, POST_CAPTION_MAX);
  const show = Object.fromEntries(POST_SHOW_KEYS.map((k) => [k, draft.show[k] === true])) as unknown as PostShow;
  const out: CreatePostRequest = { dishId, audience: draft.audience, show };
  if (caption) out.caption = caption;
  return out;
}

/** The main button: "Post", or "Save to profile" for Just me. */
export function postButtonLabel(audience: PostAudience): string {
  return audience === "me" ? "Save to profile" : "Post";
}

/** Post's toast: who sees it now. */
export function postedToast(audience: PostAudience, followers: number | null, privateProfile: boolean): { title: string; description: string } {
  if (audience === "me") return { title: "On your profile", description: "Only you see it" };
  const yours = followers === null ? "your followers see it" : followers === 1 ? "your 1 follower sees it" : `your ${followers} followers see it`;
  if (audience === "public" && !privateProfile) return { title: "Posted", description: "Anyone can see it" };
  return { title: "Posted", description: yours };
}

export const NOT_NOW_TOAST = { title: "Not shared", description: "You can share it later from the dish" } as const;

/** A refused post: open the post that's there already, or say why. */
export function postRefusal(error: { reason?: string | undefined; message: string; details?: Record<string, unknown> | undefined }): { kind: "open"; postId: string } | { kind: "say"; text: string } {
  if (error.reason === "already_posted" && typeof error.details?.postId === "string") return { kind: "open", postId: error.details.postId };
  if (error.reason === "not_postable") return { kind: "say", text: "It was canceled: there's nothing to post" };
  if (error.reason === "no_profile") return { kind: "say", text: "Pick a handle to share beyond Just me" };
  return { kind: "say", text: error.message };
}

// ── Which dishes you've shared ────────────────────────────────────

/**
 * Where the browser remembers the post each dish became (the dish read
 * doesn't say): the dish page's Share reads "See your post" for one of them.
 * A convenience only — the server's `already_posted` is the rule.
 */
export const SHARED_POSTS_KEY = "cookpool.community.sharedPosts";
const SHARED_MAX = 100;

export function parseSharedPosts(raw: string | null | undefined): Record<string, string> {
  if (!raw) return {};
  try {
    const v = JSON.parse(raw) as unknown;
    if (typeof v !== "object" || v === null || Array.isArray(v)) return {};
    return Object.fromEntries(Object.entries(v).filter((e): e is [string, string] => typeof e[1] === "string"));
  } catch {
    return {};
  }
}

/** The map with this dish's post (or without it, for null), the newest kept. */
export function withSharedPost(map: Record<string, string>, dishId: string, postId: string | null): Record<string, string> {
  const rest = Object.entries(map).filter(([d]) => d !== dishId);
  const next = postId ? [...rest, [dishId, postId] as [string, string]] : rest;
  return Object.fromEntries(next.slice(-SHARED_MAX));
}
