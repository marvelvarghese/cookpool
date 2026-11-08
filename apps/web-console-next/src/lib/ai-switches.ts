"use client";

/**
 * Cookpool AI's switches on this device (cookpool-ai design §7: "The switches
 * are stored on the device"). Every feature is on until it is turned off; the
 * ones turned off are kept as a JSON object under `<storagePrefix>.ai-switches`
 * (`{ "receipt": false }`). AI-8 reads the receipt switch; You → Cookpool AI
 * (AI-7) turns them. Every read and write survives storage being unavailable:
 * the switches then read on.
 */

import * as React from "react";
import { appConfig } from "./app-config";

export type AiSwitchKey = "sayIt" | "receipt" | "import" | "voice" | "swaps";

const key = (): string => `${appConfig().storagePrefix}.ai-switches`;
const EVENT = "cookpool:ai-switches";

/** Which switches are off, from the stored text: anything unreadable reads as all on. */
export function parseAiSwitches(raw: string | null): Readonly<Partial<Record<AiSwitchKey, false>>> {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const off: Partial<Record<AiSwitchKey, false>> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) if (v === false) off[k as AiSwitchKey] = false;
    return off;
  } catch {
    return {};
  }
}

/** Whether a feature's switch is on, given the stored text. */
export function aiSwitchOn(raw: string | null, feature: AiSwitchKey): boolean {
  return parseAiSwitches(raw)[feature] !== false;
}

function readRaw(): string | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage.getItem(key());
  } catch {
    return null;
  }
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

/** Turn a feature on or off on this device. */
export function setAiSwitch(feature: AiSwitchKey, on: boolean): void {
  const off: Record<string, false> = { ...parseAiSwitches(readRaw()) };
  if (on) delete off[feature];
  else off[feature] = false;
  try {
    if (Object.keys(off).length === 0) window.localStorage.removeItem(key());
    else window.localStorage.setItem(key(), JSON.stringify(off));
  } catch {
    // Full or blocked: the switch reads on.
  }
  window.dispatchEvent(new Event(EVENT));
}

/** Whether a feature's switch is on, on this device. */
export function useAiSwitch(feature: AiSwitchKey): boolean {
  const raw = React.useSyncExternalStore(subscribe, readRaw, () => null);
  return aiSwitchOn(raw, feature);
}
