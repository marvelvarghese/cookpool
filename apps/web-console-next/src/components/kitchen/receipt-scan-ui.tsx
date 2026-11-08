"use client";

import * as React from "react";
import { Camera, Check, Images, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { K_BUTTON } from "./kit";
import type { ReceiptCard, ReceiptError } from "./receipt-run";

/**
 * Scan a receipt's screens (cookpool-ai AI-8, the canvas's AiReceipt), with
 * the AI look (the canvas's rule 13): the "✨ Cookpool AI" chip, a thin
 * green-to-orange edge on what AI made, and a shimmer while it reads.
 * Capture is a dark full-screen step that hands over to the phone's camera
 * (`capture="environment"`) or its photos; Reading shows the photo under a
 * sweeping line; the result is the shopping run itself
 * (`shopping-run-ui.tsx`).
 */

/** The ✨ Cookpool AI chip. */
export function AiChip({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-full bg-gradient-to-br from-[#E4F2EA] to-[#FCE9DF] px-2.5 py-1 text-xs font-extrabold text-[#165C3A]",
        className,
      )}
    >
      <span aria-hidden>✨</span> Cookpool AI
    </span>
  );
}

/** The thin green-to-orange edge on anything AI made (a 1.5 px gradient border). */
export const AI_EDGE =
  "border-[1.5px] border-transparent [background:linear-gradient(hsl(var(--card)),hsl(var(--card)))_padding-box,linear-gradient(135deg,#1F7A4D,#B4471F)_border-box]";

/** What the scan's own animations need: the sweeping line and the rows' shimmer (still for reduced motion). */
function ScanStyles() {
  return (
    <style>{`
@keyframes cookpool-receipt-scan{0%{top:6%}100%{top:92%}}
@keyframes cookpool-receipt-shimmer{0%{background-position:-200px 0}100%{background-position:200px 0}}
.cookpool-receipt-line{animation:cookpool-receipt-scan 1.6s ease-in-out infinite alternate}
.cookpool-receipt-sk{background:linear-gradient(90deg,#ECEEE9 0,#F6F7F4 40px,#ECEEE9 80px);background-size:400px 100%;animation:cookpool-receipt-shimmer 1.2s linear infinite}
@media (prefers-reduced-motion: reduce){.cookpool-receipt-line{animation:none;top:50%}.cookpool-receipt-sk{animation:none}}
`}</style>
  );
}

const CORNER = "pointer-events-none absolute h-[34px] w-[34px] border-white";

/**
 * Capture: "Scan a receipt", corner guides, "Fit the whole bill · flat, in
 * good light", the shutter (the camera, `capture="environment"`) and Photos
 * (the library). A refusal from the last try shows above the shutter.
 */
