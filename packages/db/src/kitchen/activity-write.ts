// One Activity row (Cookpool CM-3, migration 440_kitchen_posts), as a
// statement another write puts in its OWN batch: a follow, a request, an
// accepted request (CM-2's writes), a Yum, a comment, a post that cooked
// someone's recipe, a copy of someone's public recipe. The row lands with the
// event or not at all.
//
// The statement itself refuses what the design forbids, so no caller has to:
// nothing for oneself, nothing across a block either way. A caller adds its
// own `guard` — the event actually happened in this batch (the follow row
// is the one just written, the Yum is new) — with placeholders numbered from
// $9 on and their values in `guardParams`.
//
// Kept apart from posts.ts and community.ts, which both use it.

import type { SqlStatement } from "../d1/executor.js";

export type KitchenActivityKind =
  | "followed"
  | "follow_request"
  | "follow_accepted"
  | "yum"
  | "comment"
  | "cooked_yours"
  | "saved_yours";

export interface KitchenActivityWrite {
  /** A fresh UUID (act_ in the API). */
  id: string;
  /** Whom it happened to. */
  userId: string;
  kind: KitchenActivityKind;
  /** Who did it. */
  actorId: string;
  postId?: string | null;
  commentId?: string | null;
  recipeId?: string | null;
  now: Date;
}

/** The INSERT for `a`: written only when recipient and actor differ, with no block between them, and `guard` holds. */
export function activityStatement(a: KitchenActivityWrite, guard?: string, guardParams: readonly unknown[] = []): SqlStatement {
  return {
    text: `INSERT INTO kitchen_activity (id, user_id, kind, actor_id, post_id, comment_id, recipe_id, created_at)
           SELECT $1, $2, $3, $4, $5, $6, $7, $8
           WHERE $2 <> $4
             AND NOT EXISTS (SELECT 1 FROM kitchen_blocks kb
                             WHERE (kb.blocker_id = $2 AND kb.blocked_id = $4) OR (kb.blocker_id = $4 AND kb.blocked_id = $2))
             ${guard ? `AND (${guard})` : ""}
           RETURNING id`,
    params: [a.id, a.userId, a.kind, a.actorId, a.postId ?? null, a.commentId ?? null, a.recipeId ?? null, a.now, ...guardParams],
  };
}
