"use client";

/**
 * What this device remembers about the new Pantry (cookpool-pantry PN-5,
 * design §1.1, §1.6): which sections are folded, and each item's set row as
 * it was left — its amount and people — until Use; and (RV-10) each food's
 * usual unit. JSON values in localStorage under
 * `<storagePrefix>.pantry-folded`, `<storagePrefix>.pantry-drafts` and
 * `<storagePrefix>.pantry-units`; all are forgotten when the person signs
 * out of this device (`clearPantryDevice`, from `clearDeviceRecords`). Every
 * read and write survives storage being unavailable: the Pantry then just
 * forgets.
 */

import * as React from "react";
import { appConfig } from "./app-config";
import { parseDrafts, putDraft, type UseDraft } from "@/components/kitchen/pantry-set";
import { parseUsualUnits, putUsualUnit } from "@/components/kitchen/tick-row";

const foldedKey = (): string => `${appConfig().storagePrefix}.pantry-folded`;
const draftsKey = (): string => `${appConfig().storagePrefix}.pantry-drafts`;
// RV-10: each food's usual unit, as the tick row's unit chips last chose it.
const unitsKey = (): string => `${appConfig().storagePrefix}.pantry-units`;
const EVENT = "cookpool:pantry-device";

function storage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function readRaw(key: string): string | null {
  try {
    return storage()?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function writeRaw(key: string, value: string | null): void {
  try {
    const s = storage();
    if (!s) return;
    if (value === null) s.removeItem(key);
    else s.setItem(key, value);
  } catch {
    // Full or blocked: the Pantry forgets, nothing else.
  }
  if (typeof window !== "undefined") window.dispatchEvent(new Event(EVENT));
}

function subscribe(listener: () => void): () => void {
  if (typeof window === "undefined") return () => undefined;
  window.addEventListener(EVENT, listener);
  window.addEventListener("storage", listener);
  return () => {
    window.removeEventListener(EVENT, listener);
    window.removeEventListener("storage", listener);
  };
}

// One parsed value per stored text, as `useSyncExternalStore` needs.
const EMPTY_FOLDED: ReadonlySet<string> = new Set();
let folded: { raw: string | null; value: ReadonlySet<string> } = { raw: null, value: EMPTY_FOLDED };
let drafts: { raw: string | null; value: Readonly<Record<string, UseDraft>> } = { raw: null, value: {} };

function readFolded(): ReadonlySet<string> {
  const raw = readRaw(foldedKey());
  if (raw !== folded.raw) {
    let value: ReadonlySet<string> = EMPTY_FOLDED;
    try {
      const parsed: unknown = raw ? JSON.parse(raw) : [];
      if (Array.isArray(parsed)) value = new Set(parsed.filter((x): x is string => typeof x === "string"));
    } catch {
      value = EMPTY_FOLDED;
    }
    folded = { raw, value };
  }
  return folded.value;
}

let units: { raw: string | null; value: Readonly<Record<string, string>> } = { raw: null, value: {} };

function readUnits(): Readonly<Record<string, string>> {
  const raw = readRaw(unitsKey());
  if (raw !== units.raw) units = { raw, value: parseUsualUnits(raw) };
  return units.value;
}

/** Each food's usual unit on this device (`usualUnitKey` → "m:glass"), RV-10. */
export function useUsualUnits(): Readonly<Record<string, string>> {
  return React.useSyncExternalStore(subscribe, readUnits, () => units.value);
}

/** Keep a food's usual unit (the tick row's unit chip). */
export function saveUsualUnit(key: string, unitId: string): void {
  writeRaw(unitsKey(), JSON.stringify(putUsualUnit(readUnits(), key, unitId)));
}

function readDrafts(): Readonly<Record<string, UseDraft>> {
  const raw = readRaw(draftsKey());
  if (raw !== drafts.raw) drafts = { raw, value: parseDrafts(raw) };
  return drafts.value;
}

/** The sections folded on this device, and how to change them. */
export function useFoldedSections(): [ReadonlySet<string>, (next: ReadonlySet<string>) => void] {
  const value = React.useSyncExternalStore(subscribe, readFolded, () => EMPTY_FOLDED);
  const set = React.useCallback((next: ReadonlySet<string>) => writeRaw(foldedKey(), next.size > 0 ? JSON.stringify([...next]) : null), []);
  return [value, set];
}

/** Every item's draft on this device. */
export function usePantryDrafts(): Readonly<Record<string, UseDraft>> {
  return React.useSyncExternalStore(subscribe, readDrafts, () => drafts.value);
}

/** Keep (or, with null, forget) one item's draft. */
export function saveDraft(itemId: string, draft: UseDraft | null): void {
  const next = putDraft(readDrafts(), itemId, draft);
  writeRaw(draftsKey(), Object.keys(next).length > 0 ? JSON.stringify(next) : null);
}

/** Forget them all (signing out of this device). */
export function clearPantryDevice(): void {
  writeRaw(foldedKey(), null);
  writeRaw(draftsKey(), null);
  writeRaw(unitsKey(), null);
}