export function ReceiptCapture({ onPhoto, onClose, problem }: { onPhoto: (file: File) => void; onClose: () => void; problem: string | null }) {
  const camera = React.useRef<HTMLInputElement>(null);
  const photos = React.useRef<HTMLInputElement>(null);
  const take = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (file) onPhoto(file);
  };
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div role="dialog" aria-modal="true" aria-label="Scan a receipt" className="fixed inset-0 z-50 flex flex-col bg-[#0E1411] pt-safe pb-safe text-white">
      <div className="flex items-center gap-2 px-[18px] py-4">
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="grid h-11 w-11 place-items-center rounded-xl bg-white/[0.12] text-white transition-colors hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
        >
          <X className="h-5 w-5" strokeWidth={2.4} aria-hidden />
        </button>
        <h1 className="flex-1 text-center text-base font-extrabold">Scan a receipt</h1>
        <span className="w-11" aria-hidden />
      </div>
      <div className="relative mx-7 flex-1 rounded-[22px] bg-gradient-to-br from-[#2A332E] to-[#1A211D]" aria-hidden>
        <span className="absolute inset-x-[22%] inset-y-[8%] -rotate-2 rounded-[4px] bg-[repeating-linear-gradient(#F3F1EA_0_10px,#E2DFD5_10px_12px)] opacity-[0.85]" />
        <span className={cn(CORNER, "left-3.5 top-3.5 rounded-tl-[10px] border-l-4 border-t-4")} />
        <span className={cn(CORNER, "right-3.5 top-3.5 rounded-tr-[10px] border-r-4 border-t-4")} />
        <span className={cn(CORNER, "bottom-3.5 left-3.5 rounded-bl-[10px] border-b-4 border-l-4")} />
        <span className={cn(CORNER, "bottom-3.5 right-3.5 rounded-br-[10px] border-b-4 border-r-4")} />
      </div>
      {problem ? (
        <p role="alert" className="mx-7 mt-3 rounded-xl bg-[#FDF1D6] px-3 py-2 text-center text-sm font-bold text-[#5C3D00]">
          {problem}
        </p>
      ) : null}
      <p className="p-3.5 text-center text-sm font-bold text-[#DCE3DE]">Fit the whole bill · flat, in good light</p>
      <div className="flex items-center justify-between px-7 pb-[34px] pt-1.5">
        <button
          type="button"
          onClick={() => photos.current?.click()}
          className="flex min-h-11 w-[84px] items-center justify-center gap-1.5 rounded-xl bg-white/[0.12] px-3 text-sm font-extrabold text-white transition-colors hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
        >
          <Images className="h-4 w-4" aria-hidden />
          Photos
        </button>
        <button
          type="button"
          onClick={() => camera.current?.click()}
          aria-label="Take photo"
          className="h-[76px] w-[76px] rounded-full border-[5px] border-white bg-white shadow-[inset_0_0_0_3px_#0E1411] transition-transform active:scale-95 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#1F7A4D]"
        />
        <span className="w-[84px]" aria-hidden />
      </div>
      <input ref={camera} type="file" accept="image/*" capture="environment" className="sr-only" tabIndex={-1} aria-hidden onChange={take} />
      <input ref={photos} type="file" accept="image/*" className="sr-only" tabIndex={-1} aria-hidden onChange={take} />
    </div>
  );
}

/** The photo, or the receipt-paper stand-in before it decodes. */
function Photo({ url, className }: { url: string | null; className?: string }) {
  return url ? (
    <img src={url} alt="" className={cn("h-full w-full object-cover", className)} />
  ) : (
    <span className={cn("block h-full w-full bg-[repeating-linear-gradient(#F3F1EA_0_12px,#E2DFD5_12px_14px)]", className)} />
  );
}

/**
 * Reading: the chip and "Reading your receipt…", the photo under a sweeping
 * green-to-orange line, "Found 9 lines · matching to your pantries…", rows
 * shimmering, and Cancel.
 */
export function ReceiptReading({ photoUrl, text, onCancel }: { photoUrl: string | null; text: string; onCancel: () => void }) {
  return (
    <div className="flex flex-col gap-3.5" aria-busy="true">
      <ScanStyles />
      <div className="flex items-center gap-2">
        <AiChip />
        <h1 className="min-w-0 flex-1 truncate text-lg font-extrabold">Reading your receipt…</h1>
      </div>
      <div className="relative h-[260px] overflow-hidden rounded-[20px] bg-[#F3F1EA]">
        <Photo url={photoUrl} />
        <span
          aria-hidden
          className="cookpool-receipt-line absolute inset-x-0 h-[3px] bg-gradient-to-r from-transparent via-[#1F7A4D] to-transparent shadow-[0_0_12px_#1F7A4D]"
          style={{ backgroundImage: "linear-gradient(90deg, transparent, #1F7A4D, #B4471F, transparent)" }}
        />
      </div>
      <p role="status" className="text-[13px] font-bold text-[#165C3A]">
        {text}
      </p>
      <span className="cookpool-receipt-sk block h-[52px] rounded-lg" aria-hidden />
      <span className="cookpool-receipt-sk block h-[52px] rounded-lg" aria-hidden />
      <span className="cookpool-receipt-sk block h-[52px] rounded-lg" aria-hidden />
      <Button type="button" variant="outline" className={cn(K_BUTTON, "self-center")} onClick={onCancel}>
        Cancel
      </Button>
    </div>
  );
}

