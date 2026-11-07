#!/usr/bin/env node
// Cookpool's app icons (CP-23): the pot mark — the sidebar wordmark's
// CookingPot in white on herb green — drawn as SVG and rasterised to the PNGs
// the web app manifest names, with no dependencies (node's zlib and a CRC).
//
//   node scripts/gen-icons.mjs        writes public/icons/* and public/splash/*
//
// The PNGs are committed; run this again only when the mark changes.
//
//   icon.svg               the mark, any size (favicon)
//   icon-192.png, -512     "any": a rounded green square, pot at 56%
//   icon-maskable-512.png  "maskable": full-bleed green, pot inside the
//                          safe zone (the centre circle, 80% across)
//   apple-touch-icon.png   180px, full-bleed (iOS rounds it itself)
//   shortcut-*-96.png      PW-2: the manifest's shortcuts (Log a use, Bought
//                          food, Cook), each its + Add tile's icon and colours
//   badge-96.png           PW-6: a notification's small icon (Android's status
//                          bar): the pot alone, white on transparent
//   ../splash/iphone-*.png PW-2: iPhone splash screens, the "any" icon on
//                          the kitchen background, one per screen in
//                          src/lib/splash-screens.mjs

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";
import { IPHONE_SCREENS, SPLASH_ICON_CSS, splashFile } from "../src/lib/splash-screens.mjs";

const PUBLIC = join(dirname(fileURLToPath(import.meta.url)), "..", "public");
const OUT = join(PUBLIC, "icons");
const SPLASH_OUT = join(PUBLIC, "splash");

const GREEN = [0x1f, 0x7a, 0x4d]; // --primary in the kitchen palette (#1F7A4D)
const WHITE = [0xff, 0xff, 0xff];
const BACKGROUND = [0xf6, 0xf7, 0xf4]; // the kitchen page (#F6F7F4), the manifest's background_color

// lucide's cooking-pot (v0.460, ISC), on its 24-unit grid, stroked 2 wide with round caps and joins.
const POT_PATHS = [
  "M2 12h20",
  "M20 12v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-8",
  "m4 8 16-4",
  "m8.86 6.78-.45-1.81a2 2 0 0 1 1.45-2.43l1.94-.48a2 2 0 0 1 2.43 1.46l.45 1.8",
];
const STROKE = 2;

// ── The path, as line segments ───────────────────────────────────────

/** The commands lucide's icons use: M m L l H h V v A a C c Z z (an m's extra pairs are l). */
function polylines(d) {
  const tokens = d.match(/[MmLlHhVvAaCcZz]|-?(?:\d+\.?\d*|\.\d+)/g) ?? [];
  const lines = [];
  let line = null;
  let x = 0;
  let y = 0;
  let sx = 0; // the subpath's start, where Z returns
  let sy = 0;
  let cmd = "";
  let i = 0;
  const num = () => Number(tokens[i++]);
  const to = (nx, ny) => {
    line.push([nx, ny]);
    x = nx;
    y = ny;
  };
  while (i < tokens.length) {
    if (/[A-Za-z]/.test(tokens[i])) cmd = tokens[i++];
    switch (cmd) {
      case "M":
      case "m": {
        const nx = num() + (cmd === "m" ? x : 0);
        const ny = num() + (cmd === "m" ? y : 0);
        line = [[nx, ny]];
        lines.push(line);
        x = sx = nx;
        y = sy = ny;
        cmd = cmd === "m" ? "l" : "L";
        break;
      }
      case "Z":
      case "z":
        to(sx, sy);
        break;
      case "C":
      case "c": {
        const o = cmd === "c" ? [x, y] : [0, 0];
        const c1 = [num() + o[0], num() + o[1]];
        const c2 = [num() + o[0], num() + o[1]];
        const end = [num() + o[0], num() + o[1]];
        const [x0, y0] = [x, y];
        for (let s = 1; s <= 12; s++) {
          const t = s / 12;
          const u = 1 - t;
          to(
            u * u * u * x0 + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t * t * t * end[0],
            u * u * u * y0 + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t * t * t * end[1],
          );
        }
        break;
      }
      case "L":
        to(num(), num());
        break;
      case "l":
        to(x + num(), y + num());
        break;
      case "H":
        to(num(), y);
        break;
      case "h":
        to(x + num(), y);
        break;
      case "V":
        to(x, num());
        break;
      case "v":
        to(x, y + num());
        break;
      case "A":
      case "a": {
        const rx = num();
        const ry = num();
        const rot = num();
        const large = num();
        const sweep = num();
        const ex = num() + (cmd === "a" ? x : 0);
        const ey = num() + (cmd === "a" ? y : 0);
        for (const p of arcPoints(x, y, rx, ry, rot, large, sweep, ex, ey)) to(p[0], p[1]);
        break;
      }
      default:
        throw new Error(`unsupported path command ${cmd}`);
    }
  }
  return lines;
}

