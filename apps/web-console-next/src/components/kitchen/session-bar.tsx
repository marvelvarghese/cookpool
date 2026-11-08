"use client";

import * as React from "react";
import { usePathname } from "next/navigation";
import { useCookSession } from "@/lib/cook-session-store";
import { useProfile } from "./data";
import { useMinWidth } from "./use-min-width";
import { SessionBarCard, useNow } from "./cook-session-ui";
import { opensKeyboard, sessionBarShows, sessionBarView } from "./cook-session";

/**
 * The cooking session's bar (cookpool-recipes RC-6, design §4.4): while a
 * session is open on this device and you are not on it, every tab shows a
 * dark bar — the pot, the dish's name, "Cooking · 12 min · 3 of 7 in" and
 * Resume — just above the tab bar on a phone (`placement` "phone", mounted by
 * the kitchen layout in the new frame), or in the sidebar's footer from 900px
 * ("sidebar", mounted by the sidebar). It stays off the session itself and
 * off the forms whose own main button sits there, and on a phone it hides
 * while a field has the keyboard up.
 */
export function SessionBar({ placement = "phone" }: { placement?: "phone" | "sidebar" }) {
  const profile = useProfile();
  const session = useCookSession(profile.data?.id ?? null);
  const pathname = usePathname();
  const now = useNow(30_000);
  const wide = useMinWidth(900);
  const typing = useKeyboardUp();
  if (!sessionBarShows(pathname, session)) return null;
  const view = sessionBarView(session, now);
  if (!view) return null;
  if (placement === "sidebar") return <SessionBarCard view={view} placement="sidebar" />;
  if (wide || typing) return null;
  return (
    <>
      <SessionBarCard view={view} placement="phone" />
      {/* Room at the end of the page, so the bar never covers its last row. */}
      <div aria-hidden className="h-[4.5rem] min-[900px]:hidden" />
    </>
  );
}

/** A field that brings up the keyboard has focus. */
function useKeyboardUp(): boolean {
  const [up, setUp] = React.useState(false);
  React.useEffect(() => {
    const check = () => setUp(opensKeyboard(document.activeElement as HTMLInputElement | null));
    // Focus moving between fields: the new one has focus once this turn ends.
    const later = () => window.setTimeout(check, 0);
    document.addEventListener("focusin", check);
    document.addEventListener("focusout", later);
    check();
    return () => {
      document.removeEventListener("focusin", check);
      document.removeEventListener("focusout", later);
    };
  }, []);
  return up;
}
