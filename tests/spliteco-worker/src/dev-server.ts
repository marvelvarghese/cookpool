// A local API for clicking through the Spliteco app (apps/spliteco-web) with
// the REAL spliteco-worker, membership-worker and kitchen-worker routers over
// an in-memory SQLite database with every migration applied — the test
// harness, behind an HTTP server. Never deployed; not a test.
//
//   node apps/spliteco-worker/node_modules/.bin/esbuild tests/spliteco-worker/src/dev-server.ts \
//     --bundle --platform=node --format=esm --tsconfig=tests/spliteco-worker/tsconfig.json \
//     --banner:js="import{createRequire}from'module';const require=createRequire(import.meta.url);" \
//     --outfile=<scratch>/dev-server.mjs && node <scratch>/dev-server.mjs
//
// Listens on http://localhost:8787 (PORT to change). The app's `next dev`
// rewrites /api/* here. Sign in as you@spliteco.test (or anu@, dev@,
// meera@spliteco.test); the code is 123456 and comes back in delivery.code.
// Tokens are `dev_<usr id>`; nothing here is a real credential.

import { createServer, type IncomingMessage } from "node:http";
import { createHarness, usr } from "./harness.js";

const PORT = Number(process.env.PORT ?? 8787);
const h = createHarness();

const PEOPLE = [
  { id: usr(1), email: "you@spliteco.test", name: "Ravi" },
  { id: usr(2), email: "anu@spliteco.test", name: "Anu" },
  { id: usr(3), email: "dev@spliteco.test", name: "Dev" },
  { id: usr(4), email: "meera@spliteco.test", name: "Meera" },
];
const [ME, ANU, DEV, MEERA] = PEOPLE.map((p) => p.id) as [string, string, string, string];
for (const p of PEOPLE) h.profile(p.id, { displayName: p.name, email: p.email });

const flat = h.group("Flat 4B");
const goa = h.group("Goa Trip", { madeIn: "spliteco", kind: "trip" });
const office = h.group("Office lunch", { madeIn: "spliteco", kind: "other" });
for (const id of [ME, ANU, DEV]) h.grant(id, flat, id === ME ? "owner" : "builder");
for (const id of [ME, ANU, DEV, MEERA]) h.grant(id, goa, id === ME ? "owner" : "builder");
for (const id of [ME, DEV]) h.grant(id, office, id === ME ? "owner" : "builder");
const codes = new Map<string, string>([
  ["FLAT4BXX", flat.id],
  ["GOA2TRIP", goa.id],
  ["OFFICE12", office.id],
]);

let n = 0;
const key = () => `dev_seed_${++n}`;
async function seed(): Promise<void> {
  const k = (path: string, as: string, body: unknown) => h.kitchen("POST", path, { as, body, headers: { "idempotency-key": key() } });
  await k(`/v1/organizations/${flat.publicId}/kitchen/expenses`, ANU, {
    title: "Weekly vegetables",
    totalMinor: 127200,
    mode: "equal",
    payers: [{ subjectId: ANU, amountMinor: 127200 }],
    participants: [{ subjectId: ME }, { subjectId: ANU }, { subjectId: DEV }],
  });
  const s = (group: typeof goa, as: string, body: unknown) =>
    h.call("POST", `/v1/spliteco/groups/${group.publicId}/expenses`, { as, body, headers: { "idempotency-key": key() } });
  await s(goa, MEERA, {
    title: "Villa, 3 nights",
    totalMinor: 1800000,
    category: "stay",
    payers: [{ subjectId: MEERA, amountMinor: 1800000 }],
    split: { method: "shares", participants: [{ subjectId: ME, shares: 1 }, { subjectId: ANU, shares: 1 }, { subjectId: DEV, shares: 1 }, { subjectId: MEERA, shares: 2 }] },
  });
  await s(goa, ME, {
    title: "Scooter rental",
    totalMinor: 360000,
    category: "transport",
    payers: [{ subjectId: ME, amountMinor: 360000 }],
    split: { method: "equal", participants: [ME, ANU, DEV, MEERA] },
  });
  await s(office, DEV, {
    title: "Thali Friday",
    totalMinor: 98000,
    category: "food",
    payers: [{ subjectId: DEV, amountMinor: 98000 }],
    split: { method: "equal", participants: [ME, DEV] },
  });
  // SE2: Meera and Dev take UPI; Anu has no UPI ID yet (Settle up shows UPI off for her).
  for (const [as, upiVpa] of [[MEERA, "meera.r@okaxis"], [DEV, "devk@ybl"]] as const) {
    await h.call("PUT", "/v1/spliteco/me/profile", { as, body: { upiVpa } });
  }
}

