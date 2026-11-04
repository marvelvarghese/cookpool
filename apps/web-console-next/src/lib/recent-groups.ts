"use client";

/**
 * The groups a person opened most recently on this device (Cookpool CP-5),
 * for the Groups list's "Recent" sort and the sidebar's "Recent groups".
 *
 * A low-sensitivity hint (slugs only) in localStorage, like the admin
 * console's last-org (`last-org.ts`). A slug that no longer resolves is
 * harmless: sorting only ranks the groups the API returns.
 */

import * as React from "react";
import { appConfig } from "./app-config";
import { pushRecentSlug } from "@/components/kitchen/groups";

// Built per call: the storage prefix is runtime config (saas-console-artifact CA1).
const recentKey = (): string => `${appConfig().storagePrefix}.recent-groups`;
const CHANGE_EVENT = "cookpool:recent-groups";
const EMPTY: readonly string[] = [];

let cachedRaw: string | null = null;
let cachedList: readonly string[] = EMPTY;

function read(): readonly string[] {
  if (typeof window === "undefined") return EMPTY;
  let raw: string | null;
  try {
    raw = window.localStorage.getItem(recentKey());
  } catch {
    return EMPTY;
  }
  // useSyncExternalStore needs a stable snapshot: re-parse only on change.
  if (raw === cachedRaw) return cachedList;
  cachedRaw = raw;
  try {
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    cachedList = Array.isArray(parsed) ? parsed.filter((s): s is string => typeof s === "string") : EMPTY;
  } catch {
    cachedList = EMPTY;
  }
  return cachedList;
}

/** Note that the person opened the group `slug`. */
export function recordRecentGroup(slug: string): void {
  if (typeof window === "undefined" || !slug) return;
  const next = pushRecentSlug(read(), slug);
  try {
    window.localStorage.setItem(recentKey(), JSON.stringify(next));
  } catch {
    return;
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

/** Forget every group (signing out of this device, SI-6). */
export function clearRecentGroups(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(recentKey());
    window.localStorage.removeItem(idsKey());
  } catch {
    return;
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

// ── Which id a slug had (Cookpool SM-5) ───────────────────────────
//
// A group's reads are by its `org_…` id, and the address names its slug, so
// a group page opened cold waited for the group list before reading anything
// of the group. Remembering the id each slug had lets its reads start at once,
// beside the list. A hint, like the slugs: a stale id only reads ahead what
// the page then does not use.

const idsKey = (): string => `${appConfig().storagePrefix}.group-ids`;
/** At most this many slugs are remembered (the most recent). */
const MAX_IDS = 20;

function readIds(): Record<string, string> {
  if (typeof window === "undefined") return {};
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(idsKey()) ?? "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: Record<string, string> = {};
    for (const [slug, id] of Object.entries(parsed as Record<string, unknown>)) if (typeof id === "string") out[slug] = id;
    return out;
  } catch {
    return {};
  }
}

/** Note the id the group `slug` has. */
export function rememberGroupId(slug: string, orgId: string): void {
  if (typeof window === "undefined" || !slug || !orgId) return;
  const ids = readIds();
  if (ids[slug] === orgId) return;
  delete ids[slug];
  const next = Object.fromEntries([[slug, orgId] as const, ...Object.entries(ids)].slice(0, MAX_IDS));
  try {
    window.localStorage.setItem(idsKey(), JSON.stringify(next));
  } catch {
    return;
  }
}

/** The id the group `slug` had when last opened here, if it was. */
export function rememberedGroupId(slug: string): string | null {
  return readIds()[slug] ?? null;
}

/** Forget a group (after leaving it). */
export function forgetRecentGroup(slug: string): void {
  if (typeof window === "undefined") return;
  const next = read().filter((s) => s !== slug);
  const ids = readIds();
  delete ids[slug];
  try {
    window.localStorage.setItem(recentKey(), JSON.stringify(next));
    window.localStorage.setItem(idsKey(), JSON.stringify(ids));
  } catch {
    return;
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener(CHANGE_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

/** The recent slugs, most recent first; re-renders when they change. */
export function useRecentGroupSlugs(): readonly string[] {
  return React.useSyncExternalStore(subscribe, read, () => EMPTY);
}
