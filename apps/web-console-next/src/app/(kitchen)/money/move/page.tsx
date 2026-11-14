"use client";

import SplitecoMove from "@saas/spliteco-web/src/app/move/page";
import { SplitecoScreen } from "@/components/kitchen/spliteco-host-ui";

/** Spliteco's /move, inside Cookpool's Money (money-inside MN-8). */
export default function MoneyMovePage() {
  return (
    <SplitecoScreen path="/money/move">
      <SplitecoMove />
    </SplitecoScreen>
  );
}
