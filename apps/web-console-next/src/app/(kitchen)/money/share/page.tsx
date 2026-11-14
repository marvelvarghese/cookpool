"use client";

import SplitecoShare from "@saas/spliteco-web/src/app/share/page";
import { SplitecoScreen } from "@/components/kitchen/spliteco-host-ui";

/** Spliteco's /share, inside Cookpool's Money (money-inside MN-8). */
export default function MoneySharePage() {
  return (
    <SplitecoScreen path="/money/share">
      <SplitecoShare />
    </SplitecoScreen>
  );
}
