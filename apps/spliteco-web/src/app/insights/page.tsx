"use client";

import * as React from "react";
import Link from "next/link";
import type { SplitecoInsightsResponse } from "@saas/contracts/spliteco";
import { Icon } from "@/components/icons";
import { BackButton, Loading, Screen, useLoad, useQueryParam } from "@/components/ui";
import { formatMoney, formatShort } from "@/lib/money";
import { nameOf, namesFrom } from "@/lib/people";
import { CATEGORY_LABELS, periodLabel } from "@/lib/activity-text";
import { CHART_COLORS, barHeights, changePct, compactAmount, donutSegments, monthOf, percentLabels } from "@/lib/charts";
import { useMe } from "@/lib/me";

export default function InsightsPage() {
  const groupParam = useQueryParam("group");
  const [groupId, setGroupId] = React.useState<string | null | undefined>(undefined);
  const [month, setMonth] = React.useState(() => monthOf(new Date()));
  React.useEffect(() => {
    setGroupId(groupParam ?? null);
  }, [groupParam]);
  const groups = useLoad((c) => c.spliteco.groups(), []);
  const load = useLoad(
    (c) => (groupId === undefined ? new Promise<never>(() => undefined) : c.spliteco.insights({ ...(groupId ? { groupId } : {}), month })),
    [groupId, month],
  );
  const { me } = useMe();
  return (
    <Screen nav={false}>
      <header className="hdr">
        <BackButton label="Back" />
        <div className="hdr-title"><h1 style={{ fontSize: 20, fontWeight: 600 }}>Insights</h1></div>
        {groupId ? (
          <Link href={`/share?group=${encodeURIComponent(groupId)}`} className="iconbtn" aria-label="Export to CSV">
            <Icon name="download" />
          </Link>
        ) : (
          <span style={{ width: 44 }} />
        )}
      </header>
      <div className="grid2" style={{ gap: 8 }}>
        <label className="field" style={{ padding: "0 10px" }}>
          <span className="sr">Group</span>
          <select value={groupId ?? ""} onChange={(e) => setGroupId(e.target.value || null)} style={{ fontSize: 14, fontWeight: 500, background: "var(--surface)" }}>
            <option value="">All groups</option>
            {(groups.data?.groups ?? []).map((g) => (
              <option key={g.id} value={g.id}>{g.name}</option>
            ))}
          </select>
        </label>
        <label className="field" style={{ padding: "0 10px" }}>
          <span className="sr">Month</span>
          <input type="month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} style={{ fontSize: 14, fontWeight: 500 }} />
        </label>
      </div>
      <Loading load={load}>{load.data ? <Insights data={load.data} me={me?.id ?? null} groupName={groups.data?.groups.find((g) => g.id === groupId)?.name ?? null} /> : null}</Loading>
    </Screen>
  );
}

const R = 80;
const C = 2 * Math.PI * R;

function Donut({ title, subtitle, slices, totalLabel, currency }: { title: string; subtitle: string; slices: { name: string; value: number }[]; totalLabel: string; currency: string }) {
  const [pick, setPick] = React.useState(-1);
  const segs = donutSegments(slices.map((s) => s.value), C);
  const pcts = percentLabels(slices.map((s) => s.value));
  const total = slices.reduce((s, x) => s + x.value, 0);
  const sel = pick >= 0 ? slices[pick] : null;
  return (
    <section aria-label={title} className="panel" style={{ gap: 14 }}>
      <div className="stack" style={{ gap: 2, alignItems: "center", textAlign: "center" }}>
        <span style={{ fontSize: 16, fontWeight: 500 }}>{title}</span>
        <span className="small dim">{subtitle}</span>
      </div>
      {total === 0 ? (
        <p className="empty">Nothing this month.</p>
      ) : (
        <>
          <div className="donut-wrap">
            <svg viewBox="0 0 220 220" width="220" height="220" role="img" aria-label={`${title}: ${slices.map((s) => `${s.name} ${formatShort(s.value, currency)}`).join(", ")}`}>
              <circle cx="110" cy="110" r={R} fill="none" stroke="var(--raised)" strokeWidth="26" />
              {segs.map((s, i) => (
                <circle
                  key={slices[i]!.name}
                  cx="110"
                  cy="110"
                  r={R}
                  fill="none"
                  stroke={CHART_COLORS[i % CHART_COLORS.length]}
                  strokeWidth={pick === i ? 32 : 26}
                  strokeDasharray={s.dash}
                  strokeDashoffset={s.offset}
                  transform="rotate(-90 110 110)"
                  opacity={pick === -1 || pick === i ? 1 : 0.35}
                  onClick={() => setPick(pick === i ? -1 : i)}
                />
              ))}
            </svg>
            <div className="donut-center">
              <span style={{ fontSize: 24, fontWeight: 600 }}>{formatShort(sel ? sel.value : total, currency)}</span>
              <span className="small dim">{sel ? sel.name : totalLabel}</span>
            </div>
          </div>
          <div className="legend">
            {slices.map((s, i) => (
              <button key={s.name} aria-pressed={pick === i} onClick={() => setPick(pick === i ? -1 : i)} style={{ color: CHART_COLORS[i % CHART_COLORS.length] }}>
                <span style={{ width: 10, height: 10, borderRadius: 3, background: CHART_COLORS[i % CHART_COLORS.length], flex: "none" }} />
                <span className="stack" style={{ gap: 1, minWidth: 0, color: "var(--text)" }}>
                  <span className="ellipsis" style={{ fontSize: 13, fontWeight: 500 }}>{s.name}</span>
                  <span className="small dim">{formatShort(s.value, currency)} · {pcts[i]}%</span>
                </span>
              </button>
            ))}
          </div>
        </>
      )}
    </section>
  );
}

