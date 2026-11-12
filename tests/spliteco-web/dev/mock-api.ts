// A throwaway in-memory stand-in for api-edge + spliteco-worker, for clicking
// through the Spliteco app locally when the real dev API
// (tests/spliteco-worker/src/dev-server.ts) is not running. It uses the real
// split engine, so splits, balances and plans are the real maths; storage,
// auth and membership are faked. Never deployed, never tested against.
//
//   node apps/spliteco-web/node_modules/.bin/esbuild … (see the runbook) or:
//   npx esbuild tests/spliteco-web/dev/mock-api.ts --bundle --platform=node --format=esm --outfile=/tmp/mock-api.mjs && node /tmp/mock-api.mjs
//
// Listens on :8787. Sign in as any email; the code is 123456.

import { createServer } from "node:http";
import { buildSplitecoSplits, owedBySplit, type SplitSpec } from "../../../packages/kitchen-engine/src/splits";
import { balances, pairLines, settlePlan, type Txn } from "../../../packages/kitchen-engine/src/ledger";

type Any = Record<string, any>;
const ME = "usr_me", ANU = "usr_anu", DEV = "usr_dev", MEERA = "usr_meera";
const people: Record<string, string> = { [ME]: "Ravi", [ANU]: "Anu", [DEV]: "Dev", [MEERA]: "Meera" };
interface Group { id: string; name: string; kind: string; madeIn: string; members: string[]; code: string }
const groups: Group[] = [
  { id: "org_goa", name: "Goa Trip", kind: "trip", madeIn: "spliteco", members: [ME, ANU, DEV, MEERA], code: "GOA2TRIP" },
  { id: "org_flat", name: "Flat 4B", kind: "kitchen", madeIn: "cookpool", members: [ME, ANU], code: "FLAT4BXX" },
  { id: "org_office", name: "Office lunch", kind: "other", madeIn: "spliteco", members: [ME, DEV], code: "OFFICE12" },
];
interface T { id: string; org: string; kind: string; app: string; title: string; category: string | null; total: number; at: string; created: string; by: string; splits: { subjectId: string; paidMinor: number; owedMinor: number }[]; reverses: string | null; revises: string | null; movedFrom: string | null; deletedAt: string | null; input: Any | null; result: Any | null; note: string | null }
const txns: T[] = [];
const comments: Any[] = [];
let seq = 1;
const id = (p: string) => `${p}_${String(seq++).padStart(8, "0")}`;
const now = () => new Date().toISOString();

function post(org: string, input: Any, by: string, extra: Partial<T> = {}): T | Any {
  const built = buildSplitecoSplits(input.totalMinor, input.payers, toSpec(input.split));
  if (!built.ok) return { error: built.problems };
  const t: T = { id: id("txn"), org, kind: "expense", app: "spliteco", title: input.title, category: input.category ?? null, total: input.totalMinor, at: input.occurredAt ?? now(), created: now(), by, splits: built.splits, reverses: null, revises: null, movedFrom: null, deletedAt: null, input, result: built.result, note: input.note ?? null, ...extra };
  txns.push(t);
  return t;
}
function toSpec(s: Any): SplitSpec {
  return s.method === "items" ? { method: "items", items: s.items.map((i: Any) => ({ totalMinor: i.totalMinor, shares: i.shares })), adjustments: s.adjustments } : s;
}
function reverse(t: T, by: string, deleted = false): T {
  const r: T = { ...t, id: id("txn"), kind: "reversal", reverses: t.id, created: now(), at: now(), by, splits: t.splits.map((s) => ({ subjectId: s.subjectId, paidMinor: s.owedMinor, owedMinor: s.paidMinor })), deletedAt: deleted ? now() : null, revises: null, movedFrom: null };
  txns.push(r);
  return r;
}
const reversalOf = (t: T) => txns.find((x) => x.reverses === t.id);
const current = (org?: string) => txns.filter((t) => t.kind !== "reversal" && !reversalOf(t) && (!org || t.org === org));
const engine = (org: string): Txn[] => txns.filter((t) => t.org === org).map((t) => ({ id: t.id, kind: t.kind as Txn["kind"], title: t.title, totalMinor: t.total, splits: t.splits, reverses: t.reverses }));
const g = (gid: string) => groups.find((x) => x.id === gid);

