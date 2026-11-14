"use client";

import SplitecoGroup from "@saas/spliteco-web/src/app/group/page";
import { SplitecoScreen } from "@/components/kitchen/spliteco-host-ui";

/** Spliteco's /group, inside Cookpool's Money (money-inside MN-8). */
export default function MoneyGroupPage() {
  return (
    <SplitecoScreen path="/money/group">
      <SplitecoGroup />
    </SplitecoScreen>
  );
}
