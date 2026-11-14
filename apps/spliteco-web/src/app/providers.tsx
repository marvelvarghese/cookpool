"use client";

import * as React from "react";
import { SessionProvider } from "../lib/session";
import { MeProvider } from "../lib/me";
import { SplitecoUiProvider } from "@saas/spliteco-ui/theme";
import { DEEP_OCEAN } from "../lib/ui-theme";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <MeProvider>
        {/* The shared money screens (packages/spliteco-ui) in Deep ocean. */}
        <SplitecoUiProvider theme={DEEP_OCEAN}>
          {/* useSearchParams (the pages' ?id=) needs a boundary on static pages. */}
          <React.Suspense fallback={null}>{children}</React.Suspense>
        </SplitecoUiProvider>
      </MeProvider>
    </SessionProvider>
  );
}
