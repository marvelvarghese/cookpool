// Reading an expense request (POST /groups/{org}/expenses, PUT /expenses/{txn})
// into what the engine splits and what the ledger stores. Shape errors are
// 422 `validation_failed` with the fields that failed; a split that does not
// add up is 422 with `details.reason: "does_not_add_up"` and the engine's
// problems, the same ones the app shows on its "adds up" bar.

import { CURRENCY_CODE_RE } from "@saas/contracts/kitchen";
import {
  SPLITECO_ADJUSTMENT_KINDS,
  SPLITECO_CATEGORIES,
  SPLITECO_ITEM_SHARE_MODES,
  SPLITECO_LIMITS,
  SPLITECO_SPLIT_METHODS,
  type SplitecoAdjustmentInput,
  type SplitecoCategory,
  type SplitecoExpenseRequest,
  type SplitecoItemInput,
  type SplitecoSplitInput,
} from "@saas/contracts/spliteco";
import type { NewSplitecoTxn } from "@saas/db/spliteco";
import type { Split } from "@saas/kitchen-engine/ledger";
import {
  buildSplitecoSplits,
  splitPeople,
  type OwedResult,
  type SplitProblem,
  type SplitSpec,
} from "@saas/kitchen-engine/splits";
import { Fields, decimals, instant, minor, oneOf, subjectId, text, type FieldErrors } from "./validate.js";

export interface ParsedExpense {
  /** The request as it will be stored (normalized: trimmed, defaults filled). */
  request: SplitecoExpenseRequest;
  occurredAt: Date | null;
  spec: SplitSpec;
}

export type ParseOutcome = { ok: true; value: ParsedExpense } | { ok: false; fields: FieldErrors };

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

function list(fields: Fields, name: string, value: unknown, max: number, min = 1): unknown[] | undefined {
  if (!Array.isArray(value) || value.length < min || value.length > max) {
    return fields.add(name, `List ${min} to ${max}`);
  }
  return value;
}

function int(fields: Fields, name: string, value: unknown, { min, max }: { min: number; max: number }): number | undefined {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min || value > max) {
    return fields.add(name, `Must be a whole number from ${min} to ${max}`);
  }
  return value;
}

function parseItems(fields: Fields, raw: unknown): SplitecoItemInput[] {
  const items: SplitecoItemInput[] = [];
  const entries = list(fields, "split.items", raw, SPLITECO_LIMITS.items) ?? [];
  entries.forEach((entry, i) => {
    const at = `split.items[${i}]`;
    if (!isObj(entry)) return void fields.add(at, "Must be an item");
    const name = text(fields, `${at}.name`, entry.name, SPLITECO_LIMITS.itemName);
    let qty = 1;
    if (entry.qty !== undefined) {
      if (typeof entry.qty !== "number" || !(entry.qty > 0) || entry.qty > 10_000 || decimals(entry.qty) > 3) {
        fields.add(`${at}.qty`, "Must be a quantity above zero");
      } else qty = entry.qty;
    }
    const unitMinor = entry.unitMinor === undefined || entry.unitMinor === null ? null : minor(fields, `${at}.unitMinor`, entry.unitMinor) ?? null;
    const totalMinor = minor(fields, `${at}.totalMinor`, entry.totalMinor);
    const shares: SplitecoItemInput["shares"] = [];
    const rawShares = list(fields, `${at}.shares`, entry.shares, SPLITECO_LIMITS.people, 0) ?? [];
    rawShares.forEach((s, j) => {
      const sat = `${at}.shares[${j}]`;
      if (!isObj(s)) return void fields.add(sat, "Must be a share");
      const id = subjectId(fields, `${sat}.subjectId`, s.subjectId);
      const mode = oneOf(fields, `${sat}.mode`, s.mode, SPLITECO_ITEM_SHARE_MODES);
      const value = minor(fields, `${sat}.value`, s.value);
      if (id && mode && value !== undefined) shares.push({ subjectId: id, mode, value });
    });
    if (name !== undefined && totalMinor !== undefined) items.push({ name, qty, unitMinor, totalMinor, shares });
  });
  return items;
}

function parseAdjustments(fields: Fields, raw: unknown): SplitecoAdjustmentInput[] {
  if (raw === undefined) return [];
  const out: SplitecoAdjustmentInput[] = [];
  const entries = list(fields, "split.adjustments", raw, SPLITECO_LIMITS.adjustments, 0) ?? [];
  entries.forEach((entry, i) => {
    const at = `split.adjustments[${i}]`;
    if (!isObj(entry)) return void fields.add(at, "Must be an adjustment");
    const kind = oneOf(fields, `${at}.kind`, entry.kind, SPLITECO_ADJUSTMENT_KINDS);
    const label = text(fields, `${at}.label`, entry.label, 60);
    const amountMinor = minor(fields, `${at}.amountMinor`, entry.amountMinor);
    if (kind && label !== undefined && amountMinor !== undefined) out.push({ kind, label, amountMinor });
  });
  return out;
}

