"use client";

import { newFrame } from "@/lib/features";
import { YouSettings } from "@/components/kitchen/you-settings-ui";
import { YouHome } from "@/components/kitchen/you-home-ui";

/**
 * You. The address picks its page when it renders (cookpool-recipes RC-2):
 * in the new frame the `RvYou` board (cookpool-revamp RV-6: your avatar,
 * name and @handle, short grouped lists of rows, and Sign out), everywhere
 * but prod; in prod today's You (SI-6: your name, how you sign in,
 * notifications, install and sign out).
 */
export default function YouPage() {
  return newFrame() ? <YouHome /> : <YouSettings />;
}
