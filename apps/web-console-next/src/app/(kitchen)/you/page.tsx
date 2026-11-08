"use client";

import { newFrame } from "@/lib/features";
import { YouSettings } from "@/components/kitchen/you-settings-ui";
import { YourPage } from "@/components/kitchen/profile-ui";

/**
 * You. The address picks its page when it renders (cookpool-recipes RC-2):
 * in the new frame your page (`YourPage`: your face, groups, cooks and Cooks
 * a week; the gear opens settings), everywhere but prod; in prod today's You
 * (SI-6: your name, how you sign in, notifications, install and sign out).
 */
export default function YouPage() {
  return newFrame() ? <YourPage /> : <YouSettings />;
}
