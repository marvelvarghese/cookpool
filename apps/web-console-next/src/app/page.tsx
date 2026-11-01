"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { readStoredToken } from "@/lib/session";
import { HOME_PATH } from "@/lib/safe-next";

/**
 * App entry. The console opens as Cookpool (CP-5): a signed-in person lands on
 * Home, anyone else on /login. The admin console stays at /orgs and /account.
 * localStorage is client-only, so this resolves on the client and replaces
 * history (no extra entry).
 */
export default function HomePage() {
  const router = useRouter();
  React.useEffect(() => {
    router.replace(readStoredToken() ? HOME_PATH : "/login");
  }, [router]);

  return (
    <div className="grid min-h-screen place-items-center text-sm text-muted-foreground">
      Loading…
    </div>
  );
}
