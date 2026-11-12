// Insights and export (design §2):
//
//   GET /v1/spliteco/insights?groupId&month&currency   by category, by payer, by month
//   GET /v1/spliteco/groups/{org}/export.csv           one row per expense, a column per person
//   GET /v1/spliteco/groups/{org}/export.json          everything in the group, as data
//
// Both count only rows in effect (edited, deleted and moved versions drop
// out). Insights count spending — expenses and Cookpool's uses, dishes and
// waste — never settlements, in one currency at a time.

import {
  isSplitecoMonth,
  type SplitecoCategory,
  type SplitecoExport,
  type SplitecoInsightsResponse,
} from "@saas/contracts/spliteco";
import type { Uuid } from "@saas/db/ids";
import type { SplitecoTxnRecord } from "@saas/db/spliteco";
import { requireOrgAction } from "../authz.js";
import type { RequestContext } from "../context.js";
import { notFound, successResponse, unavailable, validationError } from "../http.js";
import { parseOrgPublicId } from "../ids.js";
import { currencyOf, groupBalances, groupLabel, isCurrent, peopleOn, toSummary, withRepo } from "../ledger.js";

const monthOf = (iso: string): string => iso.slice(0, 7);

function shiftMonth(month: string, by: number): string {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const d = new Date(Date.UTC(y, m - 1 + by, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

function categoryOf(t: SplitecoTxnRecord): SplitecoCategory | "cookpool" {
  if (t.app === "cookpool" && !t.category) return "cookpool";
  return (t.category as SplitecoCategory | null) ?? "other";
}

export async function handleInsights(ctx: RequestContext, url: URL): Promise<Response> {
  const groupParam = url.searchParams.get("groupId");
  const month = url.searchParams.get("month") ?? monthOf(ctx.now().toISOString());
  if (!isSplitecoMonth(month)) return validationError(ctx.requestId, { month: ["Must be a month as YYYY-MM"] });
  const asked = url.searchParams.get("currency");
  if (asked !== null && !/^[A-Z]{3}$/.test(asked)) return validationError(ctx.requestId, { currency: ["Must be a three-letter code"] });
  let groupId: string | null = null;
  if (groupParam) {
    groupId = parseOrgPublicId(groupParam);
    if (!groupId) return notFound(ctx.requestId);
    const denied = await requireOrgAction(ctx, groupId as Uuid, "spliteco.ledger.read");
    if (denied) return denied;
  }
  return withRepo(ctx, async (repo) => {
    const mine = await ctx.timings.measure("membership", () => ctx.groups.of(ctx.actor.subjectId));
    if (!mine.ok) return unavailable(ctx.requestId);
    const groups = groupId ? mine.groups.filter((g) => g.orgId === groupId) : mine.groups;
    if (groupId && groups.length === 0) return notFound(ctx.requestId);
    const byOrg = new Map<string, (typeof groups)[number]>(groups.map((g) => [g.orgId, g]));
    const rows = await ctx.timings.measure("db", () => repo.listTxns(groups.map((g) => g.orgId)));
    const me = ctx.actor.subjectId;
    const spending = rows.filter((t) => isCurrent(t) && t.kind !== "settlement");

    const counts = new Map<string, number>();
    for (const t of spending) counts.set(t.currency, (counts.get(t.currency) ?? 0) + 1);
    const currencies = [...counts.keys()].sort();
    const currency = asked ?? ([...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "INR");
    const inCurrency = spending.filter((t) => t.currency === currency);
    const owed = (t: SplitecoTxnRecord) => t.splits.find((s) => s.subjectId === me)?.owedMinor ?? 0;
    const paid = (t: SplitecoTxnRecord) => t.splits.find((s) => s.subjectId === me)?.paidMinor ?? 0;
    const thisMonth = inCurrency.filter((t) => monthOf(t.occurredAt) === month);

    const byCategory = new Map<SplitecoCategory | "cookpool", number>();
    const byPayer = new Map<string, number>();
    for (const t of thisMonth) {
      const share = owed(t);
      if (share > 0) byCategory.set(categoryOf(t), (byCategory.get(categoryOf(t)) ?? 0) + share);
      for (const s of t.splits) if (s.paidMinor > 0) byPayer.set(s.subjectId, (byPayer.get(s.subjectId) ?? 0) + s.paidMinor);
    }
    const byMonth = [-5, -4, -3, -2, -1, 0].map((by) => {
      const m = shiftMonth(month, by);
      return { month: m, amountMinor: inCurrency.filter((t) => monthOf(t.occurredAt) === m).reduce((s, t) => s + owed(t), 0) };
    });
    const previous = shiftMonth(month, -1);
    const biggest = thisMonth
      .filter((t) => t.splits.some((s) => s.subjectId === me))
      .sort((a, b) => b.totalMinor - a.totalMinor)
      .slice(0, 3)
      .map((t) => ({ expense: toSummary(t, groupLabel(byOrg.get(t.orgId)), me), myShareMinor: owed(t) }));
    const ids = [...byPayer.keys()];
    const names = await ctx.people.names(ids);
    return successResponse<SplitecoInsightsResponse>(
      {
        groupId: groupParam,
        month,
        currency,
        currencies,
        byCategory: [...byCategory.entries()].map(([category, amountMinor]) => ({ category, amountMinor })).sort((a, b) => b.amountMinor - a.amountMinor),
        byPayer: [...byPayer.entries()].map(([subjectId, amountMinor]) => ({ subjectId, amountMinor })).sort((a, b) => b.amountMinor - a.amountMinor),
        byMonth,
        myShareMinor: thisMonth.reduce((s, t) => s + owed(t), 0),
        myPaidMinor: thisMonth.reduce((s, t) => s + paid(t), 0),
        expenseCount: thisMonth.length,
        previousMonthShareMinor: inCurrency.filter((t) => monthOf(t.occurredAt) === previous).reduce((s, t) => s + owed(t), 0),
        biggest,
        people: ids.map((subjectId) => ({ subjectId, name: names.get(subjectId) ?? null })),
      },
      ctx.requestId,
    );
  });
}

/** A CSV cell: quoted when needed, and text a spreadsheet would run as a formula made inert. */
export function csvCell(value: string | number): string {
  if (typeof value === "number") return String(value);
  let v = value;
  if (/^[=+\-@\t\r]/.test(v)) v = `'${v}`;
  return /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

const major = (minor: number): string => {
  const sign = minor < 0 ? "-" : "";
  const abs = Math.abs(minor);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
};

export async function handleExport(ctx: RequestContext, orgParam: string, format: "csv" | "json"): Promise<Response> {
  const orgId = parseOrgPublicId(orgParam);
  if (!orgId) return notFound(ctx.requestId);
  const denied = await requireOrgAction(ctx, orgId, "spliteco.ledger.read");
  if (denied) return denied;
  return withRepo(ctx, async (repo) => {
    const mine = await ctx.timings.measure("membership", () => ctx.groups.of(ctx.actor.subjectId));
    if (!mine.ok) return unavailable(ctx.requestId);
    const group = mine.groups.find((g) => g.orgId === orgId);
    if (!group) return notFound(ctx.requestId);
    const [rows, currencies] = await Promise.all([repo.listTxns([orgId]), repo.currencies([orgId])]);
    const current = rows.filter(isCurrent);
    const currency = currencyOf(currencies, orgId);
    const memberIds = group.members.map((m) => m.subjectId);
    const everyone = [...new Set([...memberIds, ...peopleOn(current)])];
    const names = await ctx.people.names(everyone);
    const label = groupLabel(group);
    const nameOf = (id: string) => names.get(id) ?? id;
    const balances = groupBalances(rows);
    const slug = group.slug.replace(/[^a-z0-9-]/gi, "") || "group";
    const stamp = ctx.now().toISOString().slice(0, 10);

    if (format === "json") {
      const details = await repo.items(current.map((t) => t.id));
      const body: SplitecoExport = {
        exportedAt: ctx.now().toISOString(),
        group: { id: group.publicId, name: label, kind: group.kind, madeIn: group.madeIn, currency },
        members: memberIds.map((subjectId) => ({ subjectId, name: names.get(subjectId) ?? null })),
        balances: everyone.map((subjectId) => ({ subjectId, balanceMinor: balances.get(subjectId) ?? 0 })),
        expenses: current.map((t) => ({
          ...toSummary(t, label, ctx.actor.subjectId),
          note: t.note,
          items: details.items
            .filter((i) => i.txnId === t.id)
            .map((i) => ({
              position: i.position,
              name: i.name,
              qty: i.qty,
              unitMinor: i.unitMinor,
              totalMinor: i.totalMinor,
              shares: details.shares
                .filter((s) => s.txnId === t.id && s.itemPosition === i.position)
                .map((s) => ({ subjectId: s.subjectId, mode: s.mode, value: s.value, amountMinor: 0 })),
            })),
          adjustments: details.adjustments.filter((a) => a.txnId === t.id).map((a) => ({ kind: a.kind, label: a.label, amountMinor: a.amountMinor })),
        })),
      };
      return successResponse(body, ctx.requestId);
    }

    // CSV: Date, Title, Category, Kind, Total, Currency, then each person's net (paid − owed).
    const header = ["Date", "Title", "Category", "Kind", "Total", "Currency", ...everyone.map(nameOf)];
    const lines = [header.map(csvCell).join(",")];
    for (const t of current) {
      const net = new Map(t.splits.map((s) => [s.subjectId, s.paidMinor - s.owedMinor]));
      lines.push(
        [
          t.occurredAt.slice(0, 10),
          t.title,
          t.category ?? (t.app === "cookpool" ? "cookpool" : ""),
          t.kind,
          major(t.totalMinor),
          t.currency,
          ...everyone.map((id) => major(net.get(id) ?? 0)),
        ]
          .map((v, i) => (i >= 4 && i !== 5 ? v : csvCell(v)))
          .join(","),
      );
    }
    lines.push(["", "Total balance", "", "", "", currency, ...everyone.map((id) => major(balances.get(id) ?? 0))].map((v, i) => (i >= 6 ? v : csvCell(v))).join(","));
    return new Response(lines.join("\r\n") + "\r\n", {
      status: 200,
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="spliteco-${slug}-${stamp}.csv"`,
        "x-request-id": ctx.requestId,
      },
    });
  });
}

