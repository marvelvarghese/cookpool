// What a tool is: its name, the scope that lists it, an honest description,
// a JSON schema (zod), and a run that calls api-edge with the person's
// delegated token. A run answers a one-line summary and compact JSON, or the
// edge's error, which errorText turns into plain words.

import type { ZodRawShape, z } from "zod";
import type { AssistantScope } from "@saas/contracts/mcp-connect";
import type { Env } from "../env.js";
import { callEdge, type EdgeCall, type EdgeError, type EdgeResult } from "../edge.js";

export interface ToolContext {
  env: Env;
  /** The delegated token (`sps_dlg_…`). */
  bearer: string;
  requestId: string;
  now: number;
}

export interface ToolAnswer {
  /** One line a person can read. */
  summary: string;
  /** Compact JSON: ids, names, numbers with units, money in its currency. */
  data: unknown;
}

export type ToolOutcome = ToolAnswer | EdgeError;

export interface ToolDef<Shape extends ZodRawShape = ZodRawShape> {
  name: string;
  scope: AssistantScope;
  title: string;
  description: string;
  inputSchema: Shape;
  /** True when it changes nothing. */
  readOnly: boolean;
  run(args: z.infer<z.ZodObject<Shape>>, ctx: ToolContext): Promise<ToolOutcome>;
}

/** A typed tool definition (keeps the args' types inferred from the schema). */
export function defineTool<Shape extends ZodRawShape>(def: ToolDef<Shape>): ToolDef<Shape> {
  return def;
}

/** api-edge, as the person, with their delegated token. */
export function edge<T>(ctx: ToolContext, call: Omit<EdgeCall, "bearer" | "requestId">): Promise<EdgeResult<T>> {
  return callEdge<T>(ctx.env, { ...call, bearer: ctx.bearer, requestId: ctx.requestId });
}

export function isEdgeError(outcome: unknown): outcome is EdgeError {
  return typeof outcome === "object" && outcome !== null && (outcome as { ok?: unknown }).ok === false;
}

/** The plain-words error a tool answers for what api-edge refused (design §2). */
export function errorText(err: EdgeError): string {
  if (err.status === 401) {
    return "Reconnect Cookpool: this assistant's access has ended or was turned off. Add the Cookpool connector again to keep using it.";
  }
  if (err.status === 403 && err.reason === "scope") {
    return "Cookpool didn't allow this. The person can allow it for this assistant in Cookpool, under You → Connected assistants, and connect again.";
  }
  if (err.status === 403) return "Cookpool didn't allow this.";
  if (err.status === 404) return "Cookpool couldn't find that. Check the id and try again.";
  if (err.status === 422 && err.reason === "too_many_timers") {
    const max = typeof err.details.max === "number" ? err.details.max : 10;
    return `There are already ${max} timers running. Cancel one first.`;
  }
  if (err.status === 422 || err.status === 400) {
    const parts = Object.entries(err.fields).map(([field, msgs]) => `${field}: ${msgs.join(", ")}`);
    return parts.length > 0 ? `Cookpool couldn't accept that. ${parts.join("; ")}.` : `Cookpool couldn't accept that. ${err.message}`;
  }
  if (err.status === 429) return "Cookpool is getting a lot of requests. Try again in a minute.";
  return "Cookpool isn't answering right now. Try again shortly.";
}
