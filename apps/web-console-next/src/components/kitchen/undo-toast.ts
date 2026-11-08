"use client";

import * as React from "react";
import { useToast } from "@/components/ui/toast";
import { isOffline, refuseIfOffline } from "@/lib/connection";
import { REFUSAL_MS, UNDO_MS, undoneToast, type UndoOffer, type UndoToast } from "./undo";

/** The toast an offer opened: change its words, or turn it into the write's refusal. */
export interface UndoToastHandle {
  /** New words for the same toast (the server's, once it answers); its Undo stays. */
  update: (text: { title?: string; description?: string | undefined }) => void;
  /** The write was refused: the toast says why, and offers no Undo. */
  refuse: (toast: UndoToast) => void;
  /** Close it (a write that came to nothing). */
  close: () => void;
}

/** A write held back offline (PW-4) offers nothing: its handle does nothing. */
const HELD_BACK: UndoToastHandle = Object.freeze({ update: () => undefined, refuse: () => undefined, close: () => undefined });

let openOffers = 0;

/**
 * How many Undo toasts are on screen (Cookpool PW-4): "New version · Reload"
 * waits for them, since reloading would take their Undo away.
 */
export function undoOffersOpen(): number {
  return openOffers;
}

/**
 * The one Undo toast (CP-23): every money and stock action — an expense, a
 * payment, an undone entry, a use, waste, an added item, cooking, a claim,
 * the cook's shares, a correction — offers it the same way. `offer({ title,
 * description, undo })` shows the action's toast with Undo for ten seconds;
 * pressing it runs `undo` (the reversal or undo API for exactly that write)
 * once, and its answer is the next toast. What each one undoes is the
 * caller's.
 *
 * Since SM-5 the toast shows when the write is made, not when the server
 * answers: the returned handle gives it the server's words afterwards, or
 * turns it into the refusal. With `restore`, Undo puts the screen back at
 * once and "Undone" shows at once, then takes `undo`'s answer.
 */
export function useUndoToast() {
  const { toast, update, dismiss } = useToast();
  return React.useCallback(
    (offer: UndoOffer): UndoToastHandle => {
      // Offline, the write was held back (beginWrite, the API client): no Undo.
      if (isOffline()) return HELD_BACK;
      let pressed = false;
      let closed = false;
      // Counted while it can still be pressed.
      let counted = true;
      openOffers += 1;
      const uncount = () => {
        if (!counted) return;
        counted = false;
        openOffers -= 1;
      };
      const timer = setTimeout(uncount, UNDO_MS + 500);
      const answer = (shown: number | null) =>
        offer.undo().then(
          (result) => {
            const t = undoneToast(result);
            if (shown === null) toast(t);
            else update(shown, { ...t, duration: result.ok ? 4_000 : REFUSAL_MS });
          },
          (error: unknown) => {
            const t = { kind: "error" as const, title: "Couldn't undo it", description: error instanceof Error ? error.message : undefined };
            if (shown === null) toast(t);
            else update(shown, { ...t, duration: REFUSAL_MS });
          },
        );
      const extra = offer.extra;
      const id = toast({
        kind: "success",
        title: offer.title,
        description: offer.description,
        duration: UNDO_MS,
        secondary: extra
          ? {
              label: extra.label,
              onClick: () => {
                if (pressed || closed) return;
                closed = true;
                clearTimeout(timer);
                uncount();
                extra.onClick();
              },
            }
          : undefined,
        action: {
          label: "Undo",
          onClick: () => {
            if (pressed || closed) return;
            // Undoing is a write too: offline it is held back, and nothing changes.
            if (refuseIfOffline()) return;
            pressed = true;
            clearTimeout(timer);
            uncount();
            if (offer.restore) {
              offer.restore();
              void answer(toast({ kind: "success", title: "Undone", duration: 4_500 }));
            } else {
              void answer(null);
            }
          },
        },
      });
      return {
        update: (text) => {
          if (closed || pressed) return;
          update(id, text);
        },
        refuse: (t) => {
          if (closed) return;
          closed = true;
          clearTimeout(timer);
          uncount();
          update(id, { ...t, action: undefined, secondary: undefined, duration: REFUSAL_MS });
        },
        close: () => {
          closed = true;
          clearTimeout(timer);
          uncount();
          dismiss(id);
        },
      };
    },
    [toast, update, dismiss],
  );
}
