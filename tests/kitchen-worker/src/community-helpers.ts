// Shared set-up for the CM-2 suites (profiles, follows, blocks, search,
// suggestions, public recipes): the router over real SQLite with every
// migration applied (./harness.ts), and the people cookpool-community's design
// uses — Meera and Anu share Flat 4B, Kabir is in no group with anyone,
// Dev shares the Lunch club with Meera, and Sam is someone new.
//
// Every person's IDENTITY name and email are deliberately unlike their
// profile name ("Meera Identity", meera.secret@example.com vs "Meera K"), so a
// read that leaked either would show it.

import type { MyProfileResponse, RecipeResponse } from "@saas/contracts/kitchen";
import { createHarness, envelope, newGroup, type Envelope, type Group, type Harness } from "./harness.js";

export const NOW = new Date("2026-11-08T08:00:00.000Z");
export const DAY = 24 * 60 * 60 * 1000;

export const MEERA = "usr_meera";
export const KABIR = "usr_kabir";
export const ANU = "usr_anu";
export const DEV = "usr_dev";
export const SAM = "usr_sam";

export const IDENTITY: Record<string, { displayName: string; email: string }> = {
  [MEERA]: { displayName: "Meera Identity", email: "meera.secret@example.com" },
  [KABIR]: { displayName: "Kabir Identity", email: "kabir.secret@example.com" },
  [ANU]: { displayName: "Anu Identity", email: "anu.secret@example.com" },
  [DEV]: { displayName: "Dev Identity", email: "dev.secret@example.com" },
  [SAM]: { displayName: "Sam Identity", email: "sam.secret@example.com" },
};

export interface CommunityWorld {
  h: Harness;
  flat: Group;
  lunch: Group;
  /** Move the clock on by `ms` (a minute by default). */
  tick(ms?: number): void;
  now(): Date;
  call<T>(method: string, url: string, as: string | null, body?: unknown): Promise<{ status: number; body: Envelope<T> }>;
}

export function communityWorld(): CommunityWorld {
  let clock = NOW;
  const h = createHarness({ deps: { now: () => clock } });
  const flat = newGroup("Flat 4B");
  const lunch = newGroup("Lunch club");
  h.grant(MEERA, flat, "owner");
  h.grant(ANU, flat, "builder");
  h.grant(MEERA, lunch, "builder");
  h.grant(DEV, lunch, "owner");
  for (const [id, who] of Object.entries(IDENTITY)) h.profile(id, who);
  return {
    h,
    flat,
    lunch,
    tick(ms = 60_000) {
      clock = new Date(clock.getTime() + ms);
    },
    now: () => clock,
    async call<T>(method: string, url: string, as: string | null, body?: unknown) {
      const res = await h.call(method, url, { as, ...(body !== undefined ? { body } : {}) });
      return { status: res.status, body: await envelope<T>(res) };
    },
  };
}

export const me = (rest: string) => `/v1/kitchen/me/${rest}`;

/** Give `as` a profile; throws unless it is made (201) or saved (200). */
export async function makeProfile(
  w: CommunityWorld,
  as: string,
  handle: string,
  name: string,
  extra: { about?: string | null; privacy?: "public" | "private" } = {},
): Promise<MyProfileResponse["profile"]> {
  w.tick();
  const res = await w.call<MyProfileResponse>("PUT", me("profile"), as, { handle, name, ...extra });
  if (res.status !== 201 && res.status !== 200) throw new Error(`profile ${handle}: ${res.status} ${JSON.stringify(res.body.error)}`);
  return res.body.data.profile;
}

/** Follow `handle` as `as`; the response status and state. */
export async function follow(w: CommunityWorld, as: string, handle: string): Promise<{ status: number; state: string | undefined; reason: unknown }> {
  w.tick();
  const res = await w.call<{ state: string }>("POST", me(`follows/${handle}`), as);
  return { status: res.status, state: res.body.data?.state, reason: res.body.error?.details.reason };
}

/** The follow rows, as stored. */
export function followRows(w: CommunityWorld): Array<{ follower_id: string; followee_id: string; state: string }> {
  return w.h.db
    .prepare("SELECT follower_id, followee_id, state FROM kitchen_follows ORDER BY follower_id, followee_id")
    .all() as Array<{ follower_id: string; followee_id: string; state: string }>;
}

/** Write a recipe as `as` (Only me unless said); throws unless it is 201. */
export async function recipe(w: CommunityWorld, as: string, name: string, extra: Record<string, unknown> = {}): Promise<RecipeResponse["recipe"]> {
  w.tick();
  const res = await w.call<RecipeResponse>("POST", me("recipes"), as, {
    name,
    servesHalf: 4,
    lines: [{ foodKey: "chicken", name: "Chicken", quantity: "1", unit: "kg", isMain: true }],
    steps: ["Cook it"],
    ...extra,
  });
  if (res.status !== 201) throw new Error(`recipe ${name}: ${res.status} ${JSON.stringify(res.body.error)}`);
  return res.body.data.recipe;
}

/** List (or unlist) a recipe; the response. */
export async function list(w: CommunityWorld, as: string, recipeId: string, listed = true) {
  w.tick();
  return w.call<RecipeResponse>("PATCH", me(`recipes/${recipeId}`), as, { listed });
}
