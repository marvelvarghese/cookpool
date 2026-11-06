import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { cwd } from "node:process";
import { precacheUrls } from "@web-console-next/service-worker/precache.mjs";
import { SERVICE_WORKER } from "@web-console-next/service-worker/switch.mjs";
import { STATIC_PAGES, htmlFile, rscFile } from "@web-console-next/lib/static-pages.mjs";
import { FakeCaches, fakeNetwork } from "./sw-fakes";

// Cookpool PW-4: the build writes `/sw.js` for its own files — the precache
// list from `.open-next/assets`, the worker's modules bundled into one
// classic script — or, with the kill switch off, a worker that removes
// itself.

const APP = `${cwd()}/../../apps/web-console-next`;
const ORIGIN = "https://cookpool.store";
const BUILD = "bld_test_1";

interface Script {
  WORKER_MODULES: readonly string[];
  assetFiles(dir: string): string[];
  precacheFor(assets: string): string[];
  bundleModules(modules: { id: string; code: string }[]): string;
  workerSource(input: { buildId: string; precache: readonly string[]; modules: { id: string; code: string }[] }): string;
  killSwitchSource(buildId: string): string;
}
const load = async (): Promise<Script> => {
  const spec = "../../../apps/web-console-next/scripts/service-worker.mjs";
  return (await import(spec)) as Script;
};

/** A build's assets as pages-as-files and OpenNext leave them. */
function fakeAssets(): Record<string, string> {
  const files: Record<string, string> = {
    "/BUILD_ID": BUILD,
    "/_headers": "/sw.js\n  Cache-Control: no-cache\n",
    "/_redirects": "/dishes/:dishRef /dishes/_ 200\n",
    "/_next/static/chunks/main-app-aaa.js": "main",
    "/_next/static/chunks/webpack-bbb.js": "runtime",
    "/_next/static/css/ccc.css": "css",
    "/_next/static/media/ddd.woff2": "font",
    [`/_next/static/${BUILD}/_buildManifest.js`]: "manifest",
    "/icons/icon-192.png": "png",
    "/icons/icon.svg": "svg",
  };
  for (const page of STATIC_PAGES) {
    files[htmlFile(page)] = `<html>${page} ${BUILD}</html>`;
    files[rscFile(page)] = `0:{"b":"${BUILD}"}`;
  }
  return files;
}

function onDisk(files: Record<string, string>): string {
  const dir = mkdtempSync(`${tmpdir()}/cookpool-pw4-assets-`);
  for (const [path, body] of Object.entries(files)) {
    mkdirSync(`${dir}${path.slice(0, path.lastIndexOf("/"))}`, { recursive: true });
    writeFileSync(`${dir}${path}`, body);
  }
  return dir;
}

