#!/usr/bin/env node
// NO SIGNAL, CLEAN UPDATES (Cookpool PW-4): the build's last step, after
// scripts/pages-as-files.mjs. Writes `.open-next/assets/sw.js`, Cookpool's
// own service worker (no Workbox), for THIS build:
//
// - its precache list (src/service-worker/precache.mjs): the pages served as
//   files and their payloads, every `/_next/static/**` file the build
//   emitted, the icons;
// - its caches named for the build id (`.next/BUILD_ID`);
// - the worker's code: src/lib/static-pages.mjs and src/service-worker/*.mjs,
//   bundled here into one classic script (each module in its own scope; the
//   modules may only `import { … } from "./x.mjs"` each other and
//   `export function|const|let|class`). No bundler, no dependencies.
//
// `public/_headers` serves `/sw.js` with `Cache-Control: no-cache`; it sits
// at the root, so its scope is `/` with no `Service-Worker-Allowed`; no
// `_redirects` rule and no `run_worker_first` path takes it.
//
// With src/service-worker/switch.mjs at "off" it writes the KILL SWITCH
// instead: a worker that replaces any installed one, deletes every Cookpool
// cache, unregisters and reloads the pages it controlled (docs/runbook.md).
//
// The build fails if a page or payload does not name the build id, or if a
// page is missing (pages-as-files did not run).
//
//   node scripts/service-worker.mjs [--app <dir>]     (default: this app)

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { namesItsBuild, precacheUrls } from "../src/service-worker/precache.mjs";
import { SERVICE_WORKER } from "../src/service-worker/switch.mjs";

/** The worker's modules, in order (each may import only from those before it), relative to the app. */
export const WORKER_MODULES = Object.freeze([
  "src/lib/static-pages.mjs",
  "src/service-worker/protocol.mjs",
  "src/service-worker/routes.mjs",
  "src/service-worker/precache.mjs",
  "src/service-worker/runtime.mjs",
]);

function fail(message) {
  console.error(`✕ service-worker: ${message}`);
  process.exit(1);
}

/** Every file under `dir`, as `/a/b.js` paths. */
export function assetFiles(dir) {
  const out = [];
  const walk = (rel) => {
    for (const entry of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
      const next = `${rel}/${entry.name}`;
      if (entry.isDirectory()) walk(next);
      else if (entry.isFile()) out.push(next);
    }
  };
  walk("");
  return out.sort();
}

/** The precache for the build in `assets` (an `.open-next/assets` directory). */
export function precacheFor(assets) {
  return precacheUrls(assetFiles(assets));
}

const IMPORT_RE = /^import\s*\{([^}]*)\}\s*from\s*"([^"]+)";?[ \t]*$/gm;
const EXPORT_RE = /^export\s+(?:async\s+)?(?:function\*?|const|let|class)\s+([A-Za-z_$][\w$]*)/gm;

/**
 * One classic script from ES modules `[{ id, code }]` (ids are app-relative
 * paths): each module in its own function scope, its imports read from the
 * modules before it.
 */
export function bundleModules(modules) {
  const varOf = (id) => `__${id.replace(/[^A-Za-z0-9]/g, "_")}`;
  const ids = new Set();
  return modules
    .map(({ id, code }) => {
      const exported = [...code.matchAll(EXPORT_RE)].map((m) => m[1]);
      let body = code.replace(IMPORT_RE, (_line, names, from) => {
        const target = path.posix.normalize(path.posix.join(path.posix.dirname(id), from));
        if (!ids.has(target)) throw new Error(`${id} imports ${from}, which is not bundled before it`);
        return `const {${names.replace(/\s+as\s+/g, ": ")}} = ${varOf(target)};`;
      });
      body = body.replace(/^export\s+(?=(?:async\s+)?(?:function|const|let|class)\b)/gm, "");
      if (/^\s*(?:import|export)\b/m.test(body)) {
        throw new Error(`${id}: the worker's modules may only use "import { … } from" and "export function|const|let|class"`);
      }
      ids.add(id);
      return `const ${varOf(id)} = (() => {\n${body}\nreturn { ${exported.join(", ")} };\n})();`;
    })
    .join("\n\n");
}

