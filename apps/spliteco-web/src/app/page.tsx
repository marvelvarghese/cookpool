"use client";

import Link from "next/link";
import type { SplitecoHomeResponse } from "@saas/contracts/spliteco";
import { Icon } from "@/components/icons";
import { Avatar, BigMoney, Brand, Loading, Screen, useLoad } from "@/components/ui";
import { formatMoney } from "@/lib/money";
import { friendLine, friendWhere } from "@/lib/view";

export default function HomePage() {
  const load = useLoad((c) => c.spliteco.home(), []);
  return (
    <Screen>
      <header className="hdr">
        <Brand />
        <Link href="/activity" className="iconbtn" aria-label="Activity">
          <Icon name="bell" />
        </Link>
      </header>
      <Loading load={load}>{load.data ? <Home data={load.data} /> : null}</Loading>
    </Screen>
  );
}

function Home({ data }: { data: SplitecoHomeResponse }) {
  const me = data.me.subjectId;
  const total = data.totals.find((t) => t.currency === "INR") ?? data.totals[0] ?? { currency: "INR", owedToYouMinor: 0, youOweMinor: 0, netMinor: 0 };
  const others = data.totals.filter((t) => t !== total && (t.owedToYouMinor || t.youOweMinor));
  const net = total.netMinor;
  return (
    <>
      <section aria-label="Your balance" className="card">
        <div className="stack s4">
          <span className="small muted" style={{ fontSize: 13, fontWeight: 500 }}>
            {net > 0 ? "Overall, you get back" : net < 0 ? "Overall, you owe" : "Overall, you're all square"}
          </span>
          <BigMoney minor={net} currency={total.currency} tone={net > 0 ? "get" : net < 0 ? "owe" : "even"} />
        </div>
        <div className="grid2">
          <div className="tile">
            <span className="label">Owed to you</span>
            <span className="value get">{formatMoney(total.owedToYouMinor, total.currency)}</span>
          </div>
          <div className="tile">
            <span className="label">You owe</span>
            <span className="value owe">{formatMoney(total.youOweMinor, total.currency)}</span>
          </div>
        </div>
        {others.length > 0 ? (
          <p className="note">
            Also: {others.map((t) => `${formatMoney(t.netMinor, t.currency, { sign: true })}`).join(" · ")} — never added across currencies.
          </p>
        ) : null}
        <div className="inline" style={{ flexWrap: "nowrap" }}>
          <Link href="/settle" className="btn flex1">
            <Icon name="swap" size={18} stroke={2} />
            Settle up
          </Link>
          <Link href="/insights" className="btn ghost flex1">
            <Icon name="pie" size={18} stroke={2} color="#FFC857" />
            Insights
          </Link>
        </div>
      </section>

      <nav aria-label="Quick add" className="quick">
        <Link href="/add">
          <Icon name="plus" size={22} color="#FFC857" />
          <span>Expense</span>
        </Link>
        <Link href="/add?method=items">
          <Icon name="list" size={22} color="#FFC857" />
          <span>Itemized</span>
        </Link>
      </nav>

      <section aria-label="Balances with friends" className="stack s4">
        <div className="row-between" style={{ paddingBottom: 4 }}>
          <h2 className="h2">Balances</h2>
          <Link href="/groups?tab=friends" style={{ fontSize: 13, fontWeight: 600, padding: "10px 0" }}>
            See all
          </Link>
        </div>
        {data.people.length === 0 ? (
          <p className="empty">
            Nobody owes anybody yet. <Link href="/add">Add an expense</Link> or <Link href="/groups">make a group</Link>.
          </p>
        ) : (
          <div className="list">
            {data.people.slice(0, 8).map((p) => {
              const line = friendLine(p);
              const name = p.name ?? "Someone";
              return (
                <Link key={p.subjectId} href={`/friend?id=${encodeURIComponent(p.subjectId)}`} className="lrow">
                  <Avatar id={p.subjectId} name={name} me={me} />
                  <div className="main">
                    <span className="title">{name}</span>
                    <span className="sub ellipsis">{friendWhere(p)}</span>
                  </div>
                  <div className="end">
                    <span className="k">{line.label}</span>
                    <span className={`v ${line.tone}`}>{line.amount}</span>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </section>
    </>
  );
}
