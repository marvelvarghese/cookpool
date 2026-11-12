"use client";

import { BackButton } from "@/components/kitchen/back-ui";
import { NOTIFY_TITLE } from "@/lib/push";
import { NotificationsScreen } from "@/components/kitchen/notify-ui";

/**
 * You → Notifications (cookpool-app PW-6, design §4, the `AppNotify`
 * artboard): "Someone set my portion", "A dish to claim", "Someone paid me"
 * and "To-dos on the app icon", each off until turned on. Turning one of the
 * first three on asks the phone for permission and subscribes this device;
 * an iPhone in the browser is told to add Cookpool to its Home Screen first.
 * A static page like the others (SM-2); its back control is the shared one (PW-3), whose parent is You.
 */
export default function NotificationsPage() {
  return (
    <div className="flex w-full max-w-xl flex-col gap-[18px]">
      <header className="flex items-center gap-1">
        <BackButton />
        <h1 className="text-[26px] font-medium tracking-[-0.02em]">{NOTIFY_TITLE}</h1>
      </header>
      <NotificationsScreen />
    </div>
  );
}