function summary(t: T, me: string) {
  const mine = t.splits.find((s) => s.subjectId === me);
  return { id: t.id, groupId: t.org, groupName: g(t.org)!.kind === "direct" ? "Outside groups" : g(t.org)!.name, kind: t.kind === "reversal" ? "expense" : t.kind, app: t.app, bucket: t.app === "cookpool" ? "kitchen" : "other", title: t.title, category: t.category, method: t.input?.split.method ?? null, totalMinor: t.total, currency: "INR", occurredAt: t.at, createdAt: t.created, createdBy: t.by, payers: t.splits.filter((s) => s.paidMinor > 0).map((s) => ({ subjectId: s.subjectId, paidMinor: s.paidMinor })), splits: t.splits, myNetMinor: mine ? mine.paidMinor - mine.owedMinor : 0, locked: t.app === "cookpool" || t.kind !== "expense", viaDelegation: null };
}
/** The group's ledger split by bucket: Cookpool's rows are "kitchen", Spliteco's "other". */
const engineIn = (org: string, bucket: "kitchen" | "other"): Txn[] =>
  txns.filter((t) => t.org === org && (t.app === "cookpool" ? "kitchen" : "other") === bucket).map((t) => ({ id: t.id, kind: t.kind as Txn["kind"], title: t.title, totalMinor: t.total, splits: t.splits, reverses: t.reverses }));
