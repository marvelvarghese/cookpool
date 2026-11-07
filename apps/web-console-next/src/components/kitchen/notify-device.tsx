"use client";

import * as React from "react";
import { useSession } from "@/lib/session";
import { isOffline } from "@/lib/connection";
import { badgeAction, notifyDevice } from "@/lib/push";
import {
  BADGE_CHANGE,
  applyBadge,
  badgeOn,
  badgeSupported,
  currentSubscription,
  notificationPermission,
  readNotifyEnv,
  subscriptionBody,
} from "@/lib/push-device";
import { MESSAGE } from "@/service-worker/protocol.mjs";
import { SERVICE_WORKER } from "@/service-worker/switch.mjs";
import { useInbox } from "./inbox-data";
import { homeTodoCount } from "./inbox";

/** This build registers the worker that shows notifications: a production build with the kill switch on (PW-4). */
export const WORKER_ON = process.env.NODE_ENV === "production" && SERVICE_WORKER === "on";

/**
 * Notifications on this device, for every signed-in kitchen page
 * (cookpool-app PW-6), mounted by the kitchen layout:
 *
 * - THE ICON BADGE: with "To-dos on the app icon" on and a browser that can
 *   badge, the icon shows Home's to-do count whenever the inbox loads (the
 *   same read as Home's, so an optimistic write moves it too), and nothing at
 *   zero. Off clears it.
 * - THIS DEVICE'S SUBSCRIPTION reaches the server again on every launch, and
 *   when the service worker says the push service renewed it — the worker
 *   holds no token, so the page posts it (upserted by endpoint, so a repeat
 *   changes nothing).
 */
export function AppNotify() {
  useAppBadge();
  usePushResync();
  return null;
}

/** The badge switch, as this device remembers it (false until mounted). */
export function useBadgeSwitch(): boolean {
  const [on, setOn] = React.useState(false);
  React.useEffect(() => {
    const read = () => setOn(badgeOn());
    read();
    window.addEventListener(BADGE_CHANGE, read);
    window.addEventListener("storage", read);
    return () => {
      window.removeEventListener(BADGE_CHANGE, read);
      window.removeEventListener("storage", read);
    };
  }, []);
  return on;
}

function useAppBadge(): void {
  const on = useBadgeSwitch();
  const [supported, setSupported] = React.useState(false);
  React.useEffect(() => setSupported(badgeSupported()), []);
  // Read only while the badge needs it; Home reads the same key anyway.
  const inbox = useInbox({ enabled: on && supported });
  const count = inbox.data ? homeTodoCount(inbox.data) : null;
  React.useEffect(() => {
    applyBadge(badgeAction({ on, supported, count }));
  }, [on, supported, count]);
}

/** Once per page load (a launch, or a full reload): the pages navigate between themselves without one. */
let repostedThisLoad = false;

function usePushResync(): void {
  const { client, token } = useSession();
  React.useEffect(() => {
    if (!token || notifyDevice(readNotifyEnv(WORKER_ON)) !== "push") return;
    const repost = async () => {
      if (isOffline() || notificationPermission() !== "granted") return;
      const sub = await currentSubscription();
      if (!sub) return;
      try {
        await client.notifications.subscribePush(subscriptionBody(sub));
      } catch {
        /* the next launch tries again */
      }
    };
    if (!repostedThisLoad) {
      repostedThisLoad = true;
      void repost();
    }
    const onMessage = (event: MessageEvent) => {
      if ((event.data as { type?: unknown } | null)?.type === MESSAGE.pushRenewed) void repost();
    };
    const sw = navigator.serviceWorker;
    sw.addEventListener("message", onMessage);
    return () => sw.removeEventListener("message", onMessage);
  }, [client, token]);
}
