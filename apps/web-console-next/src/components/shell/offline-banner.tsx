"use client";

import * as React from "react";
import { WifiOff } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/components/ui/toast";
import { OFFLINE_WRITE_TEXT, bannerText, connection, type ConnectionState } from "@/lib/connection";

const ONLINE: ConnectionState = { browserOffline: false, unreachable: false, cachedAt: null };

/** While offline, try the network again this often (and when the browser or the app comes back). */
const RETRY_MS = 30_000;

/**
 * No signal (Cookpool PW-4, the canvas's `AppOffline`): a thin banner across
 * the top while the app is offline — "Offline · showing what you saw last",
 * with when the data on screen is from when the service worker answered
 * from its cache. It goes when a request succeeds again, and the screen
 * reads everything again.
 *
 * It also says, once, that a write was held back: "You're offline · nothing
 * was logged" (the shared toast, one line, no Undo).
 *
 * In the root layout, so every page has it; outside the kitchen it reads the
 * same.
 */
export function OfflineBanner() {
  const state = React.useSyncExternalStore(connection.subscribe, connection.get, () => ONLINE);
  const offline = state.browserOffline || state.unreachable;
  const qc = useQueryClient();
  const { toast } = useToast();

  React.useEffect(() => connection.onHeldBack(() => void toast({ kind: "warning", title: OFFLINE_WRITE_TEXT, duration: 4000 })), [toast]);

  // Back online: the screen reads everything again.
  const was = React.useRef(offline);
  React.useEffect(() => {
    if (was.current && !offline) void qc.invalidateQueries();
    was.current = offline;
  }, [offline, qc]);

  // Offline: try again when the browser says it is back, when the app is,
  // and every half minute while it is on screen.
  React.useEffect(() => {
    if (!offline) return;
    const retry = () => {
      if (document.visibilityState === "visible") void qc.invalidateQueries({ refetchType: "active" });
    };
    const timer = window.setInterval(retry, RETRY_MS);
    window.addEventListener("online", retry);
    document.addEventListener("visibilitychange", retry);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("online", retry);
      document.removeEventListener("visibilitychange", retry);
    };
  }, [offline, qc]);

  if (!offline) return null;
  return (
    <div
      role="status"
      className="sticky top-0 z-[60] flex min-h-9 items-center justify-center gap-2 bg-[#3F4842] px-4 pb-1.5 pt-[calc(env(safe-area-inset-top)+0.375rem)] text-center text-[13px] font-bold leading-tight text-white"
    >
      <WifiOff aria-hidden className="h-4 w-4 shrink-0" strokeWidth={2.2} />
      <span>{bannerText(state, new Date())}</span>
    </div>
  );
}
