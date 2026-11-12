"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { SPLITECO_LIVE_POLL_MS, formatLiveCode, normalizeLiveCode, type SplitecoLiveSession } from "@saas/contracts/spliteco";
import { CookpoolError } from "@saas/sdk";
import { Icon } from "@/components/icons";
import { BackButton, Sheet, useToast } from "@/components/ui";
import { QrCode } from "@/components/qr";
import { formatShort } from "@/lib/money";
import { initialOf, nameOf, namesFrom, tintOf } from "@/lib/people";
import { claimersOf, hereLine, inviteText, keepPolling, liveUrl, lockState, myClaim, progress, tickerLine, toggleMine } from "@/lib/live";
import { browserClock, browserPage, createPoller, type Poller } from "@/lib/poll";
import { errorReason, errorText, newIdempotencyKey, useSession } from "@/lib/session";
import { useMe } from "@/lib/me";

// Live split (SE4): the code and its QR, who is here, the claimed bar, each
// item with its claimers and "I had this", and — for the person who opened
// it — the lock once everything is claimed. Refreshed by polling every 2 s
// while the page is visible (risk SE-E); claims show for everyone on their
// next read, within 3 s.

function Face({ id, name, me, size = 28, here }: { id: string; name: string; me: string | null; size?: number; here?: boolean | undefined }) {
  const t = tintOf(id, me);
  return (
    <span
      aria-hidden="true"
      className="avatar"
      style={{
        width: size,
        height: size,
        background: t.bg,
        color: t.fg,
        fontSize: Math.round(size * 0.4),
        border: here === undefined ? "2px solid var(--surface)" : here ? "2px solid var(--ok)" : "2px dashed var(--dim)",
        opacity: here === false ? 0.7 : 1,
        marginLeft: -6,
        boxSizing: "border-box",
      }}
    >
      {initialOf(name)}
    </span>
  );
}

