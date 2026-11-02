"use client";

import * as React from "react";
import { useToast } from "@/components/ui/toast";
import { UNDO_MS, undoneToast, type UndoOffer } from "./undo";

/**
 * The one Undo toast (CP-23): every money and stock action — an expense, a
 * payment, an undone entry, a use, waste, an added item, cooking, a claim,
 * the cook's shares, a correction — offers it the same way. `offer({ title,
 * description, undo })` shows the action's toast with Undo for ten seconds;
 * pressing it runs `undo` (the reversal or undo API for exactly that write)
 * once, and its answer is the next toast. What each one undoes is the
 * caller's.
 */
export function useUndoToast() {
  const { toast } = useToast();
  return React.useCallback(
    (offer: UndoOffer) => {
      let pressed = false;
      toast({
        kind: "success",
        title: offer.title,
        description: offer.description,
        duration: UNDO_MS,
        action: {
          label: "Undo",
          onClick: () => {
            if (pressed) return;
            pressed = true;
            void offer.undo().then(
              (result) => toast(undoneToast(result)),
              (error: unknown) =>
                toast({ kind: "error", title: "Couldn't undo it", description: error instanceof Error ? error.message : undefined }),
            );
          },
        },
      });
    },
    [toast],
  );
}
