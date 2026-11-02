"use client";

import * as React from "react";
import { KITCHEN_THEME_CLASSES } from "./theme";

/**
 * Put Cookpool's palette and font on <body> while the calling tree is
 * mounted, so Radix portals (dialogs, sheets, toasts) render in the same
 * theme as the page. The kitchen layout and the sign-in pages (SI-5) use it;
 * the admin console never does.
 */
export function useKitchenBodyTheme(): void {
  React.useEffect(() => {
    const body = document.body;
    body.classList.add(...KITCHEN_THEME_CLASSES);
    return () => body.classList.remove(...KITCHEN_THEME_CLASSES);
  }, []);
}
