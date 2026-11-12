"use client";

import * as React from "react";
import { Camera, Images, X } from "lucide-react";
import type { AiReceiptResponse } from "@saas/contracts/kitchen";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { K_BUTTON, K_BUTTON_QUIET, K_CARD } from "./kit";
import { useReadReceipt, useReceiptScanShows } from "./receipt-data";
import { shrinkReceiptPhoto } from "./receipt-photo";
import { receiptError, type ReceiptError } from "./receipt-run";
import { RECEIPT_ADJUST_DEFAULT, type ReceiptAdjustChoice } from "./receipt-adjust";
import { ReceiptAdjustCard } from "./receipt-adjust-ui";
import { SCAN_BILL_LABEL, TYPE_IT_IN, billPrefill, billReadUsable, type BillPrefill } from "./bill-scan";

/**
 * Scan a bill on Money's Add a bill (cookpool-ai AI-15): a quiet camera
 * button, shown only where Scan a receipt shows (the new frame, AI available
 * — the key and the month's budget — the server reading receipts, and this
 * device's switch on). Take or choose a photo → shrunk to 1200 px
 * (`shrinkReceiptPhoto`) → `client.kitchen.aiReceipt` → the form's title,
 * amount and date filled, with AI-14's card when the bill has taxes,
 * charges or discounts. Nothing is saved: the form's own Save does that.
 * The new look's tokens only, weights 400 and 500.
 */

export type BillScanPhase = "idle" | "pick" | "reading" | "result" | "problem";

export interface BillScan {
  phase: BillScanPhase;
  photoUrl: string | null;
  read: { res: AiReceiptResponse; at: Date } | null;
  choice: ReceiptAdjustChoice;
  error: ReceiptError | null;
  /** Why the last photo couldn't be used, on the pick step. */
  pickProblem: string | null;
  open: () => void;
  take: (file: File) => void;
  /** Reading → back to the pick step. */
  cancel: () => void;
  /** Type it in: the scan closes; the form keeps what it has. */
  close: () => void;
  toggle: (key: keyof ReceiptAdjustChoice) => void;
}

export function useBillScan(): BillScan {
  const readReceipt = useReadReceipt();
  const [phase, setPhase] = React.useState<BillScanPhase>("idle");
  const [photoUrl, setPhotoUrl] = React.useState<string | null>(null);
  const [read, setRead] = React.useState<BillScan["read"]>(null);
  const [choice, setChoice] = React.useState<ReceiptAdjustChoice>(RECEIPT_ADJUST_DEFAULT);
  const [error, setError] = React.useState<ReceiptError | null>(null);
  const [pickProblem, setPickProblem] = React.useState<string | null>(null);
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

  const open = React.useCallback(() => {
    setPickProblem(null);
    setError(null);
    setPhase("pick");
  }, []);

  const take = React.useCallback(
    (file: File) => {
      abort.current?.abort();
      const controller = new AbortController();
      abort.current = controller;
      setPickProblem(null);
      setError(null);
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
          setPickProblem("Couldn't use this photo · try another");
          setPhase("pick");
          return;
        }
        const r = await readReceipt(image, controller.signal);
        if (controller.signal.aborted) return;
        if (!r.ok || !billReadUsable(r.data)) {
          setError(r.ok ? receiptError(null) : receiptError(r.error, r.status));
          setPhase("problem");
          return;
        }
        setRead({ res: r.data, at: new Date() });
        setChoice(RECEIPT_ADJUST_DEFAULT);
        setPhase("result");
      })();
    },
    [readReceipt, setPhoto],
  );

  const cancel = React.useCallback(() => {
    abort.current?.abort();
    setPhoto(null);
    setPhase("pick");
  }, [setPhoto]);

  const close = React.useCallback(() => {
    abort.current?.abort();
    setError(null);
    setPickProblem(null);
    setPhase(read ? "result" : "idle");
    if (!read) setPhoto(null);
  }, [read, setPhoto]);

  const toggle = React.useCallback((key: keyof ReceiptAdjustChoice) => setChoice((c) => ({ ...c, [key]: !c[key] })), []);

  return { phase, photoUrl, read, choice, error, pickProblem, open, take, cancel, close, toggle };
}

/** The form's start from the scan, under the card's switches; null before a read. */
export function useBillPrefill(scan: Pick<BillScan, "read" | "choice">, currency: string): BillPrefill | null {
  const { read, choice } = scan;
  return React.useMemo(() => (read ? billPrefill(read.res, choice, { today: read.at, currency }) : null), [read, choice, currency]);
}

/** Whether Scan a bill shows: exactly where Scan a receipt does. */
export const useScanBillShows = useReceiptScanShows;

/** The entry: a quiet button with a camera; nothing when AI isn't available here. */
export function ScanBillButton({ shows, onClick }: { shows: boolean; onClick: () => void }) {
  if (!shows) return null;
  return (
    <Button type="button" variant="ghost" className={cn(K_BUTTON_QUIET, "w-full gap-2")} onClick={onClick}>
      <Camera className="h-[18px] w-[18px]" aria-hidden />
      {SCAN_BILL_LABEL}
    </Button>
  );
}

function Thumb({ url, className }: { url: string | null; className?: string }) {
  return url ? (
    <img src={url} alt="" className={cn("shrink-0 rounded-[10px] object-cover", className)} />
  ) : (
    <span aria-hidden className={cn("block shrink-0 rounded-[10px] bg-muted", className)} />
  );
}

