// A receipt photo as the receipt route takes it (AiReceiptRequest): a JPEG,
// at most 1200 px on the long side, at most AI_RECEIPT_MAX_BYTES decoded, in
// base64. Whatever the browser can draw (JPEG, PNG, WebP, HEIC on Safari) is
// redrawn on a canvas and re-encoded, so the route only ever sees a JPEG. A
// PDF is not an image: the person is asked for a photo or a screenshot.

import { AI_RECEIPT_MAX_BYTES } from "@saas/contracts/kitchen";

export const RECEIPT_LONG_SIDE = 1200;

export class PhotoError extends Error {}

/** The long side scaled to `max`, the short side in proportion (never enlarged). */
export function fitWithin(width: number, height: number, max = RECEIPT_LONG_SIDE): { width: number; height: number } {
  const long = Math.max(width, height);
  if (long <= max || long === 0) return { width, height };
  const k = max / long;
  return { width: Math.max(1, Math.round(width * k)), height: Math.max(1, Math.round(height * k)) };
}

/** Decoded bytes of a base64 string (no prefix). */
export function base64Bytes(b64: string): number {
  const pad = b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0;
  return Math.floor((b64.length * 3) / 4) - pad;
}

async function bitmapOf(file: Blob): Promise<{ draw: CanvasImageSource; width: number; height: number; close(): void }> {
  if (typeof createImageBitmap === "function") {
    try {
      const bmp = await createImageBitmap(file);
      return { draw: bmp, width: bmp.width, height: bmp.height, close: () => bmp.close() };
    } catch {
      /* fall back to an <img> below (Safari and HEIC) */
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = "async";
    img.src = url;
    await img.decode();
    return { draw: img, width: img.naturalWidth, height: img.naturalHeight, close: () => URL.revokeObjectURL(url) };
  } catch {
    URL.revokeObjectURL(url);
    throw new PhotoError("That file isn't a photo we can read. Try a JPEG or PNG.");
  }
}

/** The photo as base64 JPEG for POST /v1/kitchen/me/ai/receipt. */
export async function receiptImage(file: File): Promise<string> {
  if (file.type === "application/pdf" || /\.pdf$/i.test(file.name)) {
    throw new PhotoError("A PDF can't be read yet — take a screenshot of the bill and use that.");
  }
  const src = await bitmapOf(file);
  try {
    const size = fitWithin(src.width, src.height);
    const canvas = document.createElement("canvas");
    canvas.width = size.width;
    canvas.height = size.height;
    const g = canvas.getContext("2d");
    if (!g) throw new PhotoError("This browser can't prepare the photo.");
    g.fillStyle = "#ffffff";
    g.fillRect(0, 0, size.width, size.height);
    g.drawImage(src.draw, 0, 0, size.width, size.height);
    for (const quality of [0.85, 0.7, 0.55, 0.4]) {
      const b64 = canvas.toDataURL("image/jpeg", quality).replace(/^data:image\/jpeg;base64,/, "");
      if (base64Bytes(b64) <= AI_RECEIPT_MAX_BYTES) return b64;
    }
    throw new PhotoError("That photo is too large. Try one closer to the bill.");
  } finally {
    src.close();
  }
}
