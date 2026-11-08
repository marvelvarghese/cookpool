// The structured-output schemas the AI tasks send (`output_config.format`),
// and a check of an answer against one. The API constrains the answer to the
// schema already; this re-checks it, because a truncated or refused answer
// may not match, and because nothing the model says is trusted unchecked.
// Only what the API's strict schemas use is supported here: type, properties,
// required, additionalProperties false, items, enum and anyOf.

export type JsonSchema =
  | { type: "object"; properties: Record<string, JsonSchema>; required: readonly string[]; additionalProperties: false; description?: string }
  | { type: "array"; items: JsonSchema; description?: string }
  | { type: "string"; enum?: readonly string[]; description?: string }
  | { type: "number" | "integer" | "boolean" | "null"; description?: string }
  | { anyOf: readonly JsonSchema[]; description?: string };

function typeOk(type: string, value: unknown): boolean {
  switch (type) {
    case "object":
      return value !== null && typeof value === "object" && !Array.isArray(value);
    case "array":
      return Array.isArray(value);
    case "string":
      return typeof value === "string";
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "integer":
      return typeof value === "number" && Number.isSafeInteger(value);
    case "boolean":
      return typeof value === "boolean";
    case "null":
      return value === null;
    default:
      return false;
  }
}

/** The places `value` breaks `schema` ("lines[0].unit: …"); empty when it matches. */
export function schemaProblems(schema: JsonSchema, value: unknown, path = "$"): string[] {
  if ("anyOf" in schema) {
    return schema.anyOf.some((option) => schemaProblems(option, value, path).length === 0)
      ? []
      : [`${path}: matches none of its options`];
  }
  if (!typeOk(schema.type, value)) return [`${path}: must be ${schema.type}`];
  switch (schema.type) {
    case "object": {
      const object = value as Record<string, unknown>;
      const problems: string[] = [];
      for (const key of schema.required) {
        if (!Object.hasOwn(object, key)) problems.push(`${path}.${key}: is required`);
      }
      for (const [key, child] of Object.entries(object)) {
        const childSchema = Object.hasOwn(schema.properties, key) ? schema.properties[key] : undefined;
        if (!childSchema) problems.push(`${path}.${key}: is not allowed`);
        else problems.push(...schemaProblems(childSchema, child, `${path}.${key}`));
      }
      return problems;
    }
    case "array":
      return (value as unknown[]).flatMap((item, i) => schemaProblems(schema.items, item, `${path}[${i}]`));
    case "string":
      return schema.enum && !schema.enum.includes(value as string) ? [`${path}: must be one of ${schema.enum.join(", ")}`] : [];
    default:
      return [];
  }
}
