// NO SIGNAL, CLEAN UPDATES (Cookpool PW-4): what the service worker of one
// build copies before it takes over — the build's whole shell, so the app
// opens with no signal:
//
// - each Cookpool page served as a file (SM-2), at the address it is served
//   on (`/home`, `/dishes/_`, `/` …), and its client-navigation payload
//   (`/_rsc/home.rsc`); not the OAuth return (`/auth/callback`);
// - every file the build emitted under `/_next/static/` (hashed: scripts,
//   styles, fonts) and every icon (`/icons/*`).
//
// The manifest is not here: it is the Worker's route, rendered per deploy,
// and goes to the network only (routes.mjs).
//
// Pure (a list of asset paths in, a list of URLs out), so it is tested on a
// fake tree; scripts/service-worker.mjs walks the real one.

import { STATIC_PAGES, htmlFile, prerenderedRoute, rscFile } from "../lib/static-pages.mjs";
import { UNCACHED_PAGES } from "./routes.mjs";

/**
 * The precache for a build, from the files in its `.open-next/assets`
 * (`/home.html`, `/_rsc/home.rsc`, `/_next/static/chunks/…`, as paths from
 * that directory). Throws when a page's HTML or payload is missing: a
 * worker that cannot open a page offline is not worth installing.
 */
export function precacheUrls(files, pages = STATIC_PAGES) {
  const have = new Set(files);
  const out = [];
  for (const pattern of pages) {
    if (UNCACHED_PAGES.includes(pattern)) continue;
    for (const file of [htmlFile(pattern), rscFile(pattern)]) {
      if (!have.has(file)) throw new Error(`${file} (${pattern}) is not in the assets: run scripts/pages-as-files.mjs first`);
    }
    out.push(prerenderedRoute(pattern), rscFile(pattern));
  }
  const built = [...have].filter((f) => f.startsWith("/_next/static/") || f.startsWith("/icons/")).sort();
  return [...out, ...built];
}

/** The precached files that are pages or payloads: each names the build it belongs to. */
export function namesItsBuild(url) {
  return !url.startsWith("/_next/static/") && !url.startsWith("/icons/");
}