const SHIMMER = `
@keyframes cookpool-bill-shimmer{0%{background-position:-200px 0}100%{background-position:200px 0}}
.cookpool-bill-sk{background:linear-gradient(90deg,hsl(var(--muted)) 0,hsl(var(--background)) 40px,hsl(var(--muted)) 80px);background-size:400px 100%;animation:cookpool-bill-shimmer 1.2s linear infinite}
@media (prefers-reduced-motion: reduce){.cookpool-bill-sk{animation:none}}`;

/** Take a photo or choose one, with Close; a photo that couldn't be used says so above. Quiet buttons: the form's Add bill stays the one main button. */
function Pick({ problem, onPhoto, onClose }: { problem: string | null; onPhoto: (file: File) => void; onClose: () => void }) {
  const camera = React.useRef<HTMLInputElement>(null);
  const photos = React.useRef<HTMLInputElement>(null);
  const take = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (file) onPhoto(file);
  };
  return (
    <section aria-label={SCAN_BILL_LABEL} className={cn(K_CARD, "flex flex-col gap-2.5 p-3.5")}>
      <div className="flex min-h-11 items-center gap-2">
        <Camera className="h-5 w-5 text-cp-accent-text" aria-hidden />
        <h3 className="min-w-0 flex-1 text-[15px] font-medium">{SCAN_BILL_LABEL}</h3>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="grid h-11 w-11 place-items-center rounded-xl text-muted-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <X className="h-5 w-5" aria-hidden />
        </button>
      </div>
      <p className="text-[13px] font-normal text-muted-foreground">Fit the whole bill · flat, in good light</p>
      {problem ? (
        <p role="alert" className="rounded-xl bg-cp-soon-tint px-3 py-2 text-sm font-normal text-cp-soon">
          {problem}
        </p>
      ) : null}
      <div className="grid grid-cols-2 gap-2">
        <Button type="button" variant="ghost" className={cn(K_BUTTON_QUIET, "gap-1.5")} onClick={() => camera.current?.click()}>
          <Camera className="h-4 w-4" aria-hidden />
          Take a photo
        </Button>
        <Button type="button" variant="outline" className={cn(K_BUTTON, "gap-1.5")} onClick={() => photos.current?.click()}>
          <Images className="h-4 w-4" aria-hidden />
          From photos
        </Button>
      </div>
      <input ref={camera} type="file" accept="image/*" capture="environment" className="sr-only" tabIndex={-1} aria-hidden onChange={take} />
      <input ref={photos} type="file" accept="image/*" className="sr-only" tabIndex={-1} aria-hidden onChange={take} />
    </section>
  );
}

/**
 * The scan above the form: the entry, the pick step, Reading, a refusal in
 * AI-8's words with Retake and Type it in, or the read's card with AI-14's
 * switches.
 */
export function BillScanPanel({ scan, prefill, shows }: { scan: BillScan; prefill: BillPrefill | null; shows: boolean }) {
  if (scan.phase === "pick") return <Pick problem={scan.pickProblem} onPhoto={scan.take} onClose={scan.close} />;
  if (scan.phase === "reading") {
    return (
      <section aria-busy="true" aria-label="Reading your bill" className="flex flex-col gap-2.5">
        <style>{SHIMMER}</style>
        <div className={cn(K_CARD, "flex items-center gap-3 p-3")}>
          <Thumb url={scan.photoUrl} className="h-[68px] w-[52px]" />
          <span className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="text-[15px] font-medium">Reading your bill…</span>
            <span role="status" className="text-[13px] font-normal text-cp-accent-text">
              The store, the date and the total
            </span>
          </span>
        </div>
        <span className="cookpool-bill-sk block h-11 rounded-xl" aria-hidden />
        <Button type="button" variant="outline" className={cn(K_BUTTON, "self-center")} onClick={scan.cancel}>
          Cancel
        </Button>
      </section>
    );
  }
  if (scan.phase === "problem" && scan.error) {
    const failed = scan.error.kind === "failed";
    return (
      <section aria-label={SCAN_BILL_LABEL} className="flex flex-col gap-2.5">
        <p role="alert" className="rounded-2xl bg-cp-soon-tint px-4 py-3 text-[15px] font-medium text-cp-soon">
          {scan.error.title}
        </p>
        <div className="grid grid-cols-2 gap-2">
          {failed ? (
            <Button type="button" variant="ghost" className={K_BUTTON_QUIET} onClick={scan.open}>
              Retake
            </Button>
          ) : null}
          <Button type="button" variant="outline" className={cn(K_BUTTON, !failed && "col-span-2")} onClick={scan.close}>
            {TYPE_IT_IN}
          </Button>
        </div>
      </section>
    );
  }
  if (scan.read && prefill) {
    return (
      <section aria-label="From your bill" className="flex flex-col gap-2.5">
        <div className={cn(K_CARD, "flex items-center gap-3 p-3")}>
          <Thumb url={scan.photoUrl} className="h-[52px] w-10" />
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="truncate text-[15px] font-medium">{prefill.heading}</span>
            <span className="text-[13px] font-normal tabular-nums text-muted-foreground">{prefill.sub}</span>
          </span>
          {shows ? (
            <Button type="button" variant="ghost" className={cn(K_BUTTON_QUIET, "px-3")} onClick={scan.open} aria-label="Scan another bill">
              <Camera className="h-4 w-4" aria-hidden />
            </Button>
          ) : null}
        </div>
        {prefill.card ? <ReceiptAdjustCard card={prefill.card} onToggle={scan.toggle} /> : null}
      </section>
    );
  }
  return <ScanBillButton shows={shows} onClick={scan.open} />;
}
