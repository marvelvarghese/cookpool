// A local API for clicking through the Tripeco app (apps/tripeco-web) with
// the REAL tripeco-worker and spliteco-worker (and membership-worker) routers
// over an in-memory SQLite database with every migration applied — the test
// harness behind an HTTP server. Never deployed; not a test.
//
//   node_modules/.pnpm/esbuild@0.21.5/node_modules/esbuild/bin/esbuild tests/tripeco-web/dev/dev-server.ts \
//     --bundle --platform=node --format=esm --tsconfig=tests/tripeco-worker/tsconfig.json \
//     --banner:js="import{createRequire}from'module';const require=createRequire(import.meta.url);" \
//     --outfile=<scratch>/tripeco-dev.mjs && SPLITECO_MIGRATIONS_ROOT=$PWD/packages/db/src/migrations node <scratch>/tripeco-dev.mjs
//
// Listens on http://localhost:8787 (PORT to change); tripeco-web's `next dev`
// rewrites /api/* here. Sign in as you@tripeco.test (or anu@, dev@,
// meera@tripeco.test), code 123456. Tokens are `dev_<usr id>`; nothing here
// is a real credential. The odometer reader is a stand-in: it answers a fixed
// reading (start, end or Trip A) so the Scan screen can be clicked through.

import { createServer, type IncomingMessage } from "node:http";
import { createTripeco, usr } from "../../tripeco-worker/src/harness.js";

const PORT = Number(process.env.PORT ?? 8787);
const t = createTripeco();
const h = t.h;

const PEOPLE = [
  { id: usr(1), email: "you@tripeco.test", name: "Rahul" },
  { id: usr(2), email: "anu@tripeco.test", name: "Anu" },
  { id: usr(3), email: "dev@tripeco.test", name: "Dev" },
  { id: usr(4), email: "meera@tripeco.test", name: "Meera" },
];
const [ME, ANU, DEV, MEERA] = PEOPLE.map((p) => p.id) as [string, string, string, string];
for (const p of PEOPLE) h.profile(p.id, { displayName: p.name, email: p.email });
const goa = h.group("Goa Trip", { madeIn: "spliteco", kind: "trip" });
const office = h.group("Office ride", { madeIn: "spliteco", kind: "other" });
const flat = h.group("Flat 4B", { madeIn: "spliteco", kind: "home" });
for (const id of [ME, ANU, DEV, MEERA]) h.grant(id, goa, id === ME ? "owner" : "builder");
for (const id of [ME, DEV, MEERA]) h.grant(id, office, id === ME ? "owner" : "builder");
for (const id of [ME, ANU]) h.grant(id, flat, id === ME ? "owner" : "builder");

const day = (d: number) => new Date(Date.now() - d * 86_400_000).toISOString();
async function json<T>(res: Response): Promise<T> {
  const body = (await res.json()) as { data: T; error?: unknown };
  if (!res.ok) throw new Error(JSON.stringify(body.error));
  return body.data;
}
async function seed(): Promise<void> {
  const call = (method: string, path: string, body?: unknown) => t.call(method, path, { as: ME, ...(body !== undefined ? { body } : {}) });
  const { vehicle: swift } = await json<{ vehicle: { id: string } }>(
    await call("POST", "/v1/tripeco/vehicles", { name: "Swift", plate: "KL 07 CX 4412", fuel: "petrol", odometerKm: 47000, mileage: 18, priceMinor: 10400, wearMinorPerKm: 200 }),
  );
  await json(await call("POST", "/v1/tripeco/vehicles", { name: "Nexon EV", plate: "KL 07 DE 0921", fuel: "electric", odometerKm: 21880, mileage: 7.1, priceMinor: 950 }));
  for (const [odo, litres, amount, full, d] of [
    [47000, 40, 416000, true, 40],
    [47744, 40, 416000, true, 30],
    [48100, 20, 208000, false, 20],
    [48410, 15, 156000, true, 1],
  ] as const) {
    await json(await call("POST", `/v1/tripeco/vehicles/${swift.id}/fuel`, { amountMinor: amount, quantity: litres, odometerKm: odo, full, loggedAt: day(d) }));
  }
  const { ride } = await json<{ ride: { id: string } }>(await call("POST", "/v1/tripeco/rides", { vehicleId: swift.id, mode: "odo", startKm: 48212, startedAt: day(2) }));
  await json(
    await call("PATCH", `/v1/tripeco/rides/${ride.id}`, {
      endKm: 48336,
      title: "Kochi → Munnar",
      groupId: goa.publicId,
      riders: [ME, ANU, DEV, MEERA].map((subjectId) => ({ subjectId, on: true })),
    }),
  );
  await json(await call("POST", `/v1/tripeco/rides/${ride.id}/post`, {}));
  const { ride: drop } = await json<{ ride: { id: string } }>(await call("POST", "/v1/tripeco/rides", { vehicleId: swift.id, mode: "odo", startKm: 48340, startedAt: day(0) }));
  await json(
    await call("PATCH", `/v1/tripeco/rides/${drop.id}`, {
      endKm: 48386,
      title: "Airport drop",
      groupId: office.publicId,
      riders: [ME, DEV, MEERA].map((subjectId) => ({ subjectId, on: true })),
    }),
  );
}

