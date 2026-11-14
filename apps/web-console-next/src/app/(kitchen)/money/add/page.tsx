"use client";

import SplitecoAdd from "@saas/spliteco-web/src/app/add/page";
import { SplitecoScreen } from "@/components/kitchen/spliteco-host-ui";

/** Spliteco's /add, inside Cookpool's Money (money-inside MN-8). */
export default function MoneyAddPage() {
  return (
    <SplitecoScreen path="/money/add">
      <SplitecoAdd />
    </SplitecoScreen>
  );
}