function groupSummary(gr: Group, me: string) {
  const bal = balances(engine(gr.id));
  const myBuckets = gr.madeIn === "cookpool" ? { kitchen: balances(engineIn(gr.id, "kitchen")).get(me) ?? 0, other: balances(engineIn(gr.id, "other")).get(me) ?? 0 } : null;
  const plan = settlePlan(engine(gr.id)).payments;
  return { id: gr.id, name: gr.name, kind: gr.kind, madeIn: gr.madeIn, role: "owner", currency: "INR", memberCount: gr.members.length, myBalanceMinor: bal.get(me) ?? 0, myBuckets, myPlan: plan.filter((p) => p.fromId === me || p.toId === me).map((p) => ({ subjectId: p.fromId === me ? p.toId : p.fromId, amountMinor: p.fromId === me ? -p.amountMinor : p.amountMinor })) };
}
const mine = (me: string) => groups.filter((x) => x.members.includes(me));
const person = (s: string) => ({ subjectId: s, name: people[s] ?? null });
function friends(me: string) {
  const ids = [...new Set(mine(me).flatMap((x) => x.members))].filter((x) => x !== me);
  return ids.map((f) => {
    let amt = 0;
    const names: string[] = [];
    let outside = false;
    for (const gr of mine(me).filter((x) => x.members.includes(f))) {
      for (const l of pairLines(engine(gr.id))) {
        if (l.creditorId === me && l.debtorId === f) amt += l.amountMinor;
        if (l.creditorId === f && l.debtorId === me) amt -= l.amountMinor;
      }
      if (gr.kind === "direct") outside = current(gr.id).length > 0;
      else names.push(gr.name);
    }
    return { ...person(f), balances: amt ? [{ currency: "INR", amountMinor: amt }] : [], groupNames: names, outsideGroups: outside };
  });
}
function activity(me: string, orgs: string[]) {
  const rows = txns.filter((t) => orgs.includes(t.org)).sort((a, b) => b.created.localeCompare(a.created));
  const out: Any[] = [];
  for (const t of rows) {
    let action = "added";
    let prev: number | null = null;
    let other: string | null = null;
    if (t.kind === "reversal") {
      const succ = txns.find((x) => x.revises === t.reverses || x.movedFrom === t.reverses);
      if (t.deletedAt) action = "deleted";
      else if (succ?.movedFrom) { action = "moved_out"; other = succ.org; }
      else if (succ) continue;
      else action = "reversed";
    } else if (t.revises) {
      const o = txns.find((x) => x.id === t.revises)!;
      action = reversalOf(o)?.deletedAt ? "restored" : "edited";
      prev = o.total;
    } else if (t.movedFrom) { action = "moved_in"; other = txns.find((x) => x.id === t.movedFrom)!.org; }
    else if (t.app === "cookpool") action = "cookpool";
    const m = t.splits.find((s) => s.subjectId === me);
    out.push({ txnId: t.id, expenseId: t.reverses && action !== "deleted" ? t.reverses : t.kind === "reversal" ? t.reverses : t.id, action, at: t.created, actorId: t.by, groupId: t.org, groupName: g(t.org)!.name, title: t.title, totalMinor: t.total, currency: "INR", previousTotalMinor: prev, otherGroupId: other, otherGroupName: other ? g(other)!.name : null, myEffectMinor: m ? m.paidMinor - m.owedMinor : 0, viaDelegation: null });
  }
  return { entries: out.slice(0, 100), people: Object.keys(people).map(person) };
}
function detail(t: T, me: string) {
  const rev = reversalOf(t);
  const succ = txns.find((x) => x.revises === t.id || x.movedFrom === t.id);
  const state = !rev ? "current" : rev.deletedAt && !succ ? "deleted" : succ ? "replaced" : "reversed";
  const items = t.input?.split.method === "items" ? t.input.split.items.map((it: Any, i: number) => ({ position: i, name: it.name, qty: it.qty ?? 1, unitMinor: it.unitMinor ?? null, totalMinor: it.totalMinor, shares: it.shares.map((s: Any) => ({ ...s, amountMinor: t.result.items[i].amounts.find((a: Any) => a.subjectId === s.subjectId)?.amountMinor ?? 0 })) })) : [];
  const ids = new Set(t.splits.map((s) => s.subjectId));
  const breakdown = [...ids].map((sid) => {
    const s = t.splits.find((x) => x.subjectId === sid)!;
    const b = t.result?.breakdown.find((x: Any) => x.subjectId === sid);
    return { subjectId: sid, itemsMinor: b?.itemsMinor ?? s.owedMinor, adjustmentsMinor: b?.adjustmentsMinor ?? 0, owedMinor: s.owedMinor, paidMinor: s.paidMinor };
  });
  const lineage = [t.id];
  let p = t;
  while (p.revises || p.movedFrom) { p = txns.find((x) => x.id === (p.revises ?? p.movedFrom))!; lineage.push(p.id); }
  return {
    expense: { ...summary(t, me), note: t.note, state, deletedAt: rev?.deletedAt ?? null, restorableUntil: rev?.deletedAt ? new Date(Date.parse(rev.deletedAt) + 30 * 864e5).toISOString() : null, currentId: succ ? succ.id : null, breakdown, input: t.input, items, adjustments: t.input?.split.adjustments ?? [] },
    comments: comments.filter((c) => lineage.includes(c.txnId)),
    history: lineage.reverse().map((x, i) => { const tx = txns.find((y) => y.id === x)!; return { action: i === 0 ? "added" : tx.movedFrom ? "moved" : "edited", at: tx.created, by: tx.by, txnId: tx.id, groupId: tx.org, totalMinor: tx.total }; }).concat(rev?.deletedAt ? [{ action: "deleted", at: rev.deletedAt, by: rev.by, txnId: rev.id, groupId: rev.org, totalMinor: rev.total }] : []),
    people: Object.keys(people).map(person),
    canWrite: true,
  };
}

// Seed.
post("org_goa", { title: "Villa, 3 nights", totalMinor: 1_800_000, category: "stay", occurredAt: "2026-11-08T12:00:00.000Z", payers: [{ subjectId: MEERA, amountMinor: 1_800_000 }], split: { method: "shares", participants: [ME, ANU, DEV].map((s) => ({ subjectId: s, shares: 1 })).concat([{ subjectId: MEERA, shares: 2 }]) } }, MEERA);
post("org_goa", { title: "Airport cab", totalMinor: 240_000, category: "transport", occurredAt: "2026-11-08T09:00:00.000Z", payers: [{ subjectId: DEV, amountMinor: 240_000 }], split: { method: "equal", participants: [ME, ANU, DEV, MEERA] } }, DEV);
post("org_goa", { title: "Scooter rental", totalMinor: 360_000, category: "transport", occurredAt: "2026-11-09T09:00:00.000Z", payers: [{ subjectId: ME, amountMinor: 360_000 }], split: { method: "equal", participants: [ME, ANU, DEV, MEERA] } }, ME);
const veg = post("org_flat", { title: "Weekly vegetables", totalMinor: 127_200, occurredAt: "2026-11-10T09:00:00.000Z", payers: [{ subjectId: ANU, amountMinor: 127_200 }], split: { method: "equal", participants: [ME, ANU] } }, ANU) as T;
post("org_flat", { title: "Wifi bill", totalMinor: 99_900, category: "bills", occurredAt: "2026-11-11T09:00:00.000Z", payers: [{ subjectId: ME, amountMinor: 99_900 }], split: { method: "equal", participants: [ME, ANU] } }, ME);
veg.app = "cookpool"; veg.kind = "use"; veg.input = null; veg.category = null;

