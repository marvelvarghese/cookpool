"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { SPLITECO_ADJUSTMENT_KINDS, type SplitecoAdjustmentKind } from "@saas/contracts/spliteco";
import { Icon } from "@/components/icons";
import { BackButton, Screen, useQueryParam } from "@/components/ui";
import { formatMoney, moneyInput, parseMoney } from "@/lib/money";
import { PhotoError, receiptImage } from "@/lib/photo";
import { sessionStore } from "@/lib/return-to";
import {
  addCharge,
  aiFallback,
  confirmLine,
  draftFromReceipt,
  fixLine,
  readSummary,
  removeLine,
  scanStatus,
  setCharge,
  setTotal,
  stashScan,
  type ScanDraft,
  type ScanLine,
} from "@/lib/scan";
import { errorReason, errorText, useSession } from "@/lib/session";
import { CookpoolError } from "@saas/sdk";

// Scan a receipt (SE4, design §5): a photo → Cookpool's receipt reader → a
// draft to check. Doubtful lines ask "Did we read this right?"; Assign items
// and Split equally stay off until they are confirmed or fixed and the lines
// plus the charges come to the printed total. Nothing is saved here: the
// draft opens Add expense, and only its Save writes.

type Phase =
  | { kind: "pick" }
  | { kind: "reading" }
  | { kind: "review" }
  | { kind: "fallback"; why: "unavailable" | "limit" }
  | { kind: "failed"; message: string };

const KIND_LABEL: Record<SplitecoAdjustmentKind, string> = { tax: "Tax", service: "Service", discount: "Discount" };

export default function ScanPage() {
  return (
    <Screen nav={false}>
      <Scan />
    </Screen>
  );
}