export function LiveScreen({ code: raw }: { code: string }) {
  const router = useRouter();
  const { client } = useSession();
  const { me: meUser } = useMe();
  const me = meUser?.id ?? null;
  const code = normalizeLiveCode(raw);
  const [session, setSession] = React.useState<SplitecoLiveSession | null>(null);
  const [gone, setGone] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [assign, setAssign] = React.useState<number | null>(null);
  const [toast, say] = useToast();
  const poller = React.useRef<Poller | null>(null);
  const [now, setNow] = React.useState(() => new Date());

  React.useEffect(() => {
    if (!code) {
      setGone(true);
      return;
    }
    const p = createPoller(
      async () => {
        try {
          const r = await client.spliteco.live(code);
          setSession(r.session);
          setNow(new Date());
          setError(null);
          if (!keepPolling(r.session)) p.stop();
        } catch (err) {
          if (err instanceof CookpoolError && err.status === 404) {
            setGone(true);
            p.stop();
            return;
          }
          setError(errorText(err));
        }
      },
      SPLITECO_LIVE_POLL_MS,
      browserPage(),
      browserClock,
    );
    poller.current = p;
    p.start();
    return () => p.stop();
  }, [client, code]);

  async function claim(body: Parameters<typeof client.spliteco.claimLive>[1], key: string) {
    if (!code) return;
    setBusy(key);
    setError(null);
    try {
      const r = await client.spliteco.claimLive(code, body, { idempotencyKey: newIdempotencyKey() });
      setSession(r.session);
    } catch (err) {
      setError(errorText(err));
      poller.current?.kick();
    } finally {
      setBusy(null);
    }
  }

  async function lock() {
    if (!code) return;
    setBusy("lock");
    setError(null);
    try {
      const r = await client.spliteco.lockLive(code, { idempotencyKey: newIdempotencyKey() });
      setSession(r.session);
      poller.current?.stop();
    } catch (err) {
      setError(errorReason(err) === "not_all_claimed" ? "Someone took an item off just now — check the list." : errorText(err));
      poller.current?.kick();
    } finally {
      setBusy(null);
    }
  }

  if (gone) {
    return (
      <div className="stack s14">
        <header className="hdr">
          <BackButton label="Back" href="/" />
          <div className="hdr-title"><h1>Live split</h1></div>
          <span style={{ width: 44 }} />
        </header>
        <section className="card" role="alert">
          <h2 className="h2">We can&apos;t find that live split</h2>
          <p className="muted" style={{ margin: 0 }}>The code may be wrong, or it&apos;s for a group you&apos;re not in. Ask whoever opened it to check the code, or to add you to the group.</p>
          <JoinByCode />
        </section>
      </div>
    );
  }
  if (!session) return <div className="spinner" role="status">Joining the live split…</div>;

  const names = namesFrom(session.members);
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  const url = liveUrl(origin, session.code);
  const bar = progress(session);
  const locking = lockState(session, me);
  const isOpener = me === session.createdBy;
  const hereIds = new Set(session.here.map((h) => h.subjectId));
  const faces = [...session.members].sort((a, b) => Number(hereIds.has(b.subjectId)) - Number(hereIds.has(a.subjectId)) || (a.subjectId === me ? -1 : 0)).slice(0, 7);
  const ticker = tickerLine(session, names, me, now);
  const cur = session.currency;

  async function copyInvite() {
    const text = inviteText(session!, origin);
    try {
      if (navigator.share) await navigator.share({ title: session!.draft.title, text, url });
      else {
        await navigator.clipboard.writeText(url);
        say("Invite link copied");
      }
    } catch {
      /* the person closed the share sheet */
    }
  }

  return (
    <div className="stack s14">
      <header className="hdr">
        <BackButton label="Back" onClick={() => router.back()} />
        <div className="hdr-title" style={{ flex: 1 }}>
          <h1 className="ellipsis" style={{ maxWidth: "100%" }}>{session.draft.title}</h1>
          {session.state === "open" ? (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6, color: "var(--ok)", fontWeight: 700 }}>
              <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--ok)" }} />
              Live · {session.here.length} here
            </span>
          ) : (
            <span>{session.state === "locked" ? "Locked · posted" : "Ended"} · {session.groupName}</span>
          )}
        </div>
        <span style={{ width: 44 }} />
      </header>

      {session.state === "open" ? (
        <section aria-label="Invite to this split" className="card r22" style={{ flexDirection: "row", alignItems: "center", gap: 14 }}>
          <QrCode text={url} label={`QR code to join, opens ${url}`} />
          <div className="stack s8" style={{ flex: 1, minWidth: 0 }}>
            <span className="small muted">Scan, or share the code</span>
            <span style={{ fontFamily: "ui-monospace, monospace", fontSize: 20, fontWeight: 700, letterSpacing: "0.08em", color: "var(--money)" }} aria-label={`Code ${session.code.split("").join(" ")}`}>
              {formatLiveCode(session.code)}
            </span>
            <button className="btn surface" style={{ height: 40, fontSize: 13 }} onClick={copyInvite}>
              <Icon name="copy" size={15} /> Copy invite link
            </button>
          </div>
        </section>
      ) : null}

      <div className="inline" style={{ flexWrap: "nowrap", gap: 10 }} aria-label="Who is here">
        <div style={{ display: "flex", paddingLeft: 6 }}>
          {faces.map((m) => (
            <Face key={m.subjectId} id={m.subjectId} name={nameOf(names, m.subjectId, me)} me={me} size={32} here={hereIds.has(m.subjectId)} />
          ))}
        </div>
        <span className="small muted">{hereLine(session, names, me)}</span>
      </div>

      <section aria-label="Claimed so far" className="stack s8">
        <div className="row-between" style={{ fontSize: 14 }}>
          <span className="muted">{bar.left}</span>
          <b style={{ color: bar.done ? "var(--ok)" : "var(--money)" }}>{bar.right}</b>
        </div>
        <div aria-hidden="true" style={{ height: 8, borderRadius: 4, background: "var(--line-soft)", overflow: "hidden" }}>
          <div style={{ width: `${Math.round(bar.ratio * 100)}%`, height: 8, borderRadius: 4, background: bar.done ? "var(--ok)" : "var(--money)", transition: "width 300ms" }} />
        </div>
      </section>

      <section aria-label="Items" className="stack s8">
        {session.draft.items.map((item, i) => {
          const who = claimersOf(session, i);
          const mine = myClaim(session, i, me);
          const open = who.length === 0;
          return (
            <div
              key={i}
              style={{
                minHeight: 58,
                borderRadius: 16,
                background: open ? "rgba(255,200,87,0.07)" : "var(--surface)",
                border: `1px solid ${open ? "rgba(255,200,87,0.4)" : "var(--line)"}`,
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "8px 10px 8px 14px",
              }}
            >
              <button
                aria-label={isOpener && session.state === "open" ? `${item.name}: choose who had it` : item.name}
                disabled={!isOpener || session.state !== "open"}
                onClick={() => setAssign(i)}
                style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2, background: "transparent", border: 0, color: "var(--text)", textAlign: "left", padding: 0 }}
              >
                <span style={{ fontSize: 14, fontWeight: 700 }}>{item.name}{(item.qty ?? 1) > 1 ? ` × ${item.qty}` : ""}</span>
                <span className="small dim">
                  {formatShort(item.totalMinor, cur)}
                  {who.length > 0 ? ` · ${who.map((id) => nameOf(names, id, me)).join(", ")}` : ""}
                </span>
              </button>
              {who.length > 0 ? (
                <div style={{ display: "flex", paddingLeft: 6 }} aria-hidden="true">
                  {who.slice(0, 4).map((id) => <Face key={id} id={id} name={nameOf(names, id, me)} me={me} />)}
                </div>
              ) : null}
              {session.state === "open" && me ? (
                <button
                  className={mine ? "btn surface" : "btn saffron"}
                  style={{ height: 40, padding: "0 12px", fontSize: 13, flex: "none" }}
                  aria-pressed={!!mine}
                  disabled={busy === `item${i}`}
                  onClick={() => claim(toggleMine(session, i, me), `item${i}`)}
                >
                  {mine ? "Not me" : "I had this"}
                </button>
              ) : null}
            </div>
          );
        })}
        {session.draft.adjustments.length > 0 ? (
          <span className="small dim">
            {session.draft.adjustments.map((a) => `${a.label} ${a.kind === "discount" ? "−" : "+"}${formatShort(a.amountMinor, cur)}`).join(" · ")} — spread by what each person had. Bill {formatShort(session.totalMinor, cur)}.
          </span>
        ) : null}
      </section>

      {ticker && session.state === "open" ? (
        <div className="inline small dim" aria-live="polite">
          <span aria-hidden="true" style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--money)" }} />
          {ticker}
        </div>
      ) : null}

      {error ? <p className="error" role="alert">{error}</p> : null}

      {locking.show ? (
        <button className="btn big" disabled={!locking.enabled || busy === "lock"} onClick={lock}>
          {busy === "lock" ? "Locking…" : locking.label}
        </button>
      ) : session.state === "open" && !isOpener ? (
        <span className="note" style={{ textAlign: "center" }}>Tap &quot;I had this&quot; on everything you had. {nameOf(names, session.createdBy, me)} locks the bill once it&apos;s all claimed.</span>
      ) : null}

      {session.state === "locked" && session.expenseId ? (
        <section className="card r22" aria-label="Posted">
          <span className="inline" style={{ fontWeight: 700 }}><Icon name="check" size={18} /> Locked and posted to {session.groupName}</span>
          <Link className="btn big" href={`/expense?id=${encodeURIComponent(session.expenseId)}`}>Open the expense</Link>
        </section>
      ) : null}
      {session.state === "expired" ? (
        <p className="note" role="status">This live split was open for 24 hours and has ended. Nothing was posted.</p>
      ) : null}

      {assign !== null && session.draft.items[assign] ? (
        <Sheet label={`Who had ${session.draft.items[assign]!.name}`} onClose={() => setAssign(null)}>
          <h2 className="h1" style={{ fontSize: 22 }}>Who had {session.draft.items[assign]!.name}?</h2>
          <div className="stack s8">
            {session.members.map((m) => {
              const on = claimersOf(session, assign).includes(m.subjectId);
              const name = nameOf(names, m.subjectId, me);
              return (
                <button
                  key={m.subjectId}
                  className="prow"
                  aria-pressed={on}
                  disabled={busy === `assign${m.subjectId}`}
                  onClick={() => claim(on ? { itemPosition: assign, subjectId: m.subjectId, clear: true } : { itemPosition: assign, subjectId: m.subjectId }, `assign${m.subjectId}`)}
                  style={{ color: "var(--text)", textAlign: "left", borderColor: on ? "var(--cobalt-ring)" : undefined }}
                >
                  <span className={`check ${on ? "on" : ""}`} aria-hidden="true">{on ? <Icon name="check" size={16} /> : null}</span>
                  <span style={{ fontWeight: 600, flex: 1 }}>{name}</span>
                  {hereIds.has(m.subjectId) ? <span className="small okc">here</span> : null}
                </button>
              );
            })}
          </div>
          <p className="note">As the person who opened it, you can claim for anyone — say, someone without their phone.</p>
        </Sheet>
      ) : null}
      {toast}
    </div>
  );
}

/** Type a code to join (when a link is wrong, or from the Live page with no code). */
export function JoinByCode() {
  const router = useRouter();
  const [text, setText] = React.useState("");
  const code = normalizeLiveCode(text);
  return (
    <form
      className="inline"
      style={{ flexWrap: "nowrap" }}
      onSubmit={(e) => {
        e.preventDefault();
        if (code) router.push(`/live/${code}`);
      }}
    >
      <input className="input" aria-label="Live split code" placeholder="ABCD-2345" value={text} maxLength={12} autoCapitalize="characters" onChange={(e) => setText(e.target.value)} style={{ fontFamily: "ui-monospace, monospace", letterSpacing: "0.08em" }} />
      <button className="btn" type="submit" disabled={!code}>Join</button>
    </form>
  );
}
