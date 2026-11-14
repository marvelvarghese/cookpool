"use client";

import SplitecoFriend from "@saas/spliteco-web/src/app/friend/page";
import { SplitecoScreen } from "@/components/kitchen/spliteco-host-ui";

/** Spliteco's /friend, inside Cookpool's Money (money-inside MN-8). */
export default function MoneyFriendPage() {
  return (
    <SplitecoScreen path="/money/friend">
      <SplitecoFriend />
    </SplitecoScreen>
  );
}