/** An SVG arc as points (the endpoint-to-centre conversion, SVG 1.1 F.6.5), rotation 0. */
function arcPoints(x1, y1, rx, ry, _rot, large, sweep, x2, y2, steps = 16) {
  const dx = (x1 - x2) / 2;
  const dy = (y1 - y2) / 2;
  let lambda = (dx * dx) / (rx * rx) + (dy * dy) / (ry * ry);
  if (lambda > 1) {
    rx *= Math.sqrt(lambda);
    ry *= Math.sqrt(lambda);
    lambda = 1;
  }
  const sign = large === sweep ? -1 : 1;
  const num = rx * rx * ry * ry - rx * rx * dy * dy - ry * ry * dx * dx;
  const coef = sign * Math.sqrt(Math.max(0, num / (rx * rx * dy * dy + ry * ry * dx * dx)));
  const cxp = (coef * rx * dy) / ry;
  const cyp = (-coef * ry * dx) / rx;
  const cx = cxp + (x1 + x2) / 2;
  const cy = cyp + (y1 + y2) / 2;
  const angle = (ux, uy, vx, vy) => {
    const a = Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
    return a;
  };
  const t1 = angle(1, 0, (dx - cxp) / rx, (dy - cyp) / ry);
  let dt = angle((dx - cxp) / rx, (dy - cyp) / ry, (-dx - cxp) / rx, (-dy - cyp) / ry);
  if (!sweep && dt > 0) dt -= 2 * Math.PI;
  if (sweep && dt < 0) dt += 2 * Math.PI;
  const out = [];
  for (let s = 1; s <= steps; s++) {
    const t = t1 + (dt * s) / steps;
    out.push([cx + rx * Math.cos(t), cy + ry * Math.sin(t)]);
  }
  out[out.length - 1] = [x2, y2];
  return out;
}

/** An icon's paths as line segments, in its 24-unit grid. */
const segmentsOf = (paths) => paths.flatMap(polylines).flatMap((line) => line.slice(1).map((p, k) => [line[k], p]));
const SEGMENTS = segmentsOf(POT_PATHS);

function distToSegment(px, py, [[ax, ay], [bx, by]]) {
  const vx = bx - ax;
  const vy = by - ay;
  const len2 = vx * vx + vy * vy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * vx + (py - ay) * vy) / len2));
  return Math.hypot(px - ax - t * vx, py - ay - t * vy);
}

// ── Drawing ──────────────────────────────────────────────────────────

/** Coverage of a shape with signed distance `d` (negative inside) at pixel size `px`. */
const cover = (d, px) => Math.max(0, Math.min(1, 0.5 - d / px));

/** Signed distance to a rounded square of half-size `h` and corner radius `r`, centred at 0. */
function roundedSquare(x, y, h, r) {
  const qx = Math.abs(x) - (h - r);
  const qy = Math.abs(y) - (h - r);
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
}

/**
 * One icon, `size` pixels square: a green square (corner radius `radius` as a
 * share of the size; 0 is full bleed) with the pot `pot` of the size across,
 * centred. RGBA rows.
 */
