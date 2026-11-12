/**
 * A group's tile colour (cookpool-revamp RV-19, the RvGroups board): every
 * group gets one of six tints, picked from its id, so it is the same on every
 * screen and every device. Each is a light tint with dark words in light mode
 * and a deep tint with light words in dark (the `cp-*` tokens, globals.css).
 * Dependency-free, so it is unit-testable; `GroupAvatar` (kit.tsx) draws it.
 */

/** The six tints, by name: the accent's green, money back's blue, use-soon's amber, then purple, teal and slate. */
export const GROUP_TINTS = ["green", "blue", "amber", "purple", "teal", "slate"] as const;
export type GroupTint = (typeof GROUP_TINTS)[number];

/** A group's tint, from its id (or, where a screen has no id, its name). */
export function groupTint(seed: string): GroupTint {
  let h = 0;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return GROUP_TINTS[h % GROUP_TINTS.length]!;
}
