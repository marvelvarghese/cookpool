"use client";

import { newFrame } from "@/lib/features";
import { TodayPerson } from "@/components/kitchen/person-ui";
import { NewPerson } from "@/components/kitchen/profile-ui";

/**
 * A person (CP-9; SM-11). The address picks its page when it renders
 * (cookpool-recipes RC-2): the new frame's (`NewPerson`: their face, the
 * groups you share, what is between you with Settle up, their recent cooks
 * and the Why) everywhere but prod, today's in prod (`TodayPerson`).
 */
export default function PersonPage() {
  return newFrame() ? <NewPerson /> : <TodayPerson />;
}
