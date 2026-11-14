"use client";

import SplitecoScan from "@saas/spliteco-web/src/app/scan/page";
import { SplitecoScreen } from "@/components/kitchen/spliteco-host-ui";

/** Spliteco's /scan, inside Cookpool's Money (money-inside MN-8). */
export default function MoneyScanPage() {
  return (
    <SplitecoScreen path="/money/scan">
      <SplitecoScan />
    </SplitecoScreen>
  );
}
