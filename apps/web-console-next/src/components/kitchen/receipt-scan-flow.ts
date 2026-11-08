"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import type { AiReceiptResponse } from "@saas/contracts/kitchen";
import { useReadReceipt, useReceiptCategories, useReceiptScanShows } from "./receipt-data";
import { shrinkReceiptPhoto } from "./receipt-photo";
import { receiptError, scanRequested, type ReceiptError } from "./receipt-run";

/**
 * Scan a receipt's steps on the shopping run (cookpool-ai AI-8): capture →
 * reading → the run filled from the result, or a refusal in one line.
 * `?scan=1` (the Pantry's camera) opens the camera at once.
 */

export type ReceiptPhase = "idle" | "capture" | "reading" | "result" | "problem";

/** The least time "Found 9 lines · matching to your pantries…" shows (while the lines' categories are read). */
export const FOUND_BEAT_MS = 600;

export interface ReceiptScan {
  phase: ReceiptPhase;
  /** Scan a receipt shows here (new frame, AI available, the switch on). */
  shows: boolean;
  /** Opened from the Pantry's camera: closing the camera goes back there. */
  fromLink: boolean;
  photoUrl: string | null;
  /** Lines found, once the read is back. */
  found: number | null;
  read: { res: AiReceiptResponse; at: Date; categories: Readonly<Record<number, string>> } | null;
  error: ReceiptError | null;
  /** Why the last photo couldn't be used, on the camera step. */
  captureProblem: string | null;
  open: () => void;
  take: (file: File) => void;
  cancel: () => void;
  retake: () => void;
  /** Back to the run as it was (Add by hand). */
  reset: () => void;
}

function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => {
      clearTimeout(t);
      resolve();
    });
  });
}

export function useReceiptScan(): ReceiptScan {
  const shows = useReceiptScanShows();
  const readReceipt = useReadReceipt();
  const readCategories = useReceiptCategories();
  const router = useRouter();
  const [phase, setPhase] = React.useState<ReceiptPhase>("idle");
  const [photoUrl, setPhotoUrl] = React.useState<string | null>(null);
  const [found, setFound] = React.useState<number | null>(null);
  const [read, setRead] = React.useState<ReceiptScan["read"]>(null);
  const [error, setError] = React.useState<ReceiptError | null>(null);
  const [captureProblem, setCaptureProblem] = React.useState<string | null>(null);
  const [fromLink, setFromLink] = React.useState(false);
  const abort = React.useRef<AbortController | null>(null);
  const urlRef = React.useRef<string | null>(null);

  const setPhoto = React.useCallback((url: string | null) => {
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    urlRef.current = url;
    setPhotoUrl(url);
  }, []);

  React.useEffect(
    () => () => {
      abort.current?.abort();
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    },
    [],
  );

  // `?scan=1`: open the camera once Scan a receipt is known to show, and take the flag off the address.
  const asked = React.useRef<boolean | null>(null);
  React.useEffect(() => {
    if (asked.current === null) asked.current = scanRequested(window.location.search);
    if (!asked.current) return;
    if (shows) {
      asked.current = false;
      setFromLink(true);
      setPhase("capture");
      router.replace("/pantry/run", { scroll: false });
    }
  }, [shows, router]);

  const open = React.useCallback(() => {
    setCaptureProblem(null);
    setError(null);
    setPhase("capture");
  }, []);

  const take = React.useCallback(
    (file: File) => {
      abort.current?.abort();
      const controller = new AbortController();
      abort.current = controller;
      setCaptureProblem(null);
      setError(null);
      setFound(null);
      setRead(null);
      setPhoto(null);
      setPhase("reading");
      void (async () => {
        let image: string;
        try {
          const shrunk = await shrinkReceiptPhoto(file);
          if (controller.signal.aborted) return;
          setPhoto(URL.createObjectURL(shrunk.blob));
          image = shrunk.base64;
        } catch {
          if (controller.signal.aborted) return;
          setCaptureProblem("Couldn't use this photo · try another");
          setPhase("capture");
          return;
        }
        const r = await readReceipt(image, controller.signal);
        if (controller.signal.aborted) return;
        if (!r.ok || r.data.lines.length === 0) {
          setError(r.ok ? receiptError(null) : receiptError(r.error, r.status));
          setPhase("problem");
          return;
        }
        setFound(r.data.lines.length);
        const [categories] = await Promise.all([readCategories(r.data, controller.signal), wait(FOUND_BEAT_MS, controller.signal)]);
        if (controller.signal.aborted) return;
        setRead({ res: r.data, at: new Date(), categories });
        setPhase("result");
      })();
    },
    [readReceipt, readCategories, setPhoto],
  );

  const cancel = React.useCallback(() => {
    abort.current?.abort();
    setPhoto(null);
    setFound(null);
    setPhase("capture");
  }, [setPhoto]);

  const retake = React.useCallback(() => {
    setError(null);
    setPhoto(null);
    setPhase("capture");
  }, [setPhoto]);

  const reset = React.useCallback(() => {
    abort.current?.abort();
    setError(null);
    setRead(null);
    setFound(null);
    setPhoto(null);
    setPhase("idle");
  }, [setPhoto]);

  return { phase, shows, fromLink, photoUrl, found, read, error, captureProblem, open, take, cancel, retake, reset };
}
