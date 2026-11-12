"use client";

import { SPLITECO_SPLIT_METHODS, type SplitecoSplitMethod } from "@saas/contracts/spliteco";
import { owedBySplit } from "@saas/kitchen-engine/splits";
import { Icon } from "@/components/icons";
import { Avatar, AddsUpBar, BackButton } from "@/components/ui";
import { formatMoney, parseMoney } from "@/lib/money";
import { nameOf } from "@/lib/people";
import { METHOD_HINTS, METHOD_LABELS, switchFromItems, splitInput, splitStatus, toSpec, totalOf } from "@/lib/split-form";
import type { FormCtx } from "./types";

/** The six ways to split, with the adds-up bar; Done stays off until it adds up. */
export function SplitView({ ctx, onDone, onItems }: { ctx: FormCtx; onDone: () => void; onItems: () => void }) {
  const { form, setForm, names, me, currency } = ctx;
  const total = totalOf(form) ?? 0;
  const status = splitStatus(form);
  const owed = total > 0 ? owedBySplit(total, toSpec(splitInput(form))) : null;
  const owedBy = new Map(owed?.ok ? owed.value.owed.map((o) => [o.subjectId, o.owedMinor]) : []);
  const isItems = form.method === "items";
  const pick = (m: SplitecoSplitMethod) => {
    if (m === "items") onItems();
    // From Items, the bill total becomes the amount; the items are kept, unused.
    else setForm((f) => (f.method === "items" ? switchFromItems(f, m, false) : { ...f, method: m }));
  };
  const payer = form.payerMode === "one" ? `${nameOf(names, form.payer, me)} paid` : "several paid";

  let right: string;
  switch (status.kind) {
    case "adds_up":
      right = "Adds up";
      break;
    case "left":
      right = `${formatMoney(status.totalMinor - status.assignedMinor, currency)} left to assign`;
      break;
    case "over":
      right = `${formatMoney(status.assignedMinor - status.totalMinor, currency)} too much`;
      break;
    case "pct":
      right = `${(status.basisPoints ?? 0) / 100}% of 100%`;
      break;
    case "empty":
      right = "Type the amount first";
      break;
    default:
      right = "Check the numbers";
  }

  return (
    <div className="page form" style={{ padding: 0, gap: 16 }}>
      <header className="hdr">
        <BackButton label="Back to expense" onClick={onDone} />
        <div className="hdr-title">
          <h1>How to split</h1>
          <span>
            {form.title || "Expense"} · {formatMoney(total, currency)} · {payer}
          </span>
        </div>
        <span style={{ width: 44 }} />
      </header>
      <div role="tablist" aria-label="Split method" className="methods">
        {SPLITECO_SPLIT_METHODS.map((m) => (
          <button key={m} role="tab" aria-label={`Split ${METHOD_LABELS[m].phrase}`} aria-selected={form.method === m} onClick={() => pick(m)}>
            <span className="g">{METHOD_LABELS[m].glyph}</span>
            <span className="l">{METHOD_LABELS[m].tab}</span>
          </button>
        ))}
      </div>
      <p style={{ margin: 0, fontSize: 14, lineHeight: 1.5 }} className="muted">{METHOD_HINTS[form.method]}</p>
      {isItems ? (
        <div className="goldbox stack s14" style={{ padding: 20, borderRadius: 22 }}>
          <span style={{ fontSize: 17, fontWeight: 700 }}>Split it item by item</span>
          <span className="muted" style={{ fontSize: 14, lineHeight: 1.5 }}>
            Add each item, then tap who had what. Tax, service and discounts spread by what each person had.
          </span>
          <button className="btn saffron" onClick={onItems}>Add items</button>
        </div>
      ) : (
        <div className="stack s8">
          {form.members.map((id) => {
            const name = nameOf(names, id, me);
            const o = owedBy.get(id) ?? (form.method === "exact" ? parseMoney(form.exact[id] ?? "") : null);
            return (
              <div key={id} className="prow">
                <Avatar id={id} name={name} me={me} size={38} />
                <div className="main">
                  <span style={{ fontSize: 15, fontWeight: 600 }}>{name}</span>
                  <span className="money" style={{ fontSize: 13, fontWeight: 700 }}>{name === "You" ? "owe" : "owes"} {o === null ? "—" : formatMoney(o, currency)}</span>
                </div>
                <Control ctx={ctx} id={id} name={name} />
              </div>
            );
          })}
        </div>
      )}
      <div className="footer-fixed">
        <div>
          <AddsUpBar
            left={isItems ? "Items decide each share" : `${formatMoney(status.assignedMinor, currency)} of ${formatMoney(total, currency)}`}
            right={isItems ? "Add items first" : right}
            ok={status.ok}
            ratio={total ? status.assignedMinor / total : 0}
          />
          <button className="btn big" onClick={onDone} disabled={!status.ok || isItems}>
            {status.ok ? "Done" : "Fix the split to continue"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Control({ ctx, id, name }: { ctx: FormCtx; id: string; name: string }) {
  const { form, setForm } = ctx;
  switch (form.method) {
    case "equal": {
      const on = !!form.equal[id];
      return (
        <button
          className={`check ${on ? "on" : ""}`}
          role="checkbox"
          aria-checked={on}
          aria-label={`${name} included`}
          style={{ width: 44, height: 44, borderRadius: 12 }}
          onClick={() => setForm((f) => ({ ...f, equal: { ...f.equal, [id]: !on } }))}
        >
          {on ? <Icon name="check" size={18} stroke={2.4} /> : null}
        </button>
      );
    }
    case "exact":
    case "pct":
    case "adjust": {
      const key = form.method;
      const value = form[key][id] ?? "";
      return (
        <label className="amount-box">
          {key !== "pct" ? <span>₹</span> : null}
          <input
            inputMode={key === "adjust" ? "text" : "decimal"}
            aria-label={key === "exact" ? (name === "You" ? "You owe" : `${name} owes`) : key === "pct" ? `${name}'s percentage` : `Add or take off for ${name}`}
            placeholder={key === "adjust" ? "+0" : "0"}
            value={value}
            onChange={(e) => setForm((f) => ({ ...f, [key]: { ...f[key], [id]: e.target.value } }))}
          />
          {key === "pct" ? <span>%</span> : null}
        </label>
      );
    }
    case "shares": {
      const n = form.shares[id] ?? 0;
      return (
        <span className="stepper">
          <button aria-label={`One share fewer for ${name}`} onClick={() => setForm((f) => ({ ...f, shares: { ...f.shares, [id]: Math.max(0, n - 1) } }))}>−</button>
          <span aria-label={`${name}: ${n} shares`}>{n}</span>
          <button aria-label={`One share more for ${name}`} onClick={() => setForm((f) => ({ ...f, shares: { ...f.shares, [id]: n + 1 } }))}>+</button>
        </span>
      );
    }
    default:
      return null;
  }
}
