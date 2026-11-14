"use client";

import "@/styles/spliteco-inside.css";
import * as React from "react";
import { SessionContext, type SessionValue } from "@saas/spliteco-web/src/lib/session";
import { MeProvider } from "@saas/spliteco-web/src/lib/me";
import { setPathMapper } from "@saas/spliteco-web/src/lib/paths";
import { useSession } from "@/lib/session";
import { useNewFrameOnly } from "./frame-ui";
import { splitecoToCookpool } from "./spliteco-paths";

// Every Spliteco link on these screens goes to Cookpool's address for it.
setPathMapper(splitecoToCookpool);

/**
 * One of Spliteco's own screens inside Cookpool's Money (money-inside MN-8):
 * the group, Add expense, an expense, Settle up, Scan and the rest, read and
 * written with Cookpool's signed-in client — no trip to the Spliteco app. The
 * screen draws in Spliteco's stylesheet, scoped under `.spx`
 * (styles/spliteco-inside.css), full width under Cookpool's navy tab bar; its
 * sheets open inside the same wrapper. New frame only, like Money.
 */
export function SplitecoScreen({ path, children }: { path: string; children: React.ReactNode }) {
  const shows = useNewFrameOnly(path);
  const { client } = useSession();
  const value = React.useMemo<SessionValue>(
    () => ({
      ready: true,
      // Cookpool's client carries its own token; Spliteco's screens only ask that one is there.
      token: "cookpool",
      client,
      signIn() {},
      async signOut() {},
    }),
    [client],
  );
  if (!shows) return null;
  return (
    <SessionContext.Provider value={value}>
      <MeProvider>
        <div className="spx" data-spliteco-portal="" style={{ margin: "0 -16px", minHeight: "100dvh", paddingBottom: 120 }}>
          {children}
        </div>
      </MeProvider>
    </SessionContext.Provider>
  );
}
