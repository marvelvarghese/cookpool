"use client";

import SplitecoExpense from "@saas/spliteco-web/src/app/expense/page";
import { SplitecoScreen } from "@/components/kitchen/spliteco-host-ui";

/** Spliteco's /expense, inside Cookpool's Money (money-inside MN-8). */
export default function MoneyExpensePage() {
  return (
    <SplitecoScreen path="/money/expense">
      <SplitecoExpense />
    </SplitecoScreen>
  );
}
