// Cooked, then split later (Cookpool, epic cookpool-community: CM-8, design
// §2a).
//
// Cooking ends at Cooked! with the dish saved as the cook's own: no group
// (`orgId: null`, the "just me" dish), its ingredients taken from any pantry
// the cook may use and every group item charged to the cook as a `use`, as
// always. Posting it to Community (POST /v1/kitchen/me/posts) and splitting
// it with a group are separate actions, in any order or never.
//
// Splitting attaches the dish to ONE group the cook cooks in and puts it
// exactly where a dish cooked straight into that group is: open for claims
// (or, `splitMode: "assign"`, a draft for the cook's shares), then Who ate
// and finalize post the one `dish` transaction as they always have. The
// dish's money is what it was at cook time; nothing moves until finalize.
//
// Routes (kitchen-worker, behind api-edge's kitchen facade; all signed in):
//   POST /v1/kitchen/me/dishes/{dsh}/split                    { orgId, splitMode? } → { dish }
//   POST /v1/kitchen/me/dishes/{dsh}/split-reminder/dismiss   → { dishId, dismissed: true, dismissedAt }
//   POST /v1/kitchen/me/dishes/{dsh}/split-reminder/restore   → { dishId, dismissed: false, dismissedAt: null } (Undo)
//   GET  /v1/kitchen/me/inbox                                 gains `splitReminders`
//
// Split refusals (pinned codes, `details.reason`):
//   404 `not_found`        not the caller's dish (opaque), a group they aren't in, or one
//                          where their role may not cook (a viewer), as every kitchen denial
//   409 `conflict`         `already_split` — it has a group already (`details.orgId`);
//                          `dish_not_open` — canceled (`details.state`); `stale` — it kept changing
//   422 `validation_failed` `currency_mismatch` — the group counts in another currency
//
// This module is re-exported from `kitchen.ts`, so `@saas/contracts/kitchen`
// carries it.

import type { DishResponse, DishSplitMode } from "./kitchen.js";

// ── Splitting later ─────────────────────────────────────────

export interface SplitDishRequest {
  /** `org_…`: a group the caller cooks in. */
  orgId: string;
  /** Default `claims`: open for Who ate, as a dish cooked into the group is. `assign`: a draft for the cook's shares. */
  splitMode?: DishSplitMode;
}

export type SplitDishResponse = DishResponse;

/** The audit event a split writes, in the group it is split with. */
export const KITCHEN_DISH_SPLIT_EVENT = "kitchen.dish.split";

export const KITCHEN_SPLIT_ERROR_REASONS = {
  /** 409 `conflict`: the dish has a group already — cooked into it, or split before (`details.orgId`). */
  ALREADY_SPLIT: "already_split",
} as const;
export type KitchenSplitErrorReason = (typeof KITCHEN_SPLIT_ERROR_REASONS)[keyof typeof KITCHEN_SPLIT_ERROR_REASONS];

// ── Home's split reminder ───────────────────────────────────

/** A dish reminds for this many days after it was cooked. */
export const SPLIT_REMINDER_DAYS = 7;
/** Portions × 2 from which a dish of only the cook's own things is worth splitting: two servings. */
export const SPLIT_REMINDER_MIN_PORTIONS_HALF = 4;
/** At most this many reminders, newest dish first. */
export const SPLIT_REMINDERS_MAX = 10;

/**
 * Why a group is suggested: `used_items` — the dish took most (by cost) from
 * its pantry; `recent` — the group the cook last cooked a dish for (else
 * their first group by name) when it took nothing from a group.
 */
export const SPLIT_SUGGEST_REASONS = ["used_items", "recent"] as const;
export type SplitSuggestReason = (typeof SPLIT_SUGGEST_REASONS)[number];

/**
 * One reminder to split a dish: the cook's own, unsplit and not canceled,
 * cooked in the last SPLIT_REMINDER_DAYS, that took something from a group
 * pantry or made at least two servings; until it is split or dismissed. Only
 * when there is a group to suggest (one the cook cooks in, in the dish's
 * currency).
 */
export interface SplitReminderInboxItem {
  kind: "split_reminder";
  dish: {
    /** `dsh_…` */
    id: string;
    name: string;
    portionsHalf: number;
    totalMinor: number;
    currency: string;
    cookedAt: string;
    /** draft, or finalized (a "just me" dish marked done, which posted nothing). */
    state: "draft" | "finalized";
    /** How many of its ingredients came from group pantries. */
    groupItems: number;
  };
  /** The group to offer first. */
  suggest: {
    /** `org_…` */
    orgId: string;
    groupName: string;
    groupSlug: string;
    why: SplitSuggestReason;
  };
}

export interface SplitReminderDismissResponse {
  /** `dsh_…` */
  dishId: string;
  dismissed: boolean;
  dismissedAt: string | null;
}
