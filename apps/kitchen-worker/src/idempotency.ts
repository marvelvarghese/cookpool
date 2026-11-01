import {
  IDEMPOTENCY_KEY_HEADER,
  describeIdempotencyKeyParseError,
  parseIdempotencyKey,
} from "@saas/contracts/idempotency";
import { errorResponse } from "./http.js";

// Every kitchen POST that writes money takes an `Idempotency-Key`. api-edge
// replays a repeated key's response for 24 hours; the ledger also stores the
// key (`idem_key`, unique per group), so a retry that outlives the edge's
// cache, or skips it, still cannot post twice. A request without a key gets
// one minted for it: it is then simply not retryable.

export type IdempotencyKeyResult = { ok: true; key: string } | { ok: false; response: Response };

export function requestIdempotencyKey(request: Request, requestId: string): IdempotencyKeyResult {
  const parsed = parseIdempotencyKey(request.headers.get("idempotency-key"));
  if (!parsed.ok) {
    // The edge refuses these before they arrive; answered the same way here.
    return {
      ok: false,
      response: errorResponse("validation_failed", describeIdempotencyKeyParseError(parsed.reason), 400, requestId, {
        header: IDEMPOTENCY_KEY_HEADER,
        reason: parsed.reason,
      }),
    };
  }
  return { ok: true, key: parsed.key ?? `minted_${crypto.randomUUID().replace(/-/g, "")}` };
}
