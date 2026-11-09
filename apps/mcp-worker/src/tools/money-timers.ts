// balances (money.read) and the timers (timers.write), design §2.
//
// Balances only read: nothing here moves money, and api-edge refuses every
// money write to a delegated token whatever its scopes (MC-2). A timer is
// the one thing an assistant may set directly: it rings on the person's
// phone through the kitchen's per-minute sweep (GC-3).

import { z } from "zod";
import {
  KITCHEN_TIMER_BODY_MAX,
  KITCHEN_TIMER_LABEL_MAX,
  type KitchenTimer,
  type KitchenTimerResponse,
  type KitchenTimersResponse,
  type MyBalancesResponse,
} from "@saas/contracts/kitchen";
import { listNames, minutesUntil, money, plural } from "../format.js";
import { defineTool, edge } from "./types.js";

/** The longest timer an assistant may set (design §2): ten hours. */
export const TIMER_MAX_MINUTES = 600;
/** The shortest: the sweep runs once a minute, and the server takes nothing under 30 s. */
export const TIMER_MIN_MINUTES = 1;

const TIMER_ID_RE = /^tmr_[A-Za-z0-9]{1,64}$/;

// ── balances ───────────────────────────────────────────────

export const balances = defineTool({
  name: "balances",
  scope: "money.read",
  title: "Balances",
  description:
    "What the person is owed and owes across their Cookpool groups, per group and per person, in each group's currency. Read only.",
  readOnly: true,
  inputSchema: {},
  async run(_args, ctx) {
    const res = await edge<MyBalancesResponse>(ctx, { method: "GET", path: "/v1/kitchen/me/balances" });
    if (!res.ok) return res;
    const totals = res.data.totals.map((t) => ({
      currency: t.currency,
      owedToYou: money(t.owedToYouMinor, t.currency),
      youOwe: money(t.youOweMinor, t.currency),
      net: money(t.netMinor, t.currency),
    }));
    const groups = res.data.groups.map((g) => ({
      id: g.orgId,
      name: g.name,
      balance: money(g.balanceMinor, g.currency),
      getsBack: g.balanceMinor > 0,
    }));
    const people = res.data.people
      .map((p) => ({
        id: p.subjectId,
        name: p.displayName ?? "Someone",
        // Positive: they pay you; negative: you pay them.
        groups: p.groups
          .filter((g) => g.netMinor !== 0)
          .map((g) => ({ group: g.name, theyPayYou: g.netMinor > 0, amount: money(Math.abs(g.netMinor), g.currency) })),
      }))
      .filter((p) => p.groups.length > 0);
    const owed = res.data.totals.filter((t) => t.owedToYouMinor > 0).map((t) => money(t.owedToYouMinor, t.currency));
    const owe = res.data.totals.filter((t) => t.youOweMinor > 0).map((t) => money(t.youOweMinor, t.currency));
    const summary =
      owed.length === 0 && owe.length === 0
        ? "All settled: nothing owed either way."
        : [owed.length > 0 ? `You're owed ${owed.join(" + ")}` : "", owe.length > 0 ? `you owe ${owe.join(" + ")}` : ""]
            .filter(Boolean)
            .join(" and ")
            .replace(/^you/, "You") + ".";
    return { summary, data: { totals, groups, people } };
  },
});

// ── timers ─────────────────────────────────────────────────

function timerRow(t: KitchenTimer, now: number) {
  return { id: t.id, label: t.label, note: t.body, endsAt: t.endsAt, minutesLeft: minutesUntil(t.endsAt, now) };
}

export const timerStart = defineTool({
  name: "timer_start",
  scope: "timers.write",
  title: "Start a timer",
  description: `Sets a kitchen timer that rings on the person's phone when it ends (within a minute). ${TIMER_MIN_MINUTES} to ${TIMER_MAX_MINUTES} minutes.`,
  readOnly: false,
  inputSchema: {
    label: z.string().trim().min(1).max(KITCHEN_TIMER_LABEL_MAX).describe('What it is for, shown on the phone: "Rice"'),
    minutes: z.number().min(TIMER_MIN_MINUTES).max(TIMER_MAX_MINUTES).describe("How long, in minutes"),
    note: z.string().trim().min(1).max(KITCHEN_TIMER_BODY_MAX).optional().describe('A line under it: "Turn off the gas"'),
  },
  async run(args, ctx) {
    const endsAt = new Date(ctx.now + Math.round(args.minutes * 60) * 1000).toISOString();
    const res = await edge<KitchenTimerResponse>(ctx, {
      method: "POST",
      path: "/v1/kitchen/me/timers",
      body: { label: args.label, endsAt, ...(args.note ? { body: args.note } : {}) },
    });
    if (!res.ok) return res;
    const timer = timerRow(res.data.timer, ctx.now);
    return { summary: `Timer "${timer.label}" set: it rings on the phone in ${plural(timer.minutesLeft, "minute")}.`, data: { timer } };
  },
});

export const timerList = defineTool({
  name: "timer_list",
  scope: "timers.write",
  title: "List timers",
  description: "The person's kitchen timers that are still running, soonest first.",
  readOnly: true,
  inputSchema: {},
  async run(_args, ctx) {
    const res = await edge<KitchenTimersResponse>(ctx, { method: "GET", path: "/v1/kitchen/me/timers" });
    if (!res.ok) return res;
    const timers = res.data.timers.map((t) => timerRow(t, ctx.now));
    const summary =
      timers.length === 0
        ? "No timers running."
        : `${plural(timers.length, "timer")} running: ${listNames(timers.map((t) => `${t.label} (${t.minutesLeft} min)`))}.`;
    return { summary, data: { timers } };
  },
});

export const timerCancel = defineTool({
  name: "timer_cancel",
  scope: "timers.write",
  title: "Cancel a timer",
  description: "Cancels one of the person's running kitchen timers, so it doesn't ring.",
  readOnly: false,
  inputSchema: {
    timerId: z.string().regex(TIMER_ID_RE).describe("The timer's id (tmr_…) from timer_start or timer_list"),
  },
  async run(args, ctx) {
    const res = await edge<KitchenTimerResponse>(ctx, {
      method: "DELETE",
      path: `/v1/kitchen/me/timers/${encodeURIComponent(args.timerId)}`,
    });
    if (!res.ok) return res;
    const timer = timerRow(res.data.timer, ctx.now);
    return { summary: `Cancelled "${timer.label}".`, data: { timer: { id: timer.id, label: timer.label } } };
  },
});

export const MONEY_TOOLS = [balances];
export const TIMER_TOOLS = [timerStart, timerList, timerCancel];
