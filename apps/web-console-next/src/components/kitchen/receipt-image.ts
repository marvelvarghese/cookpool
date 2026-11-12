/**
 * Shrinking a receipt photo before it is sent (cookpool-ai AI-8, design §3)
 * as pure arithmetic: 1200 px on the long side, JPEG at 0.8, stepping the
 * quality down (and then the size) until its base64 is at most 1.5 MB, and
 * the photo turned the way its EXIF says. The browser half
 * (`receipt-photo.ts`) decodes, draws and encodes; everything it decides
 * comes from here, so it is unit-testable.
 */

/** The long side a receipt is sent at, in pixels. */
export const RECEIPT_LONG_SIDE = 1200;
/** The most the route takes: the base64 text, in characters (1.5 MB). */
export const RECEIPT_MAX_BASE64 = 1_500_000;
/** The JPEG qualities tried, in order. */
export const RECEIPT_QUALITIES: readonly number[] = [0.8, 0.7, 0.6, 0.5];
/** When even the last quality is too big, the long side shrinks by this much and the qualities run again. */
export const RECEIPT_SHRINK = 0.8;
/** It never goes below this long side: a smaller receipt can't be read. */
export const RECEIPT_MIN_LONG_SIDE = 600;

export interface Size {
  width: number;
  height: number;
}

/** How long a file of `bytes` is as base64 (no `data:` prefix). */
export function base64Length(bytes: number): number {
  return 4 * Math.ceil(bytes / 3);
}

/** Whether an encoded photo of `bytes` can be sent. */
export function fitsReceiptLimit(bytes: number): boolean {
  return base64Length(bytes) <= RECEIPT_MAX_BASE64;
}

/** EXIF orientations 5–8 are a quarter turn: width and height swap. */
export function swapsSides(orientation: number): boolean {
  return orientation >= 5 && orientation <= 8;
}

/** The photo's size as seen, once its EXIF orientation is applied. */
export function orientedSize(size: Size, orientation: number): Size {
  return swapsSides(orientation) ? { width: size.height, height: size.width } : { width: size.width, height: size.height };
}

/** `size` with its long side at most `max` (never made bigger), whole pixels, at least 1. */
export function fitLongSide(size: Size, max: number = RECEIPT_LONG_SIDE): Size {
  const long = Math.max(size.width, size.height);
  if (long <= max) return { width: size.width, height: size.height };
  const k = max / long;
  return { width: Math.max(1, Math.round(size.width * k)), height: Math.max(1, Math.round(size.height * k)) };
}

/** One encoding to try: the canvas's size (as seen) and the JPEG quality. */
export interface EncodeAttempt extends Size {
  quality: number;
}

/**
 * The encodings to try, in order: the photo at 1200 px on the long side with
 * each quality, then 0.8 of that with each quality, and so on down to
 * RECEIPT_MIN_LONG_SIDE (a photo already smaller starts at its own size).
 * `longSide` is where it starts: a recipe photo (AI-9) starts at 1600.
 */
export function encodeAttempts(seen: Size, longSide: number = RECEIPT_LONG_SIDE): EncodeAttempt[] {
  const attempts: EncodeAttempt[] = [];
  let long = Math.min(longSide, Math.max(seen.width, seen.height));
  const floor = Math.min(RECEIPT_MIN_LONG_SIDE, long);
  for (;;) {
    const size = fitLongSide(seen, long);
    for (const quality of RECEIPT_QUALITIES) attempts.push({ ...size, quality });
    const next = Math.round(long * RECEIPT_SHRINK);
    if (long <= floor || next < floor) break;
    long = next;
  }
  return attempts;
}

/**
 * The first attempt whose encoding fits (base64 ≤ 1.5 MB), trying them in
 * order; null when none does. `encode` returns the encoded bytes' length, or
 * null when the browser couldn't encode.
 */
export async function firstThatFits<T extends { size: number }>(
  attempts: readonly EncodeAttempt[],
  encode: (attempt: EncodeAttempt) => Promise<T | null>,
): Promise<{ attempt: EncodeAttempt; result: T } | null> {
  for (const attempt of attempts) {
    const result = await encode(attempt);
    if (result && fitsReceiptLimit(result.size)) return { attempt, result };
  }
  return null;
}

// ── EXIF orientation ─────────────────────────────────────────────

/** What a JPEG's header says: its stored size and its EXIF orientation (1 when none). */
export interface JpegMeta extends Size {
  orientation: number;
}

