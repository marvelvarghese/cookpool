import { AI_RECEIPT_MAX_BYTES, type AiReceiptImageType } from "@saas/contracts/kitchen";

// A photo sent to an AI route (Cookpool AI: AI-3's receipts, AI-4's recipes):
// base64, a JPEG or WebP by its bytes, at most 1.5 MB decoded. Only its first
// bytes are ever decoded here; the rest is passed to the model as given and
// dropped with the request. A photo is never stored or logged.

export type Photo = { ok: true; image: string; mediaType: AiReceiptImageType } | { ok: false; errors: string[] };

/** The first bytes of a base64 string (at most 12), decoded. */
function headBytes(base64: string): Uint8Array {
  const head = atob(base64.slice(0, 16));
  return Uint8Array.from(head, (c) => c.charCodeAt(0));
}

/**
 * Read the photo from the body: base64 (a `data:…;base64,` prefix and
 * whitespace are dropped), a JPEG or WebP by its bytes, at most `maxBytes`
 * decoded (default AI_RECEIPT_MAX_BYTES). Only its first bytes are decoded.
 */
export function readPhoto(raw: unknown, maxBytes = AI_RECEIPT_MAX_BYTES): Photo {
  if (typeof raw !== "string" || raw.trim() === "") return { ok: false, errors: ["Must be a photo, in base64"] };
  const image = raw.replace(/^data:[^,]{0,100};base64,/, "").replace(/\s+/g, "");
  if (image.length < 16 || image.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(image)) {
    return { ok: false, errors: ["Must be a JPEG or WebP photo, in base64"] };
  }
  const padding = image.endsWith("==") ? 2 : image.endsWith("=") ? 1 : 0;
  const bytes = (image.length / 4) * 3 - padding;
  if (bytes > maxBytes) return { ok: false, errors: ["Must be at most 1.5 MB"] };
  const head = headBytes(image);
  const ascii = (from: number, to: number) => String.fromCharCode(...head.slice(from, to));
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return { ok: true, image, mediaType: "image/jpeg" };
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return { ok: true, image, mediaType: "image/webp" };
  return { ok: false, errors: ["Must be a JPEG or WebP photo, in base64"] };
}