/** A refusal in place of the result: the photo, one line, and what to do next. */
export function ReceiptProblem({
  photoUrl,
  error,
  onRetake,
  onByHand,
}: {
  photoUrl: string | null;
  error: ReceiptError;
  onRetake: () => void;
  onByHand: () => void;
}) {
  return (
    <div className="flex flex-col gap-3.5">
      <div className="flex items-center gap-2">
        <AiChip />
        <h1 className="min-w-0 flex-1 truncate text-lg font-extrabold">Scan a receipt</h1>
      </div>
      <div className="relative h-[180px] overflow-hidden rounded-[20px] bg-[#F3F1EA] opacity-60">
        <Photo url={photoUrl} />
      </div>
      <p role="alert" className="rounded-2xl bg-[#FDF1D6] px-4 py-3 text-[15px] font-extrabold text-[#5C3D00]">
        {error.title}
      </p>
      <div className="grid grid-cols-2 gap-2">
        {error.kind === "failed" ? (
          <Button type="button" className={K_BUTTON} onClick={onRetake}>
            Retake
          </Button>
        ) : null}
        <Button type="button" variant="outline" className={cn(K_BUTTON, error.kind !== "failed" && "col-span-2")} onClick={onByHand}>
          Add by hand
        </Button>
      </div>
    </div>
  );
}

/** The receipt's card: the photo, "DMart · today 6:40 pm", "9 lines · bill ₹642", and whether the lines add up. */
export function ReceiptCardView({ card, photoUrl }: { card: ReceiptCard; photoUrl: string | null }) {
  return (
    <div className={cn("flex items-center gap-3 rounded-[20px] p-3", AI_EDGE)}>
      <span className="h-[68px] w-[52px] shrink-0 overflow-hidden rounded-lg bg-[#F3F1EA]" aria-hidden>
        <Photo url={photoUrl} />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-base font-extrabold">{card.title}</span>
        <span className="text-[13px] font-bold text-[#3F4842]">{card.sub}</span>
        {card.total ? (
          <span
            className={cn(
              "mt-0.5 self-start rounded-full px-2 py-0.5 text-xs font-extrabold",
              card.total.ok ? "bg-[#E4F2EA] text-[#165C3A]" : "bg-[#FDF1D6] text-[#8A5A00]",
            )}
          >
            {card.total.text}
          </span>
        ) : null}
      </span>
    </div>
  );
}

/** The run's Scan a receipt button (top of `/pantry/run`). */
export function ScanReceiptButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex min-h-[52px] w-full items-center gap-3 rounded-2xl px-3.5 text-left transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        AI_EDGE,
      )}
    >
      <Camera className="h-5 w-5 shrink-0 text-[#165C3A]" strokeWidth={2.2} aria-hidden />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="text-[15px] font-extrabold">Scan a receipt</span>
        <span className="text-xs font-semibold text-muted-foreground">Fill the run from a photo of the bill</span>
      </span>
      <AiChip className="hidden min-[360px]:inline-flex" />
    </button>
  );
}

/** A tick, as the run's (44 px). */
export function TickButton({ on, label, onClick }: { on: boolean; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      aria-label={label}
      onClick={onClick}
      className={cn(
        "grid h-11 w-11 shrink-0 place-items-center rounded-[14px] border-[1.5px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        on ? "border-primary bg-primary text-primary-foreground" : "border-[#C9CFC6] bg-card text-[#C9CFC6] hover:bg-accent",
      )}
    >
      <Check className="h-5 w-5" strokeWidth={2.6} aria-hidden />
    </button>
  );
}
