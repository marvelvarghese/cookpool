#!/usr/bin/env node
// THE TIMING CHECK (Cookpool SM-2, cookpool-simpler design §1.2 item 5).
//
// Time to first byte, from wherever this runs, for the app's pages and the
// API's reads that need no sign-in, on stage and prod: 10 GETs each, the
// median and the 75th percentile. Over budget at p75 (a page 0.3 s, a read
// 0.4 s: design decision 2) exits 1, unless --report-only.
//
//   node tooling/perf/check.mjs [--env stage|prod|all] [--runs 10] [--fresh] [--report-only]
//
//   --fresh        a new connection (TCP + TLS) for every GET, as a first
//                  visit pays; by default one kept-alive connection per host,
//                  as a browser does after its first request, so the number
//                  is the edge's answer time, not the handshake's
//   --report-only  print, and exit 0 whatever the numbers
//
// Each page line also says how many answers came from the console Worker's
// OpenNext (`x-opennext` header) — a page served as a file has none — and
// every line the Cloudflare colos that answered. The reads are timed twice
// over (SM-4): on api-edge's own workers.dev host, and on the app's hosts at
// `/api/…`, where the console Worker forwards them over its service binding
// (what the app itself calls). Unauthenticated GETs only; it never signs in
// and never writes. Node, no dependencies.

import https from "node:https";
import { performance } from "node:perf_hooks";
import { pathToFileURL } from "node:url";

const BUDGET = { page: 0.3, read: 0.4 };

// The product's addresses (SI-8, SI-10). The API answers on api-edge's
// workers.dev host and, since SM-4, on each app host at `/api`.
const SUBDOMAIN = "cookpool";
const ENVIRONMENTS = {
  stage: { domain: "stage.cookpool.store" },
  prod: { domain: "cookpool.store" },
};
const PAGES = ["/login", "/home", "/pantry", "/use", "/icons/icon-192.png"];
const READS = ["/health", "/v1/auth/oauth/providers"];
/** Where the console Worker answers the API on the app's own address (SM-4). */
const APP_API_PREFIX = "/api";

export function targets(env) {
  const app = [ENVIRONMENTS[env].domain, `cookpool-web-console-next-${env}.${SUBDOMAIN}.workers.dev`];
  const api = `cookpool-api-edge-${env}.${SUBDOMAIN}.workers.dev`;
  return [
    ...app.flatMap((host) => PAGES.map((p) => ({ kind: "page", url: `https://${host}${p}` }))),
    ...READS.map((p) => ({ kind: "read", url: `https://${api}${p}` })),
    ...app.flatMap((host) => READS.map((p) => ({ kind: "read", url: `https://${host}${APP_API_PREFIX}${p}` }))),
  ];
}

/** The median of sorted samples. */
export function median(sorted) {
  const n = sorted.length;
  if (n === 0) return NaN;
  return n % 2 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
}

/** The p-th percentile of sorted samples, nearest rank (p75 of 10 is the 8th). */
export function percentile(sorted, p) {
  if (sorted.length === 0) return NaN;
  return sorted[Math.min(sorted.length, Math.max(1, Math.ceil((p / 100) * sorted.length))) - 1];
}

/** One GET: seconds to the response's first byte (its status line and headers). */
function get(url, agent) {
  return new Promise((resolve) => {
    const start = performance.now();
    const req = https.get(url, { agent, headers: { "user-agent": "cookpool-timing-check/1" }, timeout: 15000 }, (res) => {
      const ttfb = (performance.now() - start) / 1000;
      res.resume();
      res.on("end", () =>
        resolve({
          ttfb,
          status: res.statusCode ?? 0,
          worker: res.headers["x-opennext"] !== undefined,
          colo: String(res.headers["cf-ray"] ?? "").split("-")[1] ?? "",
        }),
      );
    });
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", (e) => resolve({ ttfb: NaN, status: 0, worker: false, colo: "", error: e.message }));
  });
}

async function measure(target, runs, fresh, agents) {
  const host = new URL(target.url).host;
  if (!fresh && !agents.has(host)) agents.set(host, new https.Agent({ keepAlive: true, maxSockets: 1 }));
  const samples = [];
  for (let i = 0; i < runs; i++) samples.push(await get(target.url, fresh ? false : agents.get(host)));
  const ok = samples.filter((s) => s.status >= 200 && s.status < 400 && Number.isFinite(s.ttfb));
  const sorted = ok.map((s) => s.ttfb).sort((a, b) => a - b);
  const p75 = percentile(sorted, 75);
  const errors = samples.length - ok.length;
  return {
    ...target,
    median: median(sorted),
    p75,
    errors,
    statuses: [...new Set(samples.map((s) => s.error ?? s.status))],
    worker: samples.filter((s) => s.worker).length,
    colos: [...new Set(samples.map((s) => s.colo).filter(Boolean))],
    over: errors > 0 || !(p75 <= BUDGET[target.kind]),
  };
}

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] !== undefined ? process.argv[i + 1] : fallback;
}

async function main() {
  const env = arg("env", "all");
  const runs = Number(arg("runs", "10"));
  const fresh = process.argv.includes("--fresh");
  const reportOnly = process.argv.includes("--report-only");
  const envs = env === "all" ? Object.keys(ENVIRONMENTS) : [env];
  if (!envs.every((e) => e in ENVIRONMENTS) || !Number.isInteger(runs) || runs < 1) {
    console.error("usage: node tooling/perf/check.mjs [--env stage|prod|all] [--runs 10] [--fresh] [--report-only]");
    process.exit(2);
  }
  const s = (x) => (Number.isFinite(x) ? x.toFixed(3) : "  —  ");
  console.log(`Time to first byte, ${runs} GETs each (${fresh ? "a new connection each" : "kept-alive connection"}); budgets at p75: page ${BUDGET.page} s, read ${BUDGET.read} s`);
  let over = 0;
  for (const e of envs) {
    console.log(`\n${e}`);
    const agents = new Map();
    for (const target of targets(e)) {
      const r = await measure(target, runs, fresh, agents);
      if (r.over) over += 1;
      const verdict = r.over ? `✕ over ${BUDGET[r.kind]}` : `✓`;
      // A read on /api runs the console Worker but never OpenNext, so the
      // OpenNext count says something about pages only.
      const notes = [...(r.kind === "page" ? [`worker ${r.worker}/${runs}`] : []), r.colos.join(" ") || "no colo"];
      if (r.errors) notes.push(`${r.errors} failed: ${r.statuses.join(" ")}`);
      console.log(`  ${r.kind}  ${r.url.padEnd(72)} median ${s(r.median)}  p75 ${s(r.p75)}  ${verdict}  (${notes.join(", ")})`);
    }
    for (const agent of agents.values()) agent.destroy();
  }
  console.log(`\n${over === 0 ? "Within budget." : `${over} over budget.`}${reportOnly ? " (--report-only)" : ""}`);
  process.exit(over > 0 && !reportOnly ? 1 : 0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
