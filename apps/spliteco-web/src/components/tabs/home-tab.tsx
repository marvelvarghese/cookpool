"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { SplitecoFriendBalance, SplitecoGroupsResponse, SplitecoHomeResponse } from "@saas/contracts/spliteco";
import { Icon, Mark } from "../icons";
import { Avatar, Loading, Sheet, type Load } from "../ui";
import { SwipeRow } from "../gestures/swipe-row";
import { formatShort } from "@/lib/money";
import { HOME_PEOPLE, fromKitchen, mainBalance, netLabel, planNote, rowAction, settleHref, signedShort } from "@/lib/home";

type Groups = SplitecoGroupsResponse["groups"] | null;

/**
 * Home (V2Home page 1, design §3): the net figure with ↑ owed and ↓ owe,
 * three people then See all, Scan · Live · Insights. A person swipes left
 * to Settle (you owe) or Remind (they owe, with Undo), and holding them
 * opens Settle · Remind · Open; tapping opens their page (the twin).
 */
export function HomeTab({
  load,
  groups,
  me,
  onSeeAll,
  onRemind,
}: {
  load: Load<SplitecoHomeResponse>;
  groups: SplitecoGroupsResponse | null;
  me: string | null;
  onSeeAll: () => void;
  onRemind: (p: SplitecoFriendBalance) => void;
}) {
  const data = load.data;
  const meId = data?.me.subjectId ?? me;
  return (
    <>
      <header className="home-hdr">
        <Mark size={30} />
        <Link href="/you" aria-label="You">
          <Avatar id={meId ?? "me"} name={data?.me.name ?? "You"} me={meId} size={36} />
        </Link>
      </header>
      <Loading load={load}>{data ? <Home data={data} groups={groups?.groups ?? null} onSeeAll={onSeeAll} onRemind={onRemind} /> : null}</Loading>
    </>
  );
}

function Home({
  data,
  groups,
  onSeeAll,
  onRemind,
}: {
  data: SplitecoHomeResponse;
  groups: Groups;
  onSeeAll: () => void;
  onRemind: (p: SplitecoFriendBalance) => void;
}) {
  const me = data.me.subjectId;
  const total = data.totals.find((t) => t.currency === "INR") ?? data.totals[0] ?? { currency: "INR", owedToYouMinor: 0, youOweMinor: 0, netMinor: 0 };
  const others = data.totals.filter((t) => t !== total && t.netMinor !== 0);
  const net = signedShort(total.netMinor, total.currency);
  const [held, setHeld] = React.useState<SplitecoFriendBalance | null>(null);
  // Bumped to close a row left open on its action once that action ran.
  const [reset, setReset] = React.useState(0);
  const people = data.people.slice(0, HOME_PEOPLE);
  const remind = (p: SplitecoFriendBalance) => {
    onRemind(p);
    setReset((n) => n + 1);
  };

  return (
    <>
      <section aria-label="Your balance" className="net">
        <span className="k">{netLabel(total.netMinor)}</span>
        <span className={`fig ${net.tone}`}>{net.text}</span>
        <div className="split">
          <span aria-label={`Owed to you ${formatShort(total.owedToYouMinor, total.currency)}`}>
            <span className="get" aria-hidden="true">↑</span> {formatShort(total.owedToYouMinor, total.currency)}
          </span>
          <span aria-label={`You owe ${formatShort(total.youOweMinor, total.currency)}`}>
            <span className="owe" aria-hidden="true">↓</span> {formatShort(total.youOweMinor, total.currency)}
          </span>
        </div>
        {others.length > 0 ? <span className="also">Also {others.map((t) => signedShort(t.netMinor, t.currency).text).join(" · ")}</span> : null}
      </section>

      {data.people.length === 0 ? (
        <p className="empty">
          Nobody owes anybody yet. <Link href="/add">Add an expense</Link>.
        </p>
      ) : (
        <section aria-label="People" className="card flush">
          {people.map((p) => (
            <PersonRow key={`${p.subjectId}:${reset}`} p={p} me={me} groups={groups} onRemind={remind} onHold={setHeld} />
          ))}
          <button type="button" className="see-all" onClick={onSeeAll}>
            See all {data.people.length}
          </button>
        </section>
      )}

      <nav aria-label="More" className="tiles3">
        <Link href="/scan" aria-label="Scan a bill">
          <Icon name="bills" size={20} />
          Scan
        </Link>
        <Link href="/live" aria-label="Split live">
          <Icon name="live" size={20} />
          Live
        </Link>
        <Link href="/insights">
          <Icon name="pie" size={20} />
          Insights
        </Link>
      </nav>

      {held ? (
        <HoldSheet
          p={held}
          me={me}
          groups={groups}
          onClose={() => setHeld(null)}
          onRemind={(p) => {
            setHeld(null);
            remind(p);
          }}
        />
      ) : null}
    </>
  );
}

