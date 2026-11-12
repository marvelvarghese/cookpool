// The Live split screen as data (cookpool-spliteco SE4): the draft a live
// split opens from (the Itemized form, who paid, and the shares already set),
// and what the screen shows of a session — the claimed bar, each item's
// claimers, "I had this", who is here and the ticker. Pure.

import {
  SPLITECO_PORTION_SCALE,
  formatLiveCode,
  type SplitecoLiveOpenRequest,
  type SplitecoLiveSession,
} from "@saas/contracts/spliteco";
import { timeAgo } from "./activity-text";
import { formatShort } from "./money";
import { nameOf, type Names } from "./people";
import { adjustmentAmount, defaultAdjustmentLabel, itemTotal, itemsSubtotal, payersOf, totalOf, type ExpenseForm } from "./split-form";

export type LiveDraftOutcome = { ok: true; request: SplitecoLiveOpenRequest } | { ok: false; why: string };

/** The Itemized form as a live split's draft. Every item needs a price; who had what is optional (it carries over). */
export function liveDraftFrom(form: ExpenseForm): LiveDraftOutcome {
  if (form.method !== "items" || form.items.length === 0) return { ok: false, why: "Add the bill's items first" };
  if (!form.title.trim()) return { ok: false, why: "Say what it was for first" };
  const items: SplitecoLiveOpenRequest["items"] = [];
  for (const it of form.items) {
    const total = itemTotal(it);
    if (total === null || total <= 0) return { ok: false, why: `Add the price of ${it.name.trim() || "every item"}` };
    const qty = Number(it.qtyText);
    items.push({ name: it.name.trim() || "Item", qty: Number.isFinite(qty) && qty > 0 ? qty : 1, totalMinor: total });
  }
  const subtotal = itemsSubtotal(form);
  const adjustments: SplitecoLiveOpenRequest["adjustments"] = [];
  for (const a of form.adjustments) {
    const amount = adjustmentAmount(a, subtotal);
    if (amount === null) return { ok: false, why: "Check the tax and discount lines" };
    if (amount > 0) adjustments.push({ kind: a.kind, label: a.label.trim() || defaultAdjustmentLabel(a), amountMinor: amount });
  }
  const total = totalOf(form) ?? 0;
  if (total <= 0) return { ok: false, why: "The bill comes to nothing" };
  const payers = payersOf(form, total);
  if (payers.reduce((s, p) => s + p.amountMinor, 0) !== total || payers.some((p) => p.amountMinor < 0)) {
    return { ok: false, why: "Who paid must add up to the bill" };
  }
  const claims = form.items.flatMap((it, itemPosition) =>
    form.members.filter((m) => it.shares[m]).map((subjectId) => ({ itemPosition, subjectId, mode: it.shares[subjectId]!.mode, value: it.shares[subjectId]!.value })),
  );
  const request: SplitecoLiveOpenRequest = {
    title: form.title.trim(),
    category: form.category ?? "food",
    occurredAt: `${form.occurredOn}T12:00:00.000Z`,
    payers,
    items,
    adjustments,
  };
  if (form.note.trim()) request.note = form.note.trim();
  if (claims.length > 0) request.claims = claims;
  return { ok: true, request };
}

/** The address a QR code and the invite link open. */
export function liveUrl(origin: string, code: string): string {
  return `${origin.replace(/\/$/, "")}/live/${code}`;
}

export function inviteText(session: Pick<SplitecoLiveSession, "code" | "draft">, origin: string): string {
  return `Claim what you had on "${session.draft.title}" — ${liveUrl(origin, session.code)} (code ${formatLiveCode(session.code)})`;
}

export function claimersOf(session: SplitecoLiveSession, position: number): string[] {
  return session.claims.filter((c) => c.itemPosition === position).map((c) => c.subjectId);
}

export function myClaim(session: SplitecoLiveSession, position: number, me: string | null) {
  return me ? session.claims.find((c) => c.itemPosition === position && c.subjectId === me) ?? null : null;
}

/** "I had this" on an item: one portion for me, or off again. */
export function toggleMine(session: SplitecoLiveSession, position: number, me: string | null): { itemPosition: number; clear?: true; mode?: "portion"; value?: number } {
  return myClaim(session, position, me) ? { itemPosition: position, clear: true } : { itemPosition: position, mode: "portion", value: SPLITECO_PORTION_SCALE };
}

export function unclaimed(session: SplitecoLiveSession): number[] {
  return session.draft.items.map((_, i) => i).filter((i) => claimersOf(session, i).length === 0);
}

/** The bar: "₹3,520 of ₹3,840 claimed" / "₹320 left" / "All claimed". */
export function progress(session: SplitecoLiveSession): { left: string; right: string; ratio: number; done: boolean } {
  const { claimedMinor, itemsMinor, currency } = session;
  const leftMinor = itemsMinor - claimedMinor;
  const done = unclaimed(session).length === 0;
  return {
    left: `${formatShort(claimedMinor, currency)} of ${formatShort(itemsMinor, currency)} claimed`,
    right: done ? "All claimed" : `${formatShort(leftMinor, currency)} left`,
    ratio: itemsMinor > 0 ? Math.min(1, claimedMinor / itemsMinor) : 0,
    done,
  };
}

/** Who is here, then who of the group is not: "You, Anu, Dev here · 1 more in the group". */
export function hereLine(session: SplitecoLiveSession, names: Names, me: string | null): string {
  const here = session.here.map((h) => h.subjectId);
  const ordered = me && here.includes(me) ? [me, ...here.filter((id) => id !== me)] : here;
  const list = ordered.map((id) => nameOf(names, id, me));
  const shown = list.length > 3 ? `${list.slice(0, 3).join(", ")} +${list.length - 3}` : list.join(", ");
  const away = session.members.filter((m) => !here.includes(m.subjectId)).length;
  const head = here.length === 0 ? "Nobody here yet" : `${shown} here`;
  return away > 0 ? `${head} · ${away} more in the group` : head;
}

/** The newest claim, as the ticker under the items says it. */
export function tickerLine(session: SplitecoLiveSession, names: Names, me: string | null, now = new Date()): string | null {
  const latest = [...session.claims].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))[0];
  if (!latest) return null;
  const item = session.draft.items[latest.itemPosition];
  if (!item) return null;
  const who = nameOf(names, latest.subjectId, me);
  return `${who} claimed ${item.name} · ${timeAgo(latest.updatedAt, now)}`;
}

/** What the lock button says, and whether it is on for me. */
export function lockState(session: SplitecoLiveSession, me: string | null): { show: boolean; enabled: boolean; label: string } {
  if (session.state !== "open") return { show: false, enabled: false, label: "" };
  const isOpener = me === session.createdBy;
  const left = unclaimed(session).length;
  if (left > 0) {
    return { show: isOpener, enabled: false, label: `${left} item${left === 1 ? "" : "s"} still unclaimed` };
  }
  return isOpener
    ? { show: true, enabled: true, label: "Everything's claimed — lock the bill" }
    : { show: true, enabled: false, label: "Everything's claimed — waiting for the person who opened it to lock it" };
}

/** Keep polling? Only while the session can still change. */
export function keepPolling(session: Pick<SplitecoLiveSession, "state"> | null): boolean {
  return session === null || session.state === "open";
}
