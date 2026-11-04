#!/usr/bin/env node
// PAGES ARE FILES (Cookpool SM-2): the build's last step, after `next build`
// and `opennextjs-cloudflare build`.
//
// OpenNext serves a prerendered page from the Worker, and the Worker is what
// was slow (a 16 MB bundle: every cold isolate costs a second or more). This
// copies each page in src/lib/static-pages.mjs from Next's prerender output
// into the static assets, where Workers Static Assets answers it with no
// Worker at all:
//
//   .next/server/app/home.html  → .open-next/assets/home.html       (/home)
//   .next/server/app/home.rsc   → .open-next/assets/_rsc/home.rsc   (its client navigations)
//   .next/server/app/dishes/_.* → the same, for /dishes/_
//
// and writes `_redirects`, which serves `/dishes/_` for every `/dishes/<id>`.
// A page in the table that the build did not prerender (it went dynamic)
// fails the build: it would otherwise silently fall back to the Worker.
//
//   node scripts/pages-as-files.mjs [--app <dir>]     (default: this app)
//
// Node, no dependencies.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { STATIC_PAGES, htmlFile, prerenderedRoute, redirectRules, rscFile } from "../src/lib/static-pages.mjs";

const REDIRECTS_HEADER = [
  "# Written by scripts/pages-as-files.mjs (Cookpool SM-2): every value of a",
  "# dynamic segment serves the page prerendered for `_`; the address stays.",
];

function fail(message) {
  console.error(`✕ pages-as-files: ${message}`);
  process.exit(1);
}

/** The files to copy for each page: [from (in .next/server/app), to (in the assets)]. */
export function pageFiles(pages = STATIC_PAGES) {
  return pages.flatMap((pattern) => {
    const route = prerenderedRoute(pattern);
    const base = route === "/" ? "/index" : route;
    return [
      [`${base}.html`, htmlFile(pattern)],
      [`${base}.rsc`, rscFile(pattern)],
    ];
  });
}

/** The `_redirects` file's text. */
export function redirectsFile(pages = STATIC_PAGES) {
  return [...REDIRECTS_HEADER, ...redirectRules(pages)].join("\n") + "\n";
}

function run(app) {
  const server = path.join(app, ".next", "server", "app");
  const assets = path.join(app, ".open-next", "assets");
  if (!fs.existsSync(assets)) fail(`${assets} is missing: run the OpenNext build first`);
  const manifest = JSON.parse(fs.readFileSync(path.join(app, ".next", "prerender-manifest.json"), "utf8"));
  for (const pattern of STATIC_PAGES) {
    const route = prerenderedRoute(pattern);
    if (!manifest.routes?.[route]) fail(`${route} (${pattern}) was not prerendered: it became a dynamic route`);
    const meta = path.join(server, `${route === "/" ? "/index" : route}.meta`);
    const status = fs.existsSync(meta) ? JSON.parse(fs.readFileSync(meta, "utf8")).status : undefined;
    if (status !== undefined && status !== 200) fail(`${route} prerendered with status ${status}`);
  }
  for (const [from, to] of pageFiles()) {
    const src = path.join(server, from);
    if (!fs.existsSync(src)) fail(`${src} is missing`);
    const dest = path.join(assets, to);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
  }
  const redirects = path.join(assets, "_redirects");
  // public/_redirects would land here too; there is none, and merging two
  // rule sets (first match wins) is a decision, not a concatenation.
  if (fs.existsSync(redirects) && !fs.readFileSync(redirects, "utf8").startsWith(REDIRECTS_HEADER[0])) {
    fail(`${redirects} already exists (public/_redirects?): merge its rules into this script`);
  }
  fs.writeFileSync(redirects, redirectsFile());
  console.log(`✓ pages-as-files: ${STATIC_PAGES.length} pages served as files, ${redirectRules().length} _redirects rules`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const i = process.argv.indexOf("--app");
  run(path.resolve(i >= 0 ? process.argv[i + 1] : path.join(path.dirname(fileURLToPath(import.meta.url)), "..")));
}