const RECEIPT_STUB = {
  store: "The Beach Shack",
  total: 441600,
  currency: "INR",
  sumMinor: 384000,
  totalMatches: true,
  lines: [
    { text: "Prawn curry", name: "Prawn curry", priceMinor: 68000, confidence: "check", reason: "no price from before" },
    { text: "Fish thali x2", name: "Fish thali", quantity: 2, unit: "pcs", priceMinor: 84000, confidence: "sure" },
    { text: "Chkn xacuti", name: "Chicken xacuti", priceMinor: 56000, confidence: "sure" },
    { text: "Kingfshr x6", name: "Kingfisher", quantity: 6, unit: "pcs", priceMinor: 108000, confidence: "check", reason: "unclear" },
    { text: "Garlic naan x4", name: "Garlic naan", quantity: 4, unit: "pcs", priceMinor: 36000, confidence: "sure" },
    { text: "Bebinca", name: "Bebinca", priceMinor: 32000, confidence: "sure" },
    { text: "GST 5%", priceMinor: 19200, confidence: "check", reason: "not_food" },
    { text: "Svc chg 10%", priceMinor: 38400, confidence: "check", reason: "not_food" },
  ],
};

const tokens = new Map<string, string>(PEOPLE.map((p) => [`dev_${p.id}`, p.id]));
const challenges = new Map<string, string>();

async function read(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

const ok = (data: unknown, status = 200) => Response.json({ data, meta: { requestId: "req_dev", cursor: null } }, { status });
const fail = (status: number, code: string, message: string) =>
  Response.json({ error: { code, message, details: {}, requestId: "req_dev" } }, { status });

function userBody(id: string) {
  const p = PEOPLE.find((x) => x.id === id)!;
  return { id: p.id, email: p.email, displayName: p.name, lastOrgSlug: null };
}

async function handle(method: string, url: URL, headers: Headers, body: string): Promise<Response> {
  const path = url.pathname;
  if (path === "/health") return ok({ status: "ok", source: "console" });
  if (path === "/v1/auth/login/start" && method === "POST") {
    const email = String((JSON.parse(body || "{}") as { email?: string }).email ?? "").toLowerCase();
    const person = PEOPLE.find((p) => p.email === email);
    if (!person) return fail(422, "validation_failed", "Use you@, anu@, dev@ or meera@spliteco.test");
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
  const token = headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
  const actor = tokens.get(token);
  if (!actor) return fail(401, "unauthenticated", "Authentication required");
  if (path === "/v1/auth/session") return ok({ session: { id: "ses_dev", expiresAt: new Date(Date.now() + 86_400_000).toISOString(), createdAt: new Date().toISOString() }, user: userBody(actor) });
  if (path === "/v1/auth/logout") return ok({ success: true });
  if (path === "/v1/auth/profile") {
    if (method === "PATCH") {
      const { displayName } = JSON.parse(body || "{}") as { displayName?: string };
      const p = PEOPLE.find((x) => x.id === actor)!;
      if (typeof displayName === "string" && displayName.trim()) p.name = displayName.trim();
      h.profile(p.id, { displayName: p.name, email: p.email });
    }
    return ok({ user: userBody(actor) });
  }
  const joinCode = path.match(/^\/v1\/organizations\/org_([0-9a-f]{32})\/join-code$/);
  if (joinCode && method === "GET") {
    const code = [...codes.entries()].find(([, orgId]) => orgId.replace(/-/g, "") === joinCode[1])?.[0];
    if (code) return ok({ code });
    const fresh = Math.random().toString(36).slice(2, 10).toUpperCase();
    const orgId = joinCode[1]!.replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, "$1-$2-$3-$4-$5");
    codes.set(fresh, orgId);
    return ok({ code: fresh });
  }
  if (path === "/v1/join" && method === "POST") {
    const { code } = JSON.parse(body || "{}") as { code?: string };
    const orgId = code ? codes.get(code.toUpperCase()) : undefined;
    if (!orgId) return fail(404, "not_found", "No group has that code");
    h.grant(actor, { id: orgId as never, publicId: `org_${orgId.replace(/-/g, "")}`, name: "" }, "builder");
    return ok({ orgId: `org_${orgId.replace(/-/g, "")}`, slug: "group", memberId: "mem_dev", alreadyMember: false }, 201);
  }
  // SE4: Cookpool's receipt reader, stubbed — the dev API has no model. It
  // answers the canvas's Beach Shack bill (one line hard to read), or with
  // SPLITECO_DEV_RECEIPT=unavailable what the route answers without a key.
  if (path === "/v1/kitchen/me/ai/receipt" && method === "POST") {
    if (process.env.SPLITECO_DEV_RECEIPT === "unavailable") {
      return Response.json({ error: { code: "internal_error", message: "AI is not set up", details: { reason: "ai_unavailable" }, requestId: "req_dev" } }, { status: 503 });
    }
    const { image } = JSON.parse(body || "{}") as { image?: string };
    if (typeof image !== "string" || image.length < 100) return fail(422, "validation_failed", "Send a photo");
    return ok(RECEIPT_STUB);
  }
  if (path.startsWith("/v1/spliteco/")) {
    const forwarded: Record<string, string> = {};
    const idem = headers.get("idempotency-key");
    if (idem) forwarded["idempotency-key"] = idem;
    const opts = { as: actor, headers: forwarded, ...(body ? { rawBody: body } : {}) };
    return h.call(method, path + url.search, opts);
  }
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
  console.warn(`spliteco dev API on http://localhost:${PORT} — sign in as you@spliteco.test, code 123456`);
});