function Insights({ data, me, groupName }: { data: SplitecoInsightsResponse; me: string | null; groupName: string | null }) {
  const names = namesFrom(data.people);
  const cur = data.currency;
  const heights = barHeights(data.byMonth.map((m) => m.amountMinor), 180);
  const change = changePct(data.myShareMinor, data.previousMonthShareMinor);
  return (
    <>
      <Donut
        title="Where your money went"
        subtitle={`Your share · ${periodLabel(data.month, true)} · tap a slice`}
        slices={data.byCategory.map((c) => ({ name: CATEGORY_LABELS[c.category], value: c.amountMinor }))}
        totalLabel="your share"
        currency={cur}
      />
      <Donut
        title={groupName ? `Who paid for ${groupName}` : "Who paid"}
        subtitle="Paid out of pocket · tap a slice"
        slices={data.byPayer.map((p) => ({ name: nameOf(names, p.subjectId, me), value: p.amountMinor }))}
        totalLabel="paid in all"
        currency={cur}
      />
      <section aria-label="Month by month" className="panel">
        <div className="stack" style={{ gap: 2, alignItems: "center" }}>
          <span style={{ fontSize: 16, fontWeight: 500 }}>Month by month</span>
          <span className="small dim">Your share, last 6 months</span>
        </div>
        <div
          className="bars"
          role="img"
          aria-label={`Your share by month: ${data.byMonth.map((m) => `${periodLabel(m.month)} ${formatShort(m.amountMinor, cur)}`).join("; ")}`}
        >
          {data.byMonth.map((m, i) => {
            const last = i === data.byMonth.length - 1;
            return (
              <div key={m.month}>
                <span className="small" style={{ color: last ? "var(--text)" : "var(--dim)", fontWeight: 500 }}>{compactAmount(m.amountMinor)}</span>
                <div className="col" style={{ height: heights[i], background: last ? "#60A5FA" : "var(--line-strong)" }} />
                <span className="small" style={{ color: last ? "var(--text)" : "var(--dim)" }}>{periodLabel(m.month)}</span>
              </div>
            );
          })}
        </div>
      </section>
      <div className="grid2" style={{ gap: 8 }}>
        <div className="stat"><span className="label">Your share</span><span className="value money">{formatShort(data.myShareMinor, cur)}</span></div>
        <div className="stat"><span className="label">You paid</span><span className="value">{formatShort(data.myPaidMinor, cur)}</span></div>
        <div className="stat"><span className="label">Expenses</span><span className="value">{data.expenseCount}</span></div>
        <div className="stat">
          <span className="label">vs last month</span>
          <span className={`value ${change !== null && change > 0 ? "owe" : "get"}`}>{change === null ? "—" : `${change > 0 ? "+" : ""}${change}%`}</span>
        </div>
      </div>
      {data.biggest.length > 0 ? (
        <section aria-label="Biggest expenses" className="list">
          <h2 className="eyebrow">Biggest this month</h2>
          {data.biggest.map((b) => (
            <Link key={b.expense.id} href={`/expense?id=${encodeURIComponent(b.expense.id)}`} className="lrow">
              <span className="main">
                <span className="title">{b.expense.title}</span>
                <span className="sub">{formatMoney(b.expense.totalMinor, cur)} · {b.expense.groupName}{b.expense.app === "cookpool" ? " · Cookpool" : ""}</span>
              </span>
              <span className="money bold">{formatShort(b.myShareMinor, cur)} yours</span>
            </Link>
          ))}
        </section>
      ) : null}
      {data.currencies.length > 1 ? <p className="note">Counted in {cur}. Other currencies are never added in.</p> : null}
    </>
  );
}