function send(res: Any, status: number, data: unknown, raw?: string) {
  if (raw !== undefined) { res.writeHead(status, { "content-type": "text/csv" }); res.end(raw); return; }
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(status < 400 ? { data, meta: { requestId: "req_mock", cursor: null } } : { error: { code: status === 404 ? "not_found" : status === 409 ? "conflict" : "validation_failed", message: "Mock refusal", details: data, requestId: "req_mock" } }));
}

createServer(async (req, res) => {
  const url = new URL(req.url!, "http://x");
  const p = url.pathname;
  const m = req.method!;
  let body: Any = {};
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  if (chunks.length) try { body = JSON.parse(Buffer.concat(chunks).toString()); } catch { /* none */ }
  const auth = req.headers.authorization ?? "";
  const me = auth.startsWith("Bearer dev_") ? auth.slice(11) : null;
  const user = { id: ME, email: "you@spliteco.test", displayName: people[ME] };
  if (p === "/v1/auth/login/start") return send(res, 200, { challengeId: "chl_1", expiresAt: now(), delivery: { mode: "local_debug", emailHint: body.email, code: "123456" } });
  if (p === "/v1/auth/login/complete") return body.code === "123456" ? send(res, 200, { token: `dev_${ME}`, tokenType: "bearer", expiresAt: now(), user }) : send(res, 401, { reason: "bad_code" });
  if (!me) return send(res, 401, {});
  if (p === "/v1/auth/profile" && m === "PATCH") { people[ME] = body.displayName ?? "Ravi"; return send(res, 200, { user: { ...user, displayName: people[ME] } }); }
  if (p === "/v1/auth/profile" || p === "/v1/auth/session") return send(res, 200, { user, session: { id: "s", expiresAt: now(), createdAt: now() } });
  if (p === "/v1/auth/logout") return send(res, 200, { success: true });
  let r: RegExpMatchArray | null;
  if ((r = p.match(/^\/v1\/organizations\/([^/]+)\/join-code$/))) return send(res, 200, { code: g(r[1]!)!.code });
  if (p === "/v1/join") { const gr = groups.find((x) => x.code === body.code); if (!gr) return send(res, 404, {}); if (!gr.members.includes(me)) gr.members.push(me); return send(res, 201, { orgId: gr.id, slug: gr.id, memberId: "m", alreadyMember: false }); }
  if (p === "/v1/spliteco/me/home") {
    const sums = mine(me).map((x) => balances(engine(x.id)).get(me) ?? 0);
    const fr = friends(me).filter((f) => f.balances.length);
    return send(res, 200, { me: person(me), totals: [{ currency: "INR", owedToYouMinor: sums.filter((s) => s > 0).reduce((a, b) => a + b, 0), youOweMinor: -sums.filter((s) => s < 0).reduce((a, b) => a + b, 0), netMinor: sums.reduce((a, b) => a + b, 0) }], people: fr });
  }
  if (p === "/v1/spliteco/me/groups") return send(res, 200, { groups: mine(me).filter((x) => x.kind !== "direct").map((x) => groupSummary(x, me)), friends: friends(me) });
  if (p === "/v1/spliteco/groups" && m === "POST") { const gr = { id: id("org"), name: body.name, kind: body.kind, madeIn: "spliteco", members: [me], code: "NEW" + seq }; groups.push(gr); return send(res, 201, { group: groupSummary(gr, me) }); }
  if (p === "/v1/spliteco/me/activity") return send(res, 200, activity(me, mine(me).map((x) => x.id)));
  if ((r = p.match(/^\/v1\/spliteco\/me\/friends\/([^/]+)\/direct$/))) {
    const f = r[1]!;
    let gr = groups.find((x) => x.kind === "direct" && x.members.includes(f) && x.members.includes(me));
    if (!gr) { gr = { id: id("org"), name: "Direct", kind: "direct", madeIn: "spliteco", members: [me, f], code: "DIR" }; groups.push(gr); }
    return send(res, 200, { group: groupSummary(gr, me) });
  }
  if ((r = p.match(/^\/v1\/spliteco\/me\/friends\/([^/]+)$/))) {
    const f = r[1]!;
    const shared = mine(me).filter((x) => x.members.includes(f));
    const byGroup = shared.map((gr) => ({ groupId: gr.id, groupName: gr.name, kind: gr.kind, currency: "INR", amountMinor: pairLines(engine(gr.id)).reduce((s, l) => s + (l.creditorId === me && l.debtorId === f ? l.amountMinor : l.creditorId === f && l.debtorId === me ? -l.amountMinor : 0), 0) })).filter((x) => x.amountMinor !== 0 || x.kind !== "direct");
    const tot = byGroup.reduce((s, x) => s + x.amountMinor, 0);
    return send(res, 200, { friend: person(f), balances: [{ currency: "INR", amountMinor: tot }], byGroup, directGroupId: shared.find((x) => x.kind === "direct")?.id ?? null, expenses: current().filter((t) => shared.some((x) => x.id === t.org) && t.splits.some((s) => s.subjectId === f) && t.splits.some((s) => s.subjectId === me)).map((t) => summary(t, me)).reverse() });
  }
  if ((r = p.match(/^\/v1\/spliteco\/groups\/([^/]+)\/expenses$/)) && m === "POST") { const t = post(r[1]!, body, me); return "error" in t ? send(res, 422, { reason: "does_not_add_up", problems: t.error }) : send(res, 201, { expense: summary(t as T, me) }); }
  if ((r = p.match(/^\/v1\/spliteco\/groups\/([^/]+)\/export\.(csv|json)$/))) {
    const rows = current(r[1]).map((t) => summary(t, me));
    if (r[2] === "csv") return send(res, 200, null, ["Date,Title,Total", ...rows.map((x) => `${x.occurredAt.slice(0, 10)},${x.title},${x.totalMinor / 100}`)].join("\n"));
    return send(res, 200, { exportedAt: now(), group: groupSummary(g(r[1]!)!, me), expenses: rows });
  }
  if ((r = p.match(/^\/v1\/spliteco\/groups\/([^/]+)\/activity$/))) return send(res, 200, activity(me, [r[1]!]));
  if ((r = p.match(/^\/v1\/spliteco\/groups\/([^/]+)$/))) {
    const gr = g(r[1]!);
    if (!gr) return send(res, 404, {});
    const bal = balances(engine(gr.id));
    return send(res, 200, { group: groupSummary(gr, me), members: gr.members.map((s) => ({ ...person(s), role: "owner" })), balances: [...bal].map(([subjectId, balanceMinor]) => ({ subjectId, balanceMinor })), plan: settlePlan(engine(gr.id)).payments.map((x) => ({ fromSubjectId: x.fromId, toSubjectId: x.toId, amountMinor: x.amountMinor })), buckets: gr.madeIn === "cookpool" ? (["kitchen", "other"] as const).map((b) => ({ bucket: b, balances: [...balances(engineIn(gr.id, b))].map(([subjectId, balanceMinor]) => ({ subjectId, balanceMinor })), plan: settlePlan(engineIn(gr.id, b)).payments.map((x) => ({ fromSubjectId: x.fromId, toSubjectId: x.toId, amountMinor: x.amountMinor })), myBalanceMinor: balances(engineIn(gr.id, b)).get(me) ?? 0 })) : null, totalSpentMinor: current(gr.id).reduce((s, t) => s + t.total, 0), expenses: current(gr.id).map((t) => summary(t, me)).sort((a, b) => b.occurredAt.localeCompare(a.occurredAt)), people: [], canWrite: true });
  }
  if ((r = p.match(/^\/v1\/spliteco\/expenses\/([^/]+)(\/[a-z]+)?$/))) {
    const t = txns.find((x) => x.id === r![1]);
    if (!t) return send(res, 404, {});
    const sub = r[2];
    if (!sub && m === "GET") return send(res, 200, detail(t, me));
    if (t.app === "cookpool" && sub !== "/comments") return send(res, 409, { reason: "owned_by_cookpool" });
    if (sub === "/comments") { const c = { id: id("cmt"), txnId: t.id, subjectId: me, body: body.body, createdAt: now() }; comments.push(c); return send(res, 201, { comment: c }); }
    if (sub === "/restore") { const rv = reversalOf(t); if (!rv?.deletedAt) return send(res, 409, { reason: "not_deleted" }); const n = post(t.org, t.input, me, { revises: t.id }) as T; return send(res, 201, { expense: summary(n, me) }); }
    if (reversalOf(t)) return send(res, 409, { reason: "not_current" });
    if (!sub && m === "DELETE") { const rv = reverse(t, me, true); return send(res, 200, { expense: summary(rv, me) }); }
    if (!sub && m === "PUT") { const check = buildSplitecoSplits(body.totalMinor, body.payers, toSpec(body.split)); if (!check.ok) return send(res, 422, { reason: "does_not_add_up" }); reverse(t, me); const n = post(t.org, body, me, { revises: t.id }) as T; return send(res, 200, { expense: summary(n, me) }); }
    if (sub === "/move") { const to = g(body.toGroupId); if (!to) return send(res, 404, {}); const missing = t.splits.map((s) => s.subjectId).filter((s) => !to.members.includes(s)); if (missing.length) return send(res, 409, { reason: "not_members", subjectIds: missing }); reverse(t, me); const n = post(to.id, t.input, me, { movedFrom: t.id }) as T; return send(res, 201, { expense: summary(n, me) }); }
  }
  if (p === "/v1/spliteco/insights") {
    const month = url.searchParams.get("month") ?? now().slice(0, 7);
    const orgs = url.searchParams.get("groupId") ? [url.searchParams.get("groupId")!] : mine(me).map((x) => x.id);
    const rows = current().filter((t) => orgs.includes(t.org) && t.kind !== "settlement");
    const inMonth = (t: T, mo: string) => t.at.slice(0, 7) === mo;
    const share = (t: T) => t.splits.find((s) => s.subjectId === me)?.owedMinor ?? 0;
    const cats = new Map<string, number>();
    const payers = new Map<string, number>();
    for (const t of rows.filter((x) => inMonth(x, month))) {
      const c = t.app === "cookpool" && t.kind !== "expense" ? "cookpool" : (t.category ?? "other");
      if (share(t)) cats.set(c, (cats.get(c) ?? 0) + share(t));
      for (const s of t.splits) if (s.paidMinor) payers.set(s.subjectId, (payers.get(s.subjectId) ?? 0) + s.paidMinor);
    }
    const months: string[] = [];
    const [y, mm] = month.split("-").map(Number) as [number, number];
    for (let i = 5; i >= 0; i--) { const d = new Date(Date.UTC(y, mm - 1 - i, 1)); months.push(d.toISOString().slice(0, 7)); }
    const monthShare = (mo: string) => rows.filter((t) => inMonth(t, mo)).reduce((s, t) => s + share(t), 0);
    return send(res, 200, { groupId: url.searchParams.get("groupId"), month, currency: "INR", currencies: ["INR"], byCategory: [...cats].map(([category, amountMinor]) => ({ category, amountMinor })), byPayer: [...payers].map(([subjectId, amountMinor]) => ({ subjectId, amountMinor })), byMonth: months.map((mo) => ({ month: mo, amountMinor: monthShare(mo) })), myShareMinor: monthShare(month), myPaidMinor: rows.filter((t) => inMonth(t, month)).reduce((s, t) => s + (t.splits.find((x) => x.subjectId === me)?.paidMinor ?? 0), 0), expenseCount: rows.filter((t) => inMonth(t, month)).length, previousMonthShareMinor: monthShare(months[4]!), biggest: rows.filter((t) => inMonth(t, month)).sort((a, b) => b.total - a.total).slice(0, 3).map((t) => ({ expense: summary(t, me), myShareMinor: share(t) })), people: Object.keys(people).map(person) });
  }
  void owedBySplit;
  send(res, 404, { reason: "mock_route_missing", path: p });
}).listen(8787, () => console.log("mock API on :8787"));
