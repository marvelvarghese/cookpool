"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { frameRedirect, newFrame } from "@/lib/features";

/**
 * A page that exists only in the new frame (cookpool-recipes RC-2, design
 * §1.1): in today's frame (prod) it sends the visitor where `frameRedirect`
 * says — Money to Home, settings to You — replacing itself, so Back does not
 * bring them to it again. True while the page may show.
 */
export function useNewFrameOnly(page: string): boolean {
  const router = useRouter();
  const on = newFrame();
  const to = frameRedirect(page, on);
  React.useEffect(() => {
    if (to) router.replace(to);
  }, [router, to]);
  return to === null;
}
