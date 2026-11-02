#!/usr/bin/env node
// Cookpool's app icons (CP-23): the pot mark — the sidebar wordmark's
// CookingPot in white on herb green — drawn as SVG and rasterised to the PNGs
// the web app manifest names, with no dependencies (node's zlib and a CRC).
//
//   node scripts/gen-icons.mjs        writes public/icons/*
//
// The PNGs are committed; run this again only when the mark changes.
//
//   icon.svg               the mark, any size (favicon)
//   icon-192.png, -512     "any": a rounded green square, pot at 56%
//   icon-maskable-512.png  "maskable": full-bleed green, pot inside the
//                          safe zone (the centre circle, 80% across)
//   apple-touch-icon.png   180px, full-bleed (iOS rounds it itself)

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "icons");

const GREEN = [0x1f, 0x7a, 0x4d]; // --primary in the kitchen palette (#1F7A4D)
const WHITE = [0xff, 0xff, 0xff];

// lucide's cooking-pot (v0.460, ISC), on its 24-unit grid, stroked 2 wide with round caps and joins.
const POT_PATHS = [
  "M2 12h20",
  "M20 12v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-8",
  "m4 8 16-4",
  "m8.86 6.78-.45-1.81a2 2 0 0 1 1.45-2.43l1.94-.48a2 2 0 0 1 2.43 1.46l.45 1.8",
];
const STROKE = 2;

// ── The path, as line segments ───────────────────────────────────────

/** The commands lucide's pot uses: M m L l H h V v A a (an m's extra pairs are l). */
function polylines(d) {
  const tokens = d.match(/[MmLlHhVvAa]|-?(?:\d+\.?\d*|\.\d+)/g) ?? [];
  const lines = [];
  let line = null;
  let x = 0;
  let y = 0;
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
        x = nx;
        y = ny;
        cmd = cmd === "m" ? "l" : "L";
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

const SEGMENTS = POT_PATHS.flatMap(polylines).flatMap((line) => line.slice(1).map((p, k) => [line[k], p]));

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
function draw(size, { radius, pot }) {
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
      for (const s of SEGMENTS) d = Math.min(d, distToSegment(ux, uy, s));
      const ink = cover(d - STROKE / 2, 1 / scale) * bg;
      const o = (py * size + px) * 4;
      for (let c = 0; c < 3; c++) rgba[o + c] = Math.round(WHITE[c] * ink + GREEN[c] * (1 - ink));
      rgba[o + 3] = Math.round(255 * bg);
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

mkdirSync(OUT, { recursive: true });
const files = [
  ["icon-192.png", png(192, draw(192, ANY))],
  ["icon-512.png", png(512, draw(512, ANY))],
  ["icon-maskable-512.png", png(512, draw(512, MASKABLE))],
  ["apple-touch-icon.png", png(180, draw(180, APPLE))],
  ["icon.svg", Buffer.from(svg(ANY))],
];
for (const [name, data] of files) {
  writeFileSync(join(OUT, name), data);
  console.log(`wrote public/icons/${name} (${data.length} bytes)`);
}