describe("the precache list", () => {
  it("is every page served as a file and its payload, every /_next/static file and every icon", () => {
    const urls = precacheUrls(Object.keys(fakeAssets()));
    expect(urls).toContain("/");
    expect(urls).toContain("/home");
    expect(urls).toContain("/_rsc/home.rsc");
    expect(urls).toContain("/dishes/_");
    expect(urls).toContain("/_rsc/dishes/_.rsc");
    expect(urls).toContain("/groups/_/expense");
    expect(urls).toContain("/login");
    for (const f of ["/_next/static/chunks/main-app-aaa.js", "/_next/static/css/ccc.css", "/_next/static/media/ddd.woff2", `/_next/static/${BUILD}/_buildManifest.js`, "/icons/icon-192.png", "/icons/icon.svg"]) {
      expect(urls).toContain(f);
    }
    // (STATIC_PAGES less the OAuth return) × page and payload, + 7 built files.
    expect(urls).toHaveLength((STATIC_PAGES.length - 1) * 2 + 7);
  });

  it("never the OAuth return, the files the Worker reads, the worker or the manifest", () => {
    const urls = precacheUrls([...Object.keys(fakeAssets()), "/sw.js", "/manifest.webmanifest"]);
    for (const f of ["/auth/callback", "/_rsc/auth/callback.rsc", "/auth/callback.html", "/BUILD_ID", "/_headers", "/_redirects", "/sw.js", "/manifest.webmanifest"]) {
      expect(urls).not.toContain(f);
    }
    expect(urls.some((u) => u.endsWith(".html"))).toBe(false);
  });

  it("fails when a page is missing (pages-as-files did not run)", () => {
    const files = Object.keys(fakeAssets()).filter((f) => f !== "/_rsc/home.rsc");
    expect(() => precacheUrls(files)).toThrow(/_rsc\/home\.rsc/);
  });

  it("is built from the .open-next/assets tree on disk", async () => {
    const dir = onDisk(fakeAssets());
    try {
      const script = await load();
      expect(script.assetFiles(dir)).toContain("/_next/static/chunks/main-app-aaa.js");
      expect(script.precacheFor(dir)).toEqual(precacheUrls(Object.keys(fakeAssets())));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

type Listener = (event: Record<string, unknown>) => void;

/** Run a generated worker script against fakes; returns its listeners and the fakes. */
function boot(source: string, answer: (r: Request) => Response) {
  const listeners: Record<string, Listener> = {};
  const caches = new FakeCaches();
  const net = fakeNetwork(answer);
  const calls = { skipWaiting: 0, unregistered: 0, navigated: [] as string[] };
  const self = {
    location: { origin: ORIGIN },
    caches,
    fetch: net.fetch,
    clients: {
      claim: async () => undefined,
      matchAll: async () => [{ url: `${ORIGIN}/home`, navigate: async (url: string) => calls.navigated.push(url) }],
    },
    registration: {
      navigationPreload: { enable: async () => undefined },
      unregister: async () => {
        calls.unregistered += 1;
        return true;
      },
    },
    skipWaiting: async () => {
      calls.skipWaiting += 1;
    },
    crypto: globalThis.crypto,
    setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms),
    clearTimeout: (id: ReturnType<typeof setTimeout>) => clearTimeout(id),
    addEventListener: (type: string, fn: Listener) => {
      listeners[type] = fn;
    },
  };
  new Function("self", source)(self);
  const dispatch = async (type: string, extra: Record<string, unknown> = {}) => {
    const waits: Promise<unknown>[] = [];
    let answered: Promise<Response> | null = null;
    listeners[type]!({ ...extra, waitUntil: (p: Promise<unknown>) => waits.push(p), respondWith: (p: Promise<Response>) => (answered = p) });
    await Promise.all(waits);
    return answered as Promise<Response> | null;
  };
  return { listeners, caches, net, calls, dispatch };
}

describe("the worker the build writes", () => {
  const assets = fakeAssets();
  const serve = (r: Request) => {
    const path = new URL(r.url).pathname;
    const file = path.startsWith("/_rsc/") || path.startsWith("/_next/") || path.startsWith("/icons/") ? path : htmlFile(path === "/" ? "/" : path);
    const body = assets[file];
    return body === undefined ? new Response("no", { status: 404 }) : new Response(body, { status: 200 });
  };

  async function built(): Promise<string> {
    const script = await load();
    const modules = script.WORKER_MODULES.map((id) => ({ id, code: readFileSync(`${APP}/${id}`, "utf8") }));
    return script.workerSource({ buildId: BUILD, precache: precacheUrls(Object.keys(assets)), modules });
  }

  it("is switched on", () => {
    expect(SERVICE_WORKER).toBe("on");
  });

  it("is one classic script: no import or export left", async () => {
    const source = await built();
    expect(source).not.toMatch(/^\s*(import|export)\b/m);
    expect(source).toContain(`buildId: ${JSON.stringify(BUILD)}`);
  });

  it("installs this build's shell into a cache named for the build, then opens a page with no signal", async () => {
    const w = boot(await built(), serve);
    expect(Object.keys(w.listeners).sort()).toEqual(["activate", "fetch", "install", "message"]);
    await w.dispatch("install");
    const cache = w.caches.stores.get(`cookpool-static-${BUILD}`)!;
    expect(cache.entries.size).toBe(precacheUrls(Object.keys(assets)).length);
    await w.dispatch("activate");
    w.net.goOffline();
    const request = new Request(`${ORIGIN}/dishes/dsh_42`, { mode: "same-origin" });
    Object.defineProperty(request, "mode", { value: "navigate" });
    const answer = await w.dispatch("fetch", { request, preloadResponse: Promise.resolve(undefined) });
    expect(await (await answer!).text()).toBe(`<html>/dishes/:dishRef ${BUILD}</html>`);
  });

  it("refuses to install a page from another build (a deploy landed meanwhile)", async () => {
    const w = boot(await built(), (r) => (new URL(r.url).pathname === "/home" ? new Response("<html>other build</html>") : serve(r)));
    await expect(w.dispatch("install")).rejects.toThrow(/\/home is not build/);
  });

  it("leaves the rest to the browser", async () => {
    const w = boot(await built(), serve);
    const answer = await w.dispatch("fetch", { request: new Request(`${ORIGIN}/api/v1/auth/profile`) });
    expect(answer).toBeNull();
  });

  it("bundles only the module syntax it understands", async () => {
    const script = await load();
    expect(() => script.bundleModules([{ id: "a.mjs", code: 'export default 1;\n' }])).toThrow(/may only use/);
    expect(() => script.bundleModules([{ id: "a.mjs", code: 'import { x } from "./b.mjs";\n' }])).toThrow(/not bundled before it/);
  });
});

describe("the kill switch", () => {
  it("takes over at once, deletes every Cookpool cache, unregisters and reloads the pages it had", async () => {
    const w = boot((await load()).killSwitchSource(BUILD), () => new Response("x"));
    expect(Object.keys(w.listeners).sort()).toEqual(["activate", "install"]);
    await w.caches.open(`cookpool-static-${BUILD}`);
    await w.caches.open("cookpool-data-v1-usr_a");
    await w.caches.open("cookpool-meta");
    await w.caches.open("someone-elses");
    await w.dispatch("install");
    expect(w.calls.skipWaiting).toBe(1);
    await w.dispatch("activate");
    expect(await w.caches.keys()).toEqual(["someone-elses"]);
    expect(w.calls.unregistered).toBe(1);
    expect(w.calls.navigated).toEqual([`${ORIGIN}/home`]);
  });
});
