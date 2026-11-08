/**
 * Undo, the same everywhere (Cookpool CP-23). Money and stock actions confirm
 * by undo, not by a dialog (design §7): the action's toast offers Undo for
 * ten seconds, Undo calls the reversal or undo API for exactly what was just
 * written, and the answer is one more toast — "Undone" with what is back, or
 * why it could not be (a warning when it is already done another way, an
 * error otherwise). This is the pure half; `useUndoToast` (undo-toast.ts)
 * shows it. Dependency-free, so it is unit-testable.
 */

/** How long an Undo stays on screen. */
export const UNDO_MS = 10_000;

/** What an undo came to. */
export type UndoResult =
  | { ok: true; /** What is back: "“Milk” is reversed." */ description?: string }
  | { ok: false; kind?: "warning" | "error"; title: string; description?: string };

export interface UndoToast {
  kind: "success" | "warning" | "error";
  title: string;
  description?: string;
}

/** The toast an undo ends in: "Undone" with what is back, or the refusal (an error unless it says otherwise). */
export function undoneToast(result: UndoResult): UndoToast {
  if (result.ok) return result.description ? { kind: "success", title: "Undone", description: result.description } : { kind: "success", title: "Undone" };
  const out: UndoToast = { kind: result.kind ?? "error", title: result.title };
  if (result.description) out.description = result.description;
  return out;
}

/** An undo the server refused, in words: "Already undone" is a warning; anything unexpected is "Couldn't undo it". */
export function undoFailed(error: { reason?: string | undefined; message: string }): UndoResult {
  if (error.reason === "already_reversed") return { ok: false, kind: "warning", title: "Already undone" };
  return { ok: false, kind: "error", title: "Couldn't undo it", description: error.message };
}

/** The action's own toast: what was done, with Undo for UNDO_MS. */
export interface UndoOffer {
  title: string;
  description?: string | undefined;
  /** Reverse exactly what was written; resolves to what it came to. */
  undo: () => Promise<UndoResult>;
  /**
   * Put the screen back the moment Undo is pressed (Cookpool SM-5), before
   * `undo` answers: the "Undone" toast then shows at once too, and takes
   * `undo`'s answer when it comes — a refusal included, after `undo` has put
   * back what the server still has.
   */
  restore?: () => void;
  /**
   * A second button before Undo (cookpool-pantry PN-7: Bought again's
   * Change). It closes the toast; what it does is the caller's.
   */
  extra?: { label: string; onClick: () => void } | undefined;
}

/** How long a refusal stays on screen. */
export const REFUSAL_MS = 6_000;

/**
 * A write the server refused, as its toast says it (Cookpool SM-5): what did
 * not happen, and why in one line — the refusal messages each screen already
 * had. It replaces the write's own toast, which showed before the answer.
 */
export function refusedToast(title: string, reason: string | null | undefined): UndoToast {
  const out: UndoToast = { kind: "error", title };
  const why = reason?.trim();
  if (why) out.description = why;
  return out;
}