function Scan() {
  const router = useRouter();
  const groupId = useQueryParam("group");
  const { client } = useSession();
  const [phase, setPhase] = React.useState<Phase>({ kind: "pick" });
  const [draft, setDraft] = React.useState<ScanDraft | null>(null);
  const [photo, setPhoto] = React.useState<string | null>(null);
  const [fixing, setFixing] = React.useState<string | null>(null);
  const camera = React.useRef<HTMLInputElement | null>(null);
  const upload = React.useRef<HTMLInputElement | null>(null);

  React.useEffect(() => () => {
    if (photo) URL.revokeObjectURL(photo);
  }, [photo]);

  async function read(file: File | undefined) {
    if (!file) return;
    setPhoto(URL.createObjectURL(file));
    setPhase({ kind: "reading" });
    setFixing(null);
    try {
      const image = await receiptImage(file);
      const result = await client.kitchen.aiReceipt(image);
      setDraft(draftFromReceipt(result));
      setPhase({ kind: "review" });
    } catch (err) {
      if (err instanceof PhotoError) return setPhase({ kind: "failed", message: err.message });
      const why = aiFallback(errorReason(err), err instanceof CookpoolError ? err.status : 0);
      if (why) return setPhase({ kind: "fallback", why });
      const reason = errorReason(err);
      setPhase({
        kind: "failed",
        message: reason === "ai_failed" ? "We couldn't read that receipt. Try a sharper photo, flat and in good light." : errorText(err),
      });
    }
  }

  const byHand = () => router.replace(`/add?${groupId ? `group=${encodeURIComponent(groupId)}&` : ""}method=items`);
  const go = (how: "items" | "equal") => {
    if (!draft) return;
    stashScan(sessionStore(), { groupId, how, draft });
    router.replace(`/add?${groupId ? `group=${encodeURIComponent(groupId)}&` : ""}method=${how}&from=scan`);
  };

  const pickers = (
    <>
      <input ref={camera} type="file" accept="image/*" capture="environment" hidden onChange={(e) => void read(e.target.files?.[0])} />
      <input ref={upload} type="file" accept="image/*,application/pdf" hidden onChange={(e) => void read(e.target.files?.[0])} />
    </>
  );

  return (
    <div className="stack s14">
      {pickers}
      <header className="hdr">
        <BackButton label="Back" onClick={() => router.back()} />
        <div className="hdr-title">
          <h1>{phase.kind === "review" ? "Check the scan" : "Scan a receipt"}</h1>
        </div>
        {phase.kind === "review" || phase.kind === "failed" ? (
          <button className="iconbtn" aria-label="Retake photo" onClick={() => camera.current?.click()}>
            <Icon name="camera" size={20} />
          </button>
        ) : (
          <span style={{ width: 44 }} />
        )}
      </header>

      {photo && phase.kind !== "pick" ? (
        <figure aria-label="The receipt you scanned" style={{ margin: 0, height: 220, borderRadius: 22, background: "var(--surface)", border: "1px solid var(--line)", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden" }}>
          <img src={photo} alt="" style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }} />
        </figure>
      ) : null}

      {phase.kind === "pick" ? (
        <section className="card" aria-label="Choose a photo">
          <p style={{ margin: 0, fontSize: 15, lineHeight: 1.5 }} className="muted">
            Take a photo of the bill, flat and in good light. We read the items and the tax, service and discount lines — then you check them.
          </p>
          <button className="btn big" onClick={() => camera.current?.click()}>Take a photo</button>
          <button className="btn ghost" onClick={() => upload.current?.click()}>Choose a photo</button>
          <span className="note">The photo is read and dropped — it isn&apos;t stored. Nothing is saved until you save the expense.</span>
        </section>
      ) : null}

      {phase.kind === "reading" ? (
        <div className="spinner" role="status">Reading the receipt…</div>
      ) : null}

      {phase.kind === "fallback" ? (
        <section className="card" role="alert" aria-label="Reading receipts is off">
          <h2 className="h2">{phase.why === "limit" ? "That's today's receipts" : "Reading receipts isn't available right now"}</h2>
          <p style={{ margin: 0 }} className="muted">
            {phase.why === "limit"
              ? "You've read as many receipts as one person can today. Enter the items by hand — it takes a minute."
              : "Enter the items by hand instead — the itemized split works the same."}
          </p>
          <button className="btn big" onClick={byHand}>Enter the items by hand</button>
        </section>
      ) : null}

      {phase.kind === "failed" ? (
        <section className="card" role="alert">
          <p className="error" style={{ margin: 0 }}>{phase.message}</p>
          <div className="grid2">
            <button className="btn" onClick={() => camera.current?.click()}>Try another photo</button>
            <button className="btn ghost" onClick={byHand}>Enter by hand</button>
          </div>
        </section>
      ) : null}

      {phase.kind === "review" && draft ? (
        <Review draft={draft} setDraft={setDraft} fixing={fixing} setFixing={setFixing} onAssign={() => go("items")} onEqual={() => go("equal")} />
      ) : null}
    </div>
  );
}