function amountOf(p: SplitecoFriendBalance): { text: string; tone: "get" | "owe" | "even" } {
  const b = mainBalance(p.balances);
  return b ? signedShort(b.amountMinor, b.currency) : { text: "settled", tone: "even" };
}

function PersonRow({
  p,
  me,
  groups,
  onRemind,
  onHold,
}: {
  p: SplitecoFriendBalance;
  me: string;
  groups: Groups;
  onRemind: (p: SplitecoFriendBalance) => void;
  onHold: (p: SplitecoFriendBalance) => void;
}) {
  const router = useRouter();
  const name = p.name ?? "Someone";
  const action = rowAction(p, groups);
  const href = settleHref(p.subjectId, groups);
  const amount = amountOf(p);
  return (
    <SwipeRow
      action={
        action === "settle" ? (
          <Link href={href}>Settle</Link>
        ) : action === "remind" ? (
          <button type="button" onClick={() => onRemind(p)}>
            Remind
          </button>
        ) : null
      }
      actionTone={action === "settle" ? "cobalt" : "gold"}
      onFire={action === "settle" ? () => router.push(href) : action === "remind" ? () => onRemind(p) : undefined}
      onHold={() => onHold(p)}
    >
      <Link href={`/friend?id=${encodeURIComponent(p.subjectId)}`} className="prow">
        <Avatar id={p.subjectId} name={name} me={me} size={38} />
        <span className="name">{name}</span>
        {fromKitchen(p, groups) ? <span className="kdot" role="img" aria-label="From a Cookpool kitchen" /> : null}
        <span className={`amt ${amount.tone}`}>{amount.text}</span>
      </Link>
    </SwipeRow>
  );
}

function HoldSheet({
  p,
  me,
  groups,
  onClose,
  onRemind,
}: {
  p: SplitecoFriendBalance;
  me: string;
  groups: Groups;
  onClose: () => void;
  onRemind: (p: SplitecoFriendBalance) => void;
}) {
  const name = p.name ?? "Someone";
  const action = rowAction(p, groups);
  const amount = amountOf(p);
  return (
    <Sheet label={name} onClose={onClose}>
      <div className="sheet-person">
        <Avatar id={p.subjectId} name={name} me={me} size={44} />
        <span className="name">{name}</span>
        <span className={`amt ${amount.tone}`}>{amount.text}</span>
      </div>
      {planNote(p, groups) ? <p className="sheet-note">{planNote(p, groups)}</p> : null}
      <div className="atiles">
        {action === "settle" ? (
          <Link href={settleHref(p.subjectId, groups)} className="atile">
            <Icon name="swap" size={22} />
            Settle
          </Link>
        ) : (
          <button type="button" className="atile" disabled title={`You don't pay ${name} in any group's plan`}>
            <Icon name="swap" size={22} />
            Settle
          </button>
        )}
        <button type="button" className="atile" disabled={action !== "remind"} onClick={() => onRemind(p)} title={action === "remind" ? undefined : `${name} doesn't pay you in any group's plan`}>
          <Icon name="bell" size={22} />
          Remind
        </button>
        <Link href={`/friend?id=${encodeURIComponent(p.subjectId)}`} className="atile">
          <Icon name="chevron" size={22} />
          Open
        </Link>
      </div>
    </Sheet>
  );
}