function readU16(bytes: Uint8Array, at: number, little: boolean): number {
  const a = bytes[at] ?? 0;
  const b = bytes[at + 1] ?? 0;
  return little ? a | (b << 8) : (a << 8) | b;
}

function readU32(bytes: Uint8Array, at: number, little: boolean): number {
  const hi = readU16(bytes, little ? at + 2 : at, little);
  const lo = readU16(bytes, little ? at : at + 2, little);
  return hi * 65536 + lo;
}

/** The EXIF orientation in an APP1 segment's TIFF block starting at `tiff`; 1 when absent or odd. */
function exifOrientation(bytes: Uint8Array, tiff: number, end: number): number {
  const order = readU16(bytes, tiff, false);
  if (order !== 0x4949 && order !== 0x4d4d) return 1;
  const little = order === 0x4949;
  if (readU16(bytes, tiff + 2, little) !== 42) return 1;
  const ifd = tiff + readU32(bytes, tiff + 4, little);
  if (ifd + 2 > end) return 1;
  const count = readU16(bytes, ifd, little);
  for (let i = 0; i < count; i++) {
    const entry = ifd + 2 + i * 12;
    if (entry + 12 > end) break;
    if (readU16(bytes, entry, little) === 0x0112) {
      const value = readU16(bytes, entry + 8, little);
      return value >= 1 && value <= 8 ? value : 1;
    }
  }
  return 1;
}

/**
 * A JPEG's stored size and EXIF orientation, read from its markers; null
 * when it isn't a JPEG (or has no frame header).
 */
export function readJpegMeta(bytes: Uint8Array): JpegMeta | null {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let orientation = 1;
  let at = 2;
  while (at + 4 <= bytes.length) {
    if (bytes[at] !== 0xff) return null;
    const marker = bytes[at + 1]!;
    if (marker === 0xff) {
      at += 1;
      continue;
    }
    if (marker === 0xd9 || marker === 0xda) return null;
    const length = readU16(bytes, at + 2, false);
    const body = at + 4;
    const end = Math.min(bytes.length, at + 2 + length);
    if (marker === 0xe1 && length >= 8 && bytes[body] === 0x45 && bytes[body + 1] === 0x78 && bytes[body + 2] === 0x69 && bytes[body + 3] === 0x66) {
      orientation = exifOrientation(bytes, body + 6, end);
    }
    const isFrame = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isFrame) {
      const height = readU16(bytes, body + 1, false);
      const width = readU16(bytes, body + 3, false);
      return width > 0 && height > 0 ? { width, height, orientation } : null;
    }
    at += 2 + length;
  }
  return null;
}

/**
 * Whether the browser already turned the photo when it decoded it.
 * Browsers do (`image-orientation: from-image`, `createImageBitmap`'s
 * `from-image`); the one case its size can disprove is a quarter turn of a
 * photo that isn't square: decoded at the stored size, unswapped, it wasn't
 * turned and the canvas must do it.
 */
export function decoderTurned(meta: JpegMeta | null, decoded: Size): boolean {
  if (!meta || meta.orientation <= 1) return true;
  if (!swapsSides(meta.orientation) || meta.width === meta.height) return true;
  return !(decoded.width === meta.width && decoded.height === meta.height);
}

/**
 * The canvas transform (`ctx.setTransform(a, b, c, d, e, f)`) that draws a
 * photo stored `drawn` big (already scaled) the way EXIF `orientation` says,
 * on a canvas of `orientedSize(drawn, orientation)`.
 */
export function orientationTransform(orientation: number, drawn: Size): [number, number, number, number, number, number] {
  const { width: w, height: h } = drawn;
  switch (orientation) {
    case 2:
      return [-1, 0, 0, 1, w, 0];
    case 3:
      return [-1, 0, 0, -1, w, h];
    case 4:
      return [1, 0, 0, -1, 0, h];
    case 5:
      return [0, 1, 1, 0, 0, 0];
    case 6:
      return [0, 1, -1, 0, h, 0];
    case 7:
      return [0, -1, -1, 0, h, w];
    case 8:
      return [0, -1, 1, 0, 0, w];
    default:
      return [1, 0, 0, 1, 0, 0];
  }
}

/** A data URL's base64 (what the route takes), without its `data:…;base64,` prefix. */
export function base64OfDataUrl(dataUrl: string): string {
  const comma = dataUrl.indexOf(",");
  return comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
}
