/**
 * Toasts never cover the main button (Cookpool SM-15, the phone audit's
 * item 14). A toast sits at the bottom of the screen — on a phone, above the
 * tab bar — and the screens hold their one main button there too ("Use
 * some", "Log 1 glass", Finalize, "Cook & post"). Anything fixed or sticky at
 * the bottom says so with `data-toast-above`; while a toast is open, the
 * viewport is lifted past whatever it would land on.
 *
 * Dependency-free, so the rule is unit-testable; `ToastProvider` measures.
 */

/** The marker a fixed or sticky bottom bar carries. */
export const TOAST_ABOVE_ATTR = "data-toast-above";

/** Space between a toast and what it clears. */
export const TOAST_GAP = 8;

export interface ToastLiftInput {
  /** `window.innerHeight`. */
  viewportHeight: number;
  /** The viewport's own `bottom`, in px, as its CSS places it. */
  baseBottom: number;
  /** The viewport's padding: the toast's lower edge is this far above its `bottom`. */
  padding: number;
  /** How tall the toasts are, together. */
  toastHeight: number;
  /** The marked bars on screen, as `getBoundingClientRect()` gives them. */
  obstacles: readonly { top: number; bottom: number }[];
  gap?: number;
}

/**
 * The viewport's `bottom` that keeps the toasts clear of every marked bar
 * they would otherwise land on, or null when the CSS place is clear. A bar
 * further up the page (a button in the flow, above where the toast shows) is
 * left alone: the toast does not jump over it.
 */
export function toastLift(input: ToastLiftInput): number | null {
  const gap = input.gap ?? TOAST_GAP;
  const vh = input.viewportHeight;
  const height = Math.max(0, input.toastHeight);
  // The toast's lower edge, in px from the top of the screen.
  let edge = vh - input.baseBottom - input.padding;
  let lifted = false;
  const bars = input.obstacles
    .filter((r) => r.bottom > r.top && r.top < vh && r.bottom > 0)
    .slice()
    .sort((a, b) => b.bottom - a.bottom);
  // Lowest first; each lift can land the toast on the next bar up.
  for (let moved = true; moved; ) {
    moved = false;
    for (const r of bars) {
      const covers = r.top < edge && r.bottom > edge - height;
      if (covers && r.top - gap < edge) {
        edge = r.top - gap;
        lifted = true;
        moved = true;
      }
    }
  }
  return lifted ? Math.round(vh - edge - input.padding) : null;
}
