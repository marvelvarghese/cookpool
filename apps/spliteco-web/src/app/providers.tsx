"use client";

import * as React from "react";
import { SessionProvider } from "@/lib/session";
import { MeProvider } from "@/lib/me";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <MeProvider>
        {/* useSearchParams (the pages' ?id=) needs a boundary on static pages. */}
        <React.Suspense fallback={null}>{children}</React.Suspense>
      </MeProvider>
    </SessionProvider>
  );
}