function draw(size, { radius, pot, bg: fill = GREEN, ink: stroke = WHITE, segments = SEGMENTS }) {
  const rgba = Buffer.alloc(size * size * 4);
  const scale = (pot * size) / 24; // pixels per pot unit
  const half = size / 2;
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const x = px + 0.5 - half;
      const y = py + 0.5 - half;
      const bg = radius === 0 ? 1 : cover(roundedSquare(x, y, half, radius * size), 1);
      // The pot's own grid, centred on (12, 12).
      const ux = x / scale + 12;
      const uy = y / scale + 12;
      let d = Infinity;
      for (const s of segments) d = Math.min(d, distToSegment(ux, uy, s));
      const ink = cover(d - STROKE / 2, 1 / scale) * bg;
      const o = (py * size + px) * 4;
      for (let c = 0; c < 3; c++) rgba[o + c] = Math.round(stroke[c] * ink + fill[c] * (1 - ink));
      rgba[o + 3] = Math.round(255 * bg);
    }
  }
  return rgba;
}

/**
 * A notification badge, `size` pixels square: the pot `pot` of the size
 * across, white, on transparent (Android draws only its alpha). RGBA rows.
 */
function drawBadge(size, pot) {
  const rgba = Buffer.alloc(size * size * 4);
  const scale = (pot * size) / 24;
  const half = size / 2;
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const ux = (px + 0.5 - half) / scale + 12;
      const uy = (py + 0.5 - half) / scale + 12;
      let d = Infinity;
      for (const s of SEGMENTS) d = Math.min(d, distToSegment(ux, uy, s));
      const o = (py * size + px) * 4;
      rgba.fill(255, o, o + 3);
      rgba[o + 3] = Math.round(255 * cover(d - STROKE / 2, 1 / scale));
    }
  }
  return rgba;
}

