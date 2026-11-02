"use client";

import * as React from "react";

/**
 * Whether the window is at least `px` wide, following resizes (CP-23): for
 * the few screens that render a different tree, not just a different layout,
 * from a breakpoint — the Groups page reads a group's activity and balances
 * beside the list only from 900px. False on the server and before mount.
 */
export function useMinWidth(px: number): boolean {
  const query = `(min-width: ${px}px)`;
  const subscribe = React.useCallback(
    (onChange: () => void) => {
      const mql = window.matchMedia(query);
      mql.addEventListener("change", onChange);
      return () => mql.removeEventListener("change", onChange);
    },
    [query],
  );
  return React.useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => false,
  );
}
