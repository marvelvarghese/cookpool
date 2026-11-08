"use client";

/**
 * The browser half of shrinking a receipt photo (cookpool-ai AI-8, design
 * §3): decode the chosen file (turned the way its EXIF says), draw it at
 * 1200 px on the long side and encode a JPEG at 0.8, stepping down until its
 * base64 is at most 1.5 MB. The decisions are `receipt-image.ts`'s.
 */

import {
  base64OfDataUrl,
  decoderTurned,
  encodeAttempts,
  firstThatFits,
  orientationTransform,
  orientedSize,
  readJpegMeta,
  type EncodeAttempt,
  type Size,
} from "./receipt-image";

export interface ShrunkPhoto {
  /** The JPEG as the route takes it: base64, no prefix. */
  base64: string;
  /** The same JPEG, to show while it is read. */
  blob: Blob;
  width: number;
  height: number;
}

type Decoded = { source: CanvasImageSource; size: Size; close: () => void };

async function decode(file: Blob): Promise<Decoded> {
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
      return { source: bitmap, size: { width: bitmap.width, height: bitmap.height }, close: () => bitmap.close() };
    } catch {
      // Older Safari: fall back to an <img>, which turns the photo itself.
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = "async";
    img.src = url;
    await img.decode();
    return { source: img, size: { width: img.naturalWidth, height: img.naturalHeight }, close: () => URL.revokeObjectURL(url) };
  } catch (e) {
    URL.revokeObjectURL(url);
    throw e;
  }
}

function toBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), "image/jpeg", quality));
}

function dataUrlOf(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("Couldn't read the photo"));
    reader.readAsDataURL(blob);
  });
}

/** The photo, shrunk and turned, ready to send; throws when it can't be read or made small enough. */
export async function shrinkReceiptPhoto(file: Blob): Promise<ShrunkPhoto> {
  const head = new Uint8Array(await file.slice(0, 256 * 1024).arrayBuffer());
  const meta = readJpegMeta(head);
  const decoded = await decode(file);
  try {
    // Turn it ourselves only when the decoder visibly didn't.
    const turnBy = decoderTurned(meta, decoded.size) ? 1 : (meta?.orientation ?? 1);
    const seen = orientedSize(decoded.size, turnBy);
    const canvas = document.createElement("canvas");
    const draw = (a: EncodeAttempt): CanvasRenderingContext2D | null => {
      canvas.width = a.width;
      canvas.height = a.height;
      const ctx = canvas.getContext("2d");
      if (!ctx) return null;
      // What is drawn before turning: the canvas's size, unswapped.
      const drawn = orientedSize({ width: a.width, height: a.height }, turnBy);
      ctx.fillStyle = "#FFFFFF";
      ctx.fillRect(0, 0, a.width, a.height);
      ctx.setTransform(...orientationTransform(turnBy, drawn));
      ctx.drawImage(decoded.source, 0, 0, drawn.width, drawn.height);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      return ctx;
    };
    const fit = await firstThatFits(encodeAttempts(seen), async (a) => (draw(a) ? toBlob(canvas, a.quality) : null));
    if (!fit) throw new Error("The photo is too big to send");
    const base64 = base64OfDataUrl(await dataUrlOf(fit.result));
    return { base64, blob: fit.result, width: fit.attempt.width, height: fit.attempt.height };
  } finally {
    decoded.close();
  }
}
