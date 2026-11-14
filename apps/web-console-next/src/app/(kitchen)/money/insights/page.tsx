"use client";

import SplitecoInsights from "@saas/spliteco-web/src/app/insights/page";
import { SplitecoScreen } from "@/components/kitchen/spliteco-host-ui";

/** Spliteco's /insights, inside Cookpool's Money (money-inside MN-8). */
export default function MoneyInsightsPage() {
  return (
    <SplitecoScreen path="/money/insights">
      <SplitecoInsights />
    </SplitecoScreen>
  );
}
