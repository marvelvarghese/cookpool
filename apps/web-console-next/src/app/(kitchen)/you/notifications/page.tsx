"use client";

import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { NOTIFY_TITLE } from "@/lib/push";
import { NotificationsScreen } from "@/components/kitchen/notify-ui";

/**
 * You → Notifications (cookpool-app PW-6, design §4, the `AppNotify`
 * artboard): "Someone set my portion", "A dish to claim", "Someone paid me"
 * and "To-dos on the app icon", each off until turned on. Turning one of the
 * first three on asks the phone for permission and subscribes this device;
 * an iPhone in the browser is told to add Cookpool to its Home Screen first.
 * A static page like the others (SM-2); its back control goes to You.
 */
export default function NotificationsPage() {
  return (
    <div className="flex w-full max-w-xl flex-col gap-[18px]">
      <header className="flex items-center gap-2">
        <Link
          href="/you"
          aria-label="Back to You"
          className="-ml-2.5 grid h-11 w-11 shrink-0 place-items-center rounded-xl text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ChevronLeft className="h-[22px] w-[22px]" strokeWidth={2} aria-hidden />
        </Link>
        <h1 className="text-[26px] font-extrabold tracking-[-0.02em]">{NOTIFY_TITLE}</h1>
      </header>
      <NotificationsScreen />
    </div>
  );
}