function parseSplit(fields: Fields, raw: unknown): SplitecoSplitInput | undefined {
  if (!isObj(raw)) return fields.add("split", "Say how it is split");
  const method = oneOf(fields, "split.method", raw.method, SPLITECO_SPLIT_METHODS);
  if (!method) return undefined;
  if (method === "items") return { method, items: parseItems(fields, raw.items), adjustments: parseAdjustments(fields, raw.adjustments) };
  const entries = list(fields, "split.participants", raw.participants, SPLITECO_LIMITS.people) ?? [];
  if (method === "equal") {
    const ids = entries.map((e, i) => subjectId(fields, `split.participants[${i}]`, e)).filter((x): x is string => !!x);
    return { method, participants: ids };
  }
  const rows: Record<string, unknown>[] = [];
  entries.forEach((e, i) => {
    if (!isObj(e)) return void fields.add(`split.participants[${i}]`, "Must be a person and a value");
    rows.push(e);
  });
  const ids = rows.map((e, i) => subjectId(fields, `split.participants[${i}].subjectId`, e.subjectId));
  switch (method) {
    case "exact":
      return {
        method,
        participants: rows.flatMap((e, i) => {
          const v = minor(fields, `split.participants[${i}].amountMinor`, e.amountMinor);
          return ids[i] && v !== undefined ? [{ subjectId: ids[i]!, amountMinor: v }] : [];
        }),
      };
    case "pct":
      return {
        method,
        participants: rows.flatMap((e, i) => {
          const v = int(fields, `split.participants[${i}].basisPoints`, e.basisPoints, { min: 0, max: 10_000 });
          return ids[i] && v !== undefined ? [{ subjectId: ids[i]!, basisPoints: v }] : [];
        }),
      };
    case "shares":
      return {
        method,
        participants: rows.flatMap((e, i) => {
          const v = e.shares;
          if (typeof v !== "number" || !(v >= 0) || v > 1_000_000 || decimals(v) > 3) {
            fields.add(`split.participants[${i}].shares`, "Must be a share of 0 or more, at most three decimals");
            return [];
          }
          return ids[i] ? [{ subjectId: ids[i]!, shares: v }] : [];
        }),
      };
    case "adjust":
      return {
        method,
        participants: rows.flatMap((e, i) => {
          const v = int(fields, `split.participants[${i}].adjustMinor`, e.adjustMinor, {
            min: -Number.MAX_SAFE_INTEGER,
            max: Number.MAX_SAFE_INTEGER,
          });
          return ids[i] && v !== undefined ? [{ subjectId: ids[i]!, adjustMinor: v }] : [];
        }),
      };
  }
}

/** The engine's view of a split. */
export function specOf(split: SplitecoSplitInput): SplitSpec {
  if (split.method === "items") {
    return {
      method: "items",
      items: split.items.map((item) => ({ totalMinor: item.totalMinor, shares: item.shares })),
      adjustments: split.adjustments.map((a) => ({ kind: a.kind, amountMinor: a.amountMinor })),
    };
  }
  return split as SplitSpec;
}

/** Validate a body. Unknown fields are ignored, as on every baseline route. */
export function parseExpense(body: Record<string, unknown>): ParseOutcome {
  const fields = new Fields();
  const title = text(fields, "title", body.title, SPLITECO_LIMITS.title);
  const totalMinor = minor(fields, "totalMinor", body.totalMinor, true);
  const note = text(fields, "note", body.note, SPLITECO_LIMITS.note, true);
  let currency: string | undefined;
  if (body.currency !== undefined) {
    if (typeof body.currency === "string" && CURRENCY_CODE_RE.test(body.currency)) currency = body.currency;
    else fields.add("currency", "Must be a three-letter ISO 4217 code in capitals, such as INR");
  }
  let category: SplitecoCategory | null = null;
  if (body.category !== undefined && body.category !== null) category = oneOf(fields, "category", body.category, SPLITECO_CATEGORIES) ?? null;
  const occurredAt = body.occurredAt === undefined ? null : instant(fields, "occurredAt", body.occurredAt) ?? null;

  const payers: SplitecoExpenseRequest["payers"] = [];
  const rawPayers = list(fields, "payers", body.payers, SPLITECO_LIMITS.people) ?? [];
  rawPayers.forEach((p, i) => {
    const entry = isObj(p) ? p : {};
    const id = subjectId(fields, `payers[${i}].subjectId`, entry.subjectId);
    const amount = minor(fields, `payers[${i}].amountMinor`, entry.amountMinor);
    if (id && amount !== undefined) payers.push({ subjectId: id, amountMinor: amount });
  });
  const split = parseSplit(fields, body.split);

  if (!fields.ok || title === undefined || totalMinor === undefined || note === undefined || !split) {
    return { ok: false, fields: fields.errors };
  }
  const request: SplitecoExpenseRequest = { title, totalMinor, category, note, payers, split };
  if (currency) request.currency = currency;
  if (occurredAt) request.occurredAt = occurredAt.toISOString();
  return { ok: true, value: { request, occurredAt, spec: specOf(split) } };
}

export type SplitOutcome =
  | { ok: true; splits: Split[]; result: OwedResult }
  | { ok: false; problems: SplitProblem[] };

export function splitExpense(parsed: ParsedExpense): SplitOutcome {
  return buildSplitecoSplits(parsed.request.totalMinor, parsed.request.payers, parsed.spec);
}

/** Everyone the request names: payers and sharers. */
export function peopleNamed(request: SplitecoExpenseRequest): string[] {
  return [...new Set([...request.payers.map((p) => p.subjectId), ...splitPeople(specOf(request.split))])];
}

/** The item, share and adjustment rows an itemized expense stores beside its splits. */
export function itemRows(request: SplitecoExpenseRequest): Pick<NewSplitecoTxn, "items" | "shares" | "adjustments"> {
  if (request.split.method !== "items") return { items: [], shares: [], adjustments: [] };
  return {
    items: request.split.items.map((item, position) => ({
      position,
      name: item.name,
      qty: item.qty ?? 1,
      unitMinor: item.unitMinor ?? null,
      totalMinor: item.totalMinor,
    })),
    shares: request.split.items.flatMap((item, position) =>
      item.shares.map((s) => ({ itemPosition: position, subjectId: s.subjectId, mode: s.mode, value: s.value })),
    ),
    adjustments: request.split.adjustments.map((a, position) => ({ position, kind: a.kind, label: a.label, amountMinor: a.amountMinor })),
  };
}
