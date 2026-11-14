"use client";

import SplitecoSettleUp from "@saas/spliteco-web/src/app/settle/page";
import { SplitecoScreen } from "@/components/kitchen/spliteco-host-ui";

/** Spliteco's /settle, inside Cookpool's Money (money-inside MN-8). */
export default function MoneySettleUpPage() {
  return (
    <SplitecoScreen path="/money/settle-up">
      <SplitecoSettleUp />
    </SplitecoScreen>
  );
}