/** The real worker for `buildId`. */
export function workerSource({ buildId, precache, modules }) {
  const runtime = `__${"src/service-worker/runtime.mjs".replace(/[^A-Za-z0-9]/g, "_")}`;
  return `// Cookpool's service worker for build ${buildId} (Cookpool PW-4).
// Written by scripts/service-worker.mjs from src/service-worker/*.mjs; do not edit.
(() => {
"use strict";
${bundleModules(modules)}

const sw = ${runtime}.createServiceWorker({
  buildId: ${JSON.stringify(buildId)},
  precache: ${JSON.stringify(precache)},
  origin: self.location.origin,
  caches: self.caches,
  fetch: (request) => self.fetch(request),
  clients: self.clients,
  registration: self.registration,
  skipWaiting: () => self.skipWaiting(),
  subtle: self.crypto.subtle,
  setTimeout: (fn, ms) => self.setTimeout(fn, ms),
  clearTimeout: (id) => self.clearTimeout(id),
});
self.addEventListener("install", (event) => event.waitUntil(sw.install()));
self.addEventListener("activate", (event) => event.waitUntil(sw.activate()));
self.addEventListener("fetch", (event) => {
  const answer = sw.respond(event.request, { preloadResponse: event.preloadResponse, waitUntil: (job) => event.waitUntil(job) });
  if (answer) event.respondWith(answer);
});
self.addEventListener("message", (event) => {
  const port = event.ports && event.ports[0];
  event.waitUntil(sw.message(event.data, port ? (answer) => port.postMessage(answer) : undefined));
});
})();
`;
}

/** The kill switch for `buildId`: replaces any worker, deletes every Cookpool cache, unregisters, reloads. */
export function killSwitchSource(buildId) {
  return `// Cookpool's service worker is OFF (src/service-worker/switch.mjs; build ${buildId}).
// Written by scripts/service-worker.mjs (Cookpool PW-4); do not edit. It takes over
// from any installed worker at once, deletes every Cookpool cache, unregisters
// itself and reloads the pages it controlled from the network. It answers no
// request: everything goes to the network.
(() => {
"use strict";
self.addEventListener("install", (event) => event.waitUntil(self.skipWaiting()));
self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const names = await self.caches.keys();
    await Promise.all(names.filter((name) => name.startsWith("cookpool-")).map((name) => self.caches.delete(name)));
    await self.registration.unregister();
    const open = await self.clients.matchAll({ type: "window" });
    await Promise.all(open.map((client) => client.navigate(client.url).catch(() => undefined)));
  })());
});
})();
`;
}

function run(app) {
  const assets = path.join(app, ".open-next", "assets");
  if (!fs.existsSync(assets)) fail(`${assets} is missing: run the OpenNext build first`);
  const idFile = path.join(app, ".next", "BUILD_ID");
  if (!fs.existsSync(idFile)) fail(`${idFile} is missing: run next build first`);
  const buildId = fs.readFileSync(idFile, "utf8").trim();
  if (!/^[A-Za-z0-9_-]+$/.test(buildId)) fail(`unexpected build id ${JSON.stringify(buildId)}`);
  const out = path.join(assets, "sw.js");
  if (SERVICE_WORKER !== "on") {
    fs.writeFileSync(out, killSwitchSource(buildId));
    console.log(`✓ service-worker: OFF (src/service-worker/switch.mjs) — sw.js unregisters every installed worker`);
    return;
  }
  let precache;
  try {
    precache = precacheFor(assets);
  } catch (error) {
    fail(error.message);
  }
  let bytes = 0;
  for (const url of precache) {
    const file = path.join(assets, namesItsBuild(url) && !url.startsWith("/_rsc/") ? (url === "/" ? "/index.html" : `${url}.html`) : url);
    bytes += fs.statSync(file).size;
    if (namesItsBuild(url) && !fs.readFileSync(file, "utf8").includes(buildId)) fail(`${url} does not name build ${buildId}`);
  }
  const modules = WORKER_MODULES.map((id) => ({ id, code: fs.readFileSync(path.join(app, id), "utf8") }));
  fs.writeFileSync(out, workerSource({ buildId, precache, modules }));
  console.log(`✓ service-worker: sw.js for build ${buildId}, ${precache.length} files precached (${(bytes / 1e6).toFixed(1)} MB)`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const i = process.argv.indexOf("--app");
  run(path.resolve(i >= 0 ? process.argv[i + 1] : path.join(path.dirname(fileURLToPath(import.meta.url)), "..")));
}
