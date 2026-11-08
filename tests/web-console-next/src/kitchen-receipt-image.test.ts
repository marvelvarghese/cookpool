import {
  RECEIPT_LONG_SIDE,
  RECEIPT_MAX_BASE64,
  RECEIPT_MIN_LONG_SIDE,
  RECEIPT_QUALITIES,
  base64Length,
  base64OfDataUrl,
  decoderTurned,
  encodeAttempts,
  firstThatFits,
  fitLongSide,
  fitsReceiptLimit,
  orientationTransform,
  orientedSize,
  readJpegMeta,
  type EncodeAttempt,
} from "@web-console-next/components/kitchen/receipt-image";

// cookpool-ai AI-8: shrinking a receipt photo before it is sent — 1200 px on
// the long side, JPEG at 0.8 stepping down to stay ≤ 1.5 MB, turned the way
// its EXIF says.

/** A minimal JPEG header: SOI, an optional EXIF APP1 with one orientation entry, and a frame header. */
function jpeg(o: { width: number; height: number; orientation?: number; order?: "II" | "MM"; frame?: number; padding?: boolean }): Uint8Array {
  const out: number[] = [0xff, 0xd8];
  const u16 = (v: number, little: boolean) => (little ? [v & 0xff, v >> 8] : [v >> 8, v & 0xff]);
  const u32 = (v: number, little: boolean) => (little ? [v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, v >>> 24] : [v >>> 24, (v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff]);
  if (o.padding) out.push(0xff, 0xe0, 0x00, 0x04, 0x4a, 0x46); // a short APP0 before EXIF
  if (o.orientation !== undefined) {
    const little = (o.order ?? "II") === "II";
    const tiff = [
      ...(little ? [0x49, 0x49] : [0x4d, 0x4d]),
      ...u16(42, little),
      ...u32(8, little),
      ...u16(1, little),
      ...u16(0x0112, little),
      ...u16(3, little),
      ...u32(1, little),
      ...u16(o.orientation, little),
      0,
      0,
      ...u32(0, little),
    ];
    const body = [0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff];
    out.push(0xff, 0xe1, ...u16(body.length + 2, false), ...body);
  }
  const sof = [8, ...u16(o.height, false), ...u16(o.width, false), 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1];
  out.push(0xff, o.frame ?? 0xc0, ...u16(sof.length + 2, false), ...sof);
  out.push(0xff, 0xda, 0x00, 0x02);
  return new Uint8Array(out);
}

describe("the long side and the turn", () => {
  it("fits the long side to 1200 px and never enlarges", () => {
    expect(RECEIPT_LONG_SIDE).toBe(1200);
    expect(fitLongSide({ width: 3024, height: 4032 })).toEqual({ width: 900, height: 1200 });
    expect(fitLongSide({ width: 4000, height: 3000 })).toEqual({ width: 1200, height: 900 });
    expect(fitLongSide({ width: 4032, height: 1000 })).toEqual({ width: 1200, height: 298 });
    expect(fitLongSide({ width: 800, height: 600 })).toEqual({ width: 800, height: 600 });
    expect(fitLongSide({ width: 1200, height: 1200 })).toEqual({ width: 1200, height: 1200 });
    expect(fitLongSide({ width: 9000, height: 3 })).toEqual({ width: 1200, height: 1 });
  });

  it("swaps width and height for a quarter turn (EXIF 5–8) only", () => {
    const stored = { width: 4032, height: 3024 };
    for (const o of [1, 2, 3, 4]) expect(orientedSize(stored, o)).toEqual(stored);
    for (const o of [5, 6, 7, 8]) expect(orientedSize(stored, o)).toEqual({ width: 3024, height: 4032 });
    // A phone's portrait photo, stored landscape with orientation 6, goes out 900 × 1200.
    expect(fitLongSide(orientedSize(stored, 6))).toEqual({ width: 900, height: 1200 });
  });

  it("draws each orientation inside the turned canvas", () => {
    const drawn = { width: 40, height: 30 };
    for (let o = 1; o <= 8; o++) {
      const [a, b, c, d, e, f] = orientationTransform(o, drawn);
      const canvas = orientedSize(drawn, o);
      const corners = [
        [0, 0],
        [drawn.width, 0],
        [0, drawn.height],
        [drawn.width, drawn.height],
      ].map(([x, y]) => [a * x! + c * y! + e, b * x! + d * y! + f]);
      const xs = corners.map((p) => p[0]!).sort((p, q) => p - q);
      const ys = corners.map((p) => p[1]!).sort((p, q) => p - q);
      expect([xs[0], xs[3], ys[0], ys[3]]).toEqual([0, canvas.width, 0, canvas.height]);
    }
    // 6 (rotate 90° clockwise): the stored top-left lands top-right.
    const [a, b, c, d, e, f] = orientationTransform(6, drawn);
    expect([a * 0 + c * 0 + e, b * 0 + d * 0 + f]).toEqual([30, 0]);
    expect(orientationTransform(1, drawn)).toEqual([1, 0, 0, 1, 0, 0]);
  });
});

describe("EXIF orientation", () => {
  it("reads the stored size and orientation from the JPEG header", () => {
    expect(readJpegMeta(jpeg({ width: 4032, height: 3024, orientation: 6 }))).toEqual({ width: 4032, height: 3024, orientation: 6 });
    expect(readJpegMeta(jpeg({ width: 4032, height: 3024, orientation: 8, order: "MM" }))).toEqual({ width: 4032, height: 3024, orientation: 8 });
    expect(readJpegMeta(jpeg({ width: 640, height: 480, orientation: 3, padding: true }))).toEqual({ width: 640, height: 480, orientation: 3 });
    expect(readJpegMeta(jpeg({ width: 640, height: 480 }))).toEqual({ width: 640, height: 480, orientation: 1 });
    // A progressive frame (SOF2) reads the same.
    expect(readJpegMeta(jpeg({ width: 1000, height: 2000, orientation: 1, frame: 0xc2 }))).toEqual({ width: 1000, height: 2000, orientation: 1 });
  });

  it("reads an odd orientation as 1, and anything not a JPEG as null", () => {
    expect(readJpegMeta(jpeg({ width: 10, height: 20, orientation: 9 }))?.orientation).toBe(1);
    expect(readJpegMeta(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBeNull();
    expect(readJpegMeta(new Uint8Array([0xff, 0xd8, 0xff, 0xda, 0, 2]))).toBeNull();
    expect(readJpegMeta(new Uint8Array([]))).toBeNull();
  });

  it("turns the photo only when the decoder visibly didn't", () => {
    const meta = { width: 4032, height: 3024, orientation: 6 };
    // Decoded turned (portrait): the browser did it.
    expect(decoderTurned(meta, { width: 3024, height: 4032 })).toBe(true);
    // Decoded at the stored size: the canvas turns it.
    expect(decoderTurned(meta, { width: 4032, height: 3024 })).toBe(false);
    // Nothing to turn, a half turn (size can't tell; browsers apply it), a square, or no EXIF.
    expect(decoderTurned({ ...meta, orientation: 1 }, { width: 4032, height: 3024 })).toBe(true);
    expect(decoderTurned({ ...meta, orientation: 3 }, { width: 4032, height: 3024 })).toBe(true);
    expect(decoderTurned({ width: 2000, height: 2000, orientation: 6 }, { width: 2000, height: 2000 })).toBe(true);
    expect(decoderTurned(null, { width: 10, height: 10 })).toBe(true);
  });
});

describe("staying within 1.5 MB", () => {
  it("measures the base64, as the route takes it", () => {
    expect(RECEIPT_MAX_BASE64).toBe(1_500_000);
    expect(base64Length(3)).toBe(4);
    expect(base64Length(4)).toBe(8);
    expect(fitsReceiptLimit(1_125_000)).toBe(true);
    expect(fitsReceiptLimit(1_125_001)).toBe(false);
    expect(base64OfDataUrl("data:image/jpeg;base64,/9j/4AAQ")).toBe("/9j/4AAQ");
    expect(base64OfDataUrl("/9j/4AAQ")).toBe("/9j/4AAQ");
  });

  it("tries 0.8 first, then lower qualities, then a smaller size, down to 600 px", () => {
    expect(RECEIPT_QUALITIES[0]).toBe(0.8);
    const attempts = encodeAttempts({ width: 3024, height: 4032 });
    expect(attempts[0]).toEqual({ width: 900, height: 1200, quality: 0.8 });
    expect(attempts.slice(0, RECEIPT_QUALITIES.length).map((a) => a.quality)).toEqual([0.8, 0.7, 0.6, 0.5]);
    const longs = [...new Set(attempts.map((a) => Math.max(a.width, a.height)))];
    expect(longs).toEqual([1200, 960, 768, 614]);
    expect(Math.min(...longs)).toBeGreaterThanOrEqual(RECEIPT_MIN_LONG_SIDE);
    // A photo already small is sent at its own size, the qualities only.
    expect(encodeAttempts({ width: 500, height: 400 })).toEqual(RECEIPT_QUALITIES.map((quality) => ({ width: 500, height: 400, quality })));
  });

  it("keeps the first encoding that fits", async () => {
    // A busy receipt: 2 MB at 0.8, 1.4 MB at 0.7, 1 MB at 0.6.
    const sizes: Record<number, number> = { 0.8: 2_000_000, 0.7: 1_400_000, 0.6: 1_000_000, 0.5: 800_000 };
    const tried: EncodeAttempt[] = [];
    const fit = await firstThatFits(encodeAttempts({ width: 4000, height: 3000 }), async (a) => {
      tried.push(a);
      return { size: sizes[a.quality]! };
    });
    expect(fit?.attempt).toEqual({ width: 1200, height: 900, quality: 0.6 });
    expect(tried.map((a) => a.quality)).toEqual([0.8, 0.7, 0.6]);

    // The common case: 0.8 at 1200 px fits at once.
    const easy = await firstThatFits(encodeAttempts({ width: 4000, height: 3000 }), async () => ({ size: 240_000 }));
    expect(easy?.attempt.quality).toBe(0.8);

    // Too big at every quality at 1200 px: the size steps down.
    const shrunk = await firstThatFits(encodeAttempts({ width: 4000, height: 3000 }), async (a) => ({ size: a.width >= 1200 ? 3_000_000 : 900_000 }));
    expect(shrunk?.attempt).toEqual({ width: 960, height: 720, quality: 0.8 });

    // Never small enough, or the browser can't encode: null.
    expect(await firstThatFits(encodeAttempts({ width: 4000, height: 3000 }), async () => ({ size: 5_000_000 }))).toBeNull();
    expect(await firstThatFits(encodeAttempts({ width: 4000, height: 3000 }), async () => null)).toBeNull();
  });
});
