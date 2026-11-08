"use client";

/**
 * Where this device remembers long prep (cookpool-guided GC-6): one JSON
 * object in localStorage under `<storagePrefix>.long-prep`, by recipe and
 * step key — "Already done", or the timer set by "Soak now · ping me". Each
 * record means something for a day (components/kitchen/long-prep.ts), and
 * the whole object is forgotten when the person signs out of this device
 * (`clearLongPrep`, from `clearDeviceRecords`).
 */

import * as React from "react";
import { appConfig } from "./app-config";
import { parseLongPrepMemory, pruneLongPrep, type LongPrepMemory } from "@/components/kitchen/long-prep";

const storageKey = (): string => `${appConfig().storagePrefix}.long-prep`;

function storage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

const listeners = new Set<() => void>();
let snapshot: { raw: string | null; value: LongPrepMemory } = { raw: null, value: {} };

function readRaw(): string | null {
  try {
    return storage()?.getItem(storageKey()) ?? null;
  } catch {
    return null;
  }
}

/** What this device remembers (one parsed object per stored text, as `useSyncExternalStore` needs). */
export function readLongPrep(): LongPrepMemory {
  const raw = readRaw();
  if (raw !== snapshot.raw) snapshot = { raw, value: parseLongPrepMemory(raw) };
  return snapshot.value;
}

/** Remember `memory`, less the records past their day. */
export function writeLongPrep(memory: LongPrepMemory, now: Date = new Date()): void {
  const kept = pruneLongPrep(memory, now);
  try {
    const s = storage();
    if (Object.keys(kept).length === 0) s?.removeItem(storageKey());
    else s?.setItem(storageKey(), JSON.stringify(kept));
  } catch {
    /* without storage, "Already done" lasts until the page closes */
  }
  for (const l of [...listeners]) l();
}

/** Forget it all (signing out of this device). */
export function clearLongPrep(): void {
  try {
    storage()?.removeItem(storageKey());
  } catch {
    /* nothing to forget */
  }
  for (const l of [...listeners]) l();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  const onStorage = (e: StorageEvent) => {
    if (e.key === null || e.key === storageKey()) listener();
  };
  if (typeof window !== "undefined") window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    if (typeof window !== "undefined") window.removeEventListener("storage", onStorage);
  };
}

const EMPTY: LongPrepMemory = {};

/** This device's long prep records; re-renders when they change (here or in another tab). */
export function useLongPrepMemory(): LongPrepMemory {
  return React.useSyncExternalStore(subscribe, readLongPrep, () => EMPTY);
}