const tokens = new Map<string, string>(PEOPLE.map((p) => [`dev_${p.id}`, p.id]));
const challenges = new Map<string, string>();
const handoffs = new Map<string, { actor: string; origin: string; used: boolean }>();
let reads = 0;

async function read(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}
const ok = (data: unknown, status = 200) => Response.json({ data, meta: { requestId: "req_dev", cursor: null } }, { status });
const fail = (status: number, code: string, message: string, details: Record<string, unknown> = {}) =>
  Response.json({ error: { code, message, details, requestId: "req_dev" } }, { status });
const userBody = (id: string) => {
  const p = PEOPLE.find((x) => x.id === id)!;
  return { id: p.id, email: p.email, displayName: p.name, lastOrgSlug: null };
};

async function handle(method: string, url: URL, headers: Headers, body: string): Promise<Response> {
  const path = url.pathname;
  if (path === "/health") return ok({ status: "ok", source: "console" });
  if (path === "/v1/auth/login/start" && method === "POST") {
    const email = String((JSON.parse(body || "{}") as { email?: string }).email ?? "").toLowerCase();
    const person = PEOPLE.find((p) => p.email === email);
    if (!person) return fail(422, "validation_failed", "Use you@, anu@, dev@ or meera@tripeco.test");
    const challengeId = `chl_${crypto.randomUUID().replace(/-/g, "")}`;
    challenges.set(challengeId, person.id);
    return ok({ challengeId, expiresAt: new Date(Date.now() + 600_000).toISOString(), delivery: { mode: "local_debug", emailHint: email, code: "123456" } }, 201);
  }
  if (path === "/v1/auth/login/complete" && method === "POST") {
    const { challengeId, code } = JSON.parse(body || "{}") as { challengeId?: string; code?: string };
    const id = challengeId ? challenges.get(challengeId) : undefined;
    if (!id || code !== "123456") return fail(401, "unauthenticated", "Wrong code");
    return ok({ token: `dev_${id}`, tokenType: "bearer", expiresAt: new Date(Date.now() + 86_400_000).toISOString(), user: userBody(id) });
  }
  if (path === "/v1/auth/handoff/exchange" && method === "POST") {
    const { code } = JSON.parse(body || "{}") as { code?: string };
    const found = code ? handoffs.get(code) : undefined;
    if (!found || found.used) return fail(401, "unauthenticated", "Handoff refused", { reason: found ? "handoff_used" : "handoff_invalid" });
    found.used = true;
    return ok({ token: `dev_${found.actor}`, tokenType: "bearer", expiresAt: new Date(Date.now() + 86_400_000).toISOString(), user: userBody(found.actor) });
  }
  const actor = tokens.get(headers.get("authorization")?.replace(/^Bearer /, "") ?? "");
  if (!actor) return fail(401, "unauthenticated", "Authentication required");
  if (path === "/v1/auth/logout") return ok({ success: true });
  if (path === "/v1/auth/profile") return ok({ user: userBody(actor) });
  if (path === "/v1/auth/handoff" && method === "POST") {
    const { targetOrigin } = JSON.parse(body || "{}") as { targetOrigin?: string };
    const code = `hoc_${crypto.randomUUID().replace(/-/g, "")}`;
    handoffs.set(code, { actor, origin: String(targetOrigin), used: false });
    return ok({ code, targetOrigin, expiresAt: new Date(Date.now() + 60_000).toISOString() }, 201);
  }
  if (path === "/v1/kitchen/me/ai/odometer" && method === "POST") {
    const { image, mode } = JSON.parse(body || "{}") as { image?: string; mode?: string };
    if (typeof image !== "string" || image.length < 100) return fail(422, "validation_failed", "Send a photo");
    reads++;
    if (mode === "trip") return ok({ odometerKm: 48336, tripKm: 124, averageKmPer: 20.4 });
    return ok({ odometerKm: reads % 2 === 1 ? 48387 : 48511, tripKm: null, averageKmPer: null });
  }
  const forwarded: Record<string, string> = {};
  const idem = headers.get("idempotency-key");
  if (idem) forwarded["idempotency-key"] = idem;
  const opts = { as: actor, headers: forwarded, ...(body ? { rawBody: body } : {}) };
  if (path.startsWith("/v1/tripeco/")) return t.call(method, path + url.search, opts);
  if (path.startsWith("/v1/spliteco/")) return t.spliteco(method, path + url.search, opts);
  return fail(404, "not_found", `No dev route for ${method} ${path}`);
}

await seed();
createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
  const body = req.method === "GET" || req.method === "HEAD" ? "" : await read(req);
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) if (typeof v === "string") headers.set(k, v);
  let response: Response;
  try {
    response = await handle(req.method ?? "GET", url, headers, body);
  } catch (err) {
    response = fail(500, "internal_error", String(err));
  }
  res.statusCode = response.status;
  response.headers.forEach((v, k) => res.setHeader(k, v));
  res.end(Buffer.from(await response.arrayBuffer()));
}).listen(PORT, () => {
  console.warn(`tripeco dev API on http://localhost:${PORT} — sign in as you@tripeco.test, code 123456`);
});