function Review(props: {
  draft: ScanDraft;
  setDraft: (d: ScanDraft) => void;
  fixing: string | null;
  setFixing: (key: string | null) => void;
  onAssign: () => void;
  onEqual: () => void;
}) {
  const { draft, setDraft, fixing, setFixing } = props;
  const status = scanStatus(draft);
  const cur = draft.currency;
  const [totalText, setTotalText] = React.useState(draft.totalMinor ? moneyInput(draft.totalMinor) : "");
  const tone = status.matches ? "ok" : "warn";

  return (
    <>
      <div
        role="status"
        style={{
          padding: "12px 14px",
          borderRadius: 16,
          display: "flex",
          alignItems: "center",
          gap: 10,
          background: tone === "ok" ? "rgba(127,216,176,0.08)" : "rgba(242,150,60,0.08)",
          border: `1px solid ${tone === "ok" ? "rgba(127,216,176,0.3)" : "rgba(242,150,60,0.4)"}`,
        }}
      >
        {status.matches ? <Icon name="check" size={20} /> : null}
        <span style={{ fontSize: 14, color: "var(--text-2)" }}>
          {readSummary(draft)}{" "}
          {status.gapMinor === null ? (
            <b>No total was read — type the bill&apos;s total below.</b>
          ) : status.matches ? (
            <>Lines add up to the printed total, <b style={{ color: "var(--text)" }}>{formatMoney(draft.totalMinor ?? 0, cur)}</b>.</>
          ) : (
            <>
              The lines come to <b>{formatMoney(status.sumMinor, cur)}</b> but the bill says <b>{formatMoney(draft.totalMinor ?? 0, cur)}</b> —{" "}
              {status.gapMinor > 0 ? `${formatMoney(status.gapMinor, cur)} too much` : `${formatMoney(-status.gapMinor, cur)} missing`}. Check the lines and charges.
            </>
          )}
        </span>
      </div>

      {status.toCheck.map((line) => (
        <section key={line.key} aria-label={`Check ${line.name || line.text}`} style={{ padding: 14, borderRadius: 18, background: "rgba(242,150,60,0.08)", border: "1px solid rgba(242,150,60,0.4)", display: "flex", flexDirection: "column", gap: 10 }}>
          <span style={{ fontSize: 12, fontWeight: 500, color: "#F5B266", letterSpacing: "0.05em", textTransform: "uppercase" }}>Did we read this right?</span>
          {fixing === line.key ? (
            <FixLine line={line} currency={cur} onDone={(fix) => { setDraft(fixLine(draft, line.key, fix)); setFixing(null); }} onRemove={() => { setDraft(removeLine(draft, line.key)); setFixing(null); }} />
          ) : (
            <>
              <div className="row-between">
                <div className="stack s4">
                  <span style={{ fontSize: 15, fontWeight: 500 }}>{line.name || "Unreadable line"}{line.qty > 1 ? ` × ${line.qty}` : ""}</span>
                  <span className="small muted" style={{ fontFamily: "ui-monospace, monospace" }}>printed &quot;{line.text}&quot; · {line.doubt}</span>
                </div>
                <span style={{ fontSize: 15, fontWeight: 500, color: "var(--money)" }}>{line.priceMinor === null ? "—" : formatMoney(line.priceMinor, cur)}</span>
              </div>
              <div className="grid2" style={{ gap: 8 }}>
                <button className="btn saffron" disabled={line.priceMinor === null || !line.name.trim()} onClick={() => setDraft(confirmLine(draft, line.key))}>Looks right</button>
                <button className="btn ghost" onClick={() => setFixing(line.key)}>Fix it</button>
              </div>
            </>
          )}
        </section>
      ))}

      <section aria-label="What we read" className="stack" style={{ gap: 0 }}>
        <h2 className="eyebrow">Items</h2>
        {draft.lines.filter((l) => l.checked).map((l) =>
          fixing === l.key ? (
            <div key={l.key} style={{ padding: "10px 0", borderBottom: "1px solid var(--line-soft)" }}>
              <FixLine line={l} currency={cur} onDone={(fix) => { setDraft(fixLine(draft, l.key, fix)); setFixing(null); }} onRemove={() => { setDraft(removeLine(draft, l.key)); setFixing(null); }} />
            </div>
          ) : (
            <button key={l.key} className="row-between" aria-label={`${l.name}, ${formatMoney(l.priceMinor ?? 0, cur)}. Edit`} onClick={() => setFixing(l.key)} style={{ padding: "10px 0", borderBottom: "1px solid var(--line-soft)", background: "transparent", border: 0, borderBottomStyle: "solid", color: "var(--text)", textAlign: "left", width: "100%" }}>
              <span style={{ fontSize: 14 }}>{l.name}{l.qty > 1 ? ` × ${l.qty}` : ""}</span>
              <span style={{ fontSize: 14, fontWeight: 500 }}>{formatMoney(l.priceMinor ?? 0, cur)}</span>
            </button>
          ),
        )}
        <h2 className="eyebrow" style={{ marginTop: 16 }}>Tax, service &amp; discount</h2>
        {draft.charges.length === 0 ? <span className="small dim">None read.</span> : null}
        {draft.charges.map((c) => (
          <div key={c.key} className="inline" style={{ flexWrap: "nowrap", padding: "6px 0" }}>
            <select aria-label="Kind of charge" className="input" value={c.kind} onChange={(e) => setDraft(setCharge(draft, c.key, { kind: e.target.value as SplitecoAdjustmentKind }))} style={{ width: 112, flex: "none", height: 42, padding: "0 8px" }}>
              {SPLITECO_ADJUSTMENT_KINDS.map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
            </select>
            <input aria-label="What the bill calls it" className="input" value={c.label} maxLength={60} onChange={(e) => setDraft(setCharge(draft, c.key, { label: e.target.value }))} style={{ height: 42, minWidth: 0 }} />
            <label className="amount-box" style={{ minWidth: 96 }}>
              <span>{c.kind === "discount" ? "−" : "+"}</span>
              <input inputMode="decimal" aria-label={`${c.label} amount`} defaultValue={moneyInput(c.amountMinor)} onChange={(e) => setDraft(setCharge(draft, c.key, { amountMinor: parseMoney(e.target.value) ?? 0 }))} style={{ width: 64 }} />
            </label>
            <button className="iconbtn danger" aria-label={`Remove ${c.label}`} onClick={() => setDraft(setCharge(draft, c.key, null))}><Icon name="trash" size={18} /></button>
          </div>
        ))}
        <div className="inline" style={{ paddingTop: 6 }}>
          {SPLITECO_ADJUSTMENT_KINDS.map((k) => (
            <button key={k} className="chip" onClick={() => setDraft(addCharge(draft, k))}>+ {KIND_LABEL[k]}</button>
          ))}
        </div>
        <div className="row-between" style={{ paddingTop: 14 }}>
          <label htmlFor="printed-total" className="bold" style={{ fontSize: 14 }}>Total on the bill</label>
          <label className="amount-box">
            <span>₹</span>
            <input
              id="printed-total"
              inputMode="decimal"
              value={totalText}
              placeholder="0"
              onChange={(e) => {
                setTotalText(e.target.value);
                setDraft(setTotal(draft, parseMoney(e.target.value)));
              }}
            />
          </label>
        </div>
        <div className="row-between small" style={{ paddingTop: 6 }}>
          <span className="muted">Items {formatMoney(status.itemsMinor, cur)} · charges {status.chargesMinor < 0 ? "−" : "+"}{formatMoney(Math.abs(status.chargesMinor), cur)}</span>
          <b className={status.matches ? "okc" : "owe"}>{formatMoney(status.sumMinor, cur)}</b>
        </div>
      </section>

      <span className="note">The scan is a draft — nothing is saved until you save the expense.</span>
      <div className="stack s8">
        <button className="btn big" disabled={!status.ready} onClick={props.onAssign}>Assign items to people</button>
        <button className="btn ghost" disabled={!status.ready} onClick={props.onEqual}>Just split the total equally</button>
        {!status.ready ? (
          <span className="small dim" style={{ textAlign: "center" }} aria-live="polite">
            {status.toCheck.length > 0
              ? `Check ${status.toCheck.length} line${status.toCheck.length === 1 ? "" : "s"} first`
              : status.gapMinor === null
                ? "Type the bill's total first"
                : !status.matches
                  ? "The lines and charges must come to the bill's total"
                  : "Every item needs a name and a price"}
          </span>
        ) : null}
      </div>
    </>
  );
}

function FixLine({ line, currency, onDone, onRemove }: { line: ScanLine; currency: string; onDone: (fix: { name: string; qty: number; priceMinor: number | null }) => void; onRemove: () => void }) {
  const [name, setName] = React.useState(line.name);
  const [qty, setQty] = React.useState(String(line.qty));
  const [price, setPrice] = React.useState(line.priceMinor === null ? "" : moneyInput(line.priceMinor));
  const priceMinor = parseMoney(price);
  const n = Number(qty);
  const ok = name.trim() !== "" && priceMinor !== null && priceMinor > 0 && Number.isFinite(n) && n > 0;
  return (
    <div className="stack s8">
      <input className="input" aria-label="Item name" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} />
      <div className="inline" style={{ flexWrap: "nowrap" }}>
        <label className="amount-box" style={{ minWidth: 80 }}>
          <span>×</span>
          <input aria-label="How many" inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value)} style={{ width: 40 }} />
        </label>
        <label className="amount-box" style={{ flex: 1 }}>
          <span>{currency === "INR" ? "₹" : currency}</span>
          <input aria-label="Line total" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} style={{ width: "100%" }} />
        </label>
      </div>
      <div className="grid2" style={{ gap: 8 }}>
        <button className="btn" disabled={!ok} onClick={() => onDone({ name: name.trim(), qty: Math.round(n), priceMinor })}>Save line</button>
        <button className="btn danger" onClick={onRemove}>Not an item</button>
      </div>
    </div>
  );
}
