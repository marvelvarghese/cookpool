// Small validators for request bodies. Each returns the cleaned value, or
// records a message under the field's name and returns undefined; a handler
// answers 422 `validation_failed` with every field that failed.

export type FieldErrors = Record<string, string[]>;

export class Fields {
  readonly errors: FieldErrors = {};

  add(field: string, message: string): undefined {
    (this.errors[field] ??= []).push(message);
    return undefined;
  }

  get ok(): boolean {
    return Object.keys(this.errors).length === 0;
  }
}

/** A person's public id as the edge forwards it (`usr_…`, `sp_…`). */
const SUBJECT_ID_RE = /^[A-Za-z0-9][\w-]{0,127}$/;

/** Trimmed text of 1..max characters; `optional` lets undefined through as null. */
export function text(fields: Fields, name: string, value: unknown, max: number, optional: true): string | null | undefined;
export function text(fields: Fields, name: string, value: unknown, max: number, optional?: false): string | undefined;
export function text(fields: Fields, name: string, value: unknown, max: number, optional = false): string | null | undefined {
  if (value === undefined || value === null) {
    return optional ? null : fields.add(name, "Required");
  }
  if (typeof value !== "string" || value.trim().length === 0) return fields.add(name, "Must be non-empty text");
  const trimmed = value.trim();
  if (trimmed.length > max) return fields.add(name, `Must be at most ${max} characters`);
  return trimmed;
}

/** A whole, non-negative number of minor units; `positive` refuses zero. */
export function minor(fields: Fields, name: string, value: unknown, positive = false): number | undefined {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || (positive && value === 0)) {
    return fields.add(name, `Must be a whole number of minor units${positive ? " above zero" : ""}`);
  }
  return value;
}

export function subjectId(fields: Fields, name: string, value: unknown): string | undefined {
  if (typeof value !== "string" || !SUBJECT_ID_RE.test(value)) return fields.add(name, "Must be a person's id");
  return value;
}

/** An ISO 8601 date-time (or date), normalised to an instant. */
export function instant(fields: Fields, name: string, value: unknown): Date | undefined {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}/.test(value) || value.length > 40) {
    return fields.add(name, "Must be an ISO 8601 date-time");
  }
  const at = new Date(value);
  if (Number.isNaN(at.getTime())) return fields.add(name, "Must be an ISO 8601 date-time");
  return at;
}

const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** A calendar date as `YYYY-MM-DD` (a use-by or bought-on date). */
export function isoDate(fields: Fields, name: string, value: unknown): string | undefined {
  const match = typeof value === "string" ? ISO_DATE_RE.exec(value) : null;
  if (!match) return fields.add(name, "Must be a date as YYYY-MM-DD");
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const at = new Date(Date.UTC(year, month - 1, day));
  if (year < 2000 || at.getUTCMonth() !== month - 1 || at.getUTCDate() !== day) {
    return fields.add(name, "Must be a real date as YYYY-MM-DD");
  }
  return value as string;
}

export function oneOf<T extends string>(
  fields: Fields,
  name: string,
  value: unknown,
  allowed: readonly T[],
): T | undefined {
  if (typeof value === "string" && (allowed as readonly string[]).includes(value)) return value as T;
  return fields.add(name, `Must be one of: ${allowed.join(", ")}`);
}

/** Decimal places in a finite number's shortest form. */
export function decimals(value: number): number {
  const s = String(value);
  if (s.includes("e")) return Infinity;
  const dot = s.indexOf(".");
  return dot < 0 ? 0 : s.length - dot - 1;
}