// ── PNG ──────────────────────────────────────────────────────────────

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function png(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const rows = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    rows[y * (size * 4 + 1)] = 0; // filter: none
    rgba.copy(rows, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(rows, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/**
 * An opaque image, `width` × `height`, from a function giving each row's RGB
 * pixels, stored with a palette (a splash screen has under 256 colours: the
 * background, the icon and its anti-aliased edges). A row the same as the one
 * above is stored as "up" (all zeros), so a flat background costs almost
 * nothing: a splash screen is a few kilobytes.
 */
function pngIndexed(width, height, rowAt) {
  const rows = Array.from({ length: height }, (_, y) => rowAt(y));
  const palette = new Map(); // 0xRRGGBB → index
  for (const row of new Set(rows)) {
    for (let i = 0; i < row.length; i += 3) {
      const rgb = row.readUIntBE(i, 3);
      if (!palette.has(rgb)) palette.set(rgb, palette.size);
    }
  }
  if (palette.size > 256) throw new Error(`${palette.size} colours: too many for a palette`);
  const plte = Buffer.alloc(palette.size * 3);
  for (const [rgb, i] of palette) plte.writeUIntBE(rgb, i * 3, 3);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 3; // indexed colour
  const stride = width + 1;
  const data = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y++) {
    const o = y * stride;
    if (y > 0 && rows[y].equals(rows[y - 1])) {
      data[o] = 2; // up: every byte is 0
      continue;
    }
    data[o] = 0; // none
    for (let x = 0; x < width; x++) data[o + 1 + x] = palette.get(rows[y].readUIntBE(x * 3, 3));
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("PLTE", plte),
    chunk("IDAT", deflateSync(data, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// ── The files ────────────────────────────────────────────────────────

const ANY = { radius: 0.22, pot: 0.56 };
const MASKABLE = { radius: 0, pot: 0.44 };
const APPLE = { radius: 0, pot: 0.56 };

function svg({ radius, pot }) {
  const s = 24 / pot; // the square, in pot units
  const off = (s - 24) / 2;
  const r = radius * s;
  const paths = POT_PATHS.map((d) => `<path d="${d}"/>`).join("");
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${-off} ${-off} ${s} ${s}">` +
    `<rect x="${-off}" y="${-off}" width="${s}" height="${s}" rx="${r}" fill="#1F7A4D"/>` +
    `<g fill="none" stroke="#FFFFFF" stroke-width="${STROKE}" stroke-linecap="round" stroke-linejoin="round">${paths}</g>` +
    `</svg>\n`
  );
}

// PW-2: the shortcut icons (long-press the app icon), each its + Add tile's
// lucide icon in the tile's colours (add-sheet.tsx TILE_TONES). Full bleed
// with the glyph at half the size, inside the maskable safe zone, so the one
// file serves as "any maskable".
const UTENSILS = [
  "M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2",
  "M7 2v20",
  "M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3Zm0 0v7",
];
const SHOPPING_BASKET = [
  "m15 11-1 9",
  "m19 11-4-7",
  "M2 11h20",
  "m3.5 11 1.6 7.4a2 2 0 0 0 2 1.6h9.8a2 2 0 0 0 2-1.6l1.7-7.4",
  "M4.5 15.5h15",
  "m5 11 4-7",
  "m9 11 1 9",
];
const SHORTCUTS = [
  ["use", UTENSILS, [0xe4, 0xf2, 0xea], GREEN], // herb tint, #1F7A4D
  ["bought", SHOPPING_BASKET, [0xff, 0xf0, 0xc7], [0x7a, 0x4e, 0x00]], // soon tint, #7A4E00
  ["cook", POT_PATHS, [0xfc, 0xeb, 0xe0], [0xc2, 0x41, 0x0c]], // tomato tint, #C2410C
];

/**
 * PW-2: an iPhone splash screen — the "any" icon, `SPLASH_ICON_CSS` across
 * at the screen's ratio, centred on the kitchen background.
 */
function splash(screen) {
  const { width, height } = splashFile(screen);
  const size = Math.round(SPLASH_ICON_CSS * screen.ratio);
  const icon = draw(size, ANY);
  const left = Math.round((width - size) / 2);
  const top = Math.round((height - size) / 2);
  const plain = Buffer.alloc(width * 3);
  for (let x = 0; x < width; x++) plain.set(BACKGROUND, x * 3);
  return pngIndexed(width, height, (y) => {
    if (y < top || y >= top + size) return plain;
    const row = Buffer.from(plain);
    for (let x = 0; x < size; x++) {
      const o = ((y - top) * size + x) * 4;
      const a = icon[o + 3] / 255;
      for (let c = 0; c < 3; c++) row[(left + x) * 3 + c] = Math.round(icon[o + c] * a + BACKGROUND[c] * (1 - a));
    }
    return row;
  });
}

mkdirSync(OUT, { recursive: true });
mkdirSync(SPLASH_OUT, { recursive: true });
const files = [
  ["icon-192.png", png(192, draw(192, ANY))],
  ["icon-512.png", png(512, draw(512, ANY))],
  ["icon-maskable-512.png", png(512, draw(512, MASKABLE))],
  ["apple-touch-icon.png", png(180, draw(180, APPLE))],
  ["icon.svg", Buffer.from(svg(ANY))],
  ["badge-96.png", png(96, drawBadge(96, 0.8))],
  ...SHORTCUTS.map(([name, paths, bg, ink]) => [
    `shortcut-${name}-96.png`,
    png(96, draw(96, { radius: 0, pot: 0.5, bg, ink, segments: segmentsOf(paths) })),
  ]),
];
for (const [name, data] of files) {
  writeFileSync(join(OUT, name), data);
  console.log(`wrote public/icons/${name} (${data.length} bytes)`);
}
let splashBytes = 0;
for (const screen of IPHONE_SCREENS) {
  const data = splash(screen);
  const name = splashFile(screen).src.slice("/splash/".length);
  writeFileSync(join(SPLASH_OUT, name), data);
  splashBytes += data.length;
  console.log(`wrote public/splash/${name} (${data.length} bytes) for ${screen.phones}`);
}
console.log(`splash screens: ${IPHONE_SCREENS.length} files, ${splashBytes} bytes in all`);
