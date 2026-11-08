// Receipts (cookpool-ai AI-3): photos and scripted model reads for the
// receipt tests. The photos are a few real header bytes (JPEG, WebP, PNG)
// and filler — the worker sniffs the type from the bytes and never decodes
// the rest; the model is a stub.

import type { AiReceiptResponse } from "@saas/contracts/kitchen";
import { answer, me, RAHUL, type AiWorld, type Result } from "./ai-helpers.js";

export const RECEIPT = me("ai/receipt");

const JPEG_HEAD = [0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01];
const PNG_HEAD = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d];
const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));
const WEBP_HEAD = [...ascii("RIFF"), 0x24, 0x00, 0x00, 0x00, ...ascii("WEBPVP8 ")];

/** A photo of `bytes` bytes starting with `head`, in base64. */
function photo(head: number[], bytes: number, fill = 0x5a): string {
  const buffer = Buffer.alloc(bytes, fill);
  Buffer.from(head).copy(buffer);
  return buffer.toString("base64");
}

export const jpeg = (bytes = 3000) => photo(JPEG_HEAD, bytes);
export const webp = (bytes = 3000) => photo(WEBP_HEAD, bytes);
export const png = (bytes = 3000) => photo(PNG_HEAD, bytes);

/** One line as the model reads it. */
export interface ModelLine {
  text: string;
  name: string | null;
  quantity: number | null;
  unit: string | null;
  priceMinor: number;
  isFood: boolean;
}

/** A line: food, with a name, an amount and a price unless said otherwise. */
export const line = (text: string, name: string | null, quantity: number | null, unit: string | null, priceMinor: number, isFood = true): ModelLine => ({
  text,
  name,
  quantity,
  unit,
  priceMinor,
  isFood,
});

export interface ModelRead {
  store?: string | null;
  date?: string | null;
  time?: string | null;
  total?: number | null;
  lines: ModelLine[];
  adjustments?: Array<{ text: string; amountMinor: number }>;
}

/** The model's answer for a receipt. */
export function read(r: ModelRead, opts: { model?: string } = {}) {
  return answer(
    {
      store: r.store ?? null,
      date: r.date ?? null,
      time: r.time ?? null,
      total: r.total ?? null,
      lines: r.lines,
      adjustments: r.adjustments ?? [],
    },
    opts,
  );
}

/** Post `image` as RAHUL. */
export function post(w: AiWorld, image: unknown, as = RAHUL): Promise<Result<AiReceiptResponse>> {
  return w.call<AiReceiptResponse>("POST", RECEIPT, as, { image });
}

/** Read one receipt the model is scripted to read as `r`; 200 expected. */
export async function scan(w: AiWorld, r: ModelRead): Promise<AiReceiptResponse> {
  w.ai.script.push(read(r));
  const res = await post(w, jpeg());
  if (res.status !== 200) throw new Error(`expected 200, got ${res.status}: ${JSON.stringify(res.body)}`);
  return res.body.data;
}
