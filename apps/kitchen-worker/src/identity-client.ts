import { USERS_LOOKUP_MAX, type UserSummary } from "@saas/contracts/auth";

// What people are called, from identity-worker's service-internal lookup
// (POST /v1/internal/identity/users/lookup). Membership holds no names, so the
// people a member sees — a group's members, everyone in their balances — are
// named here. Names are a nicety, never a gate: a failed or missing lookup
// reads as "no name", and the app shows its own label instead. One fetch per
// batch of ids per request; answers are cached on the request's context.

/** A person's name as the kitchen shows it: null when there is none to show. */
export type DisplayName = string | null;

export interface People {
  /** The display name of each id asked for (null when unknown or unreadable). */
  names(subjectIds: readonly string[]): Promise<Map<string, DisplayName>>;
}

/**
 * The name a member sees for someone: the name they set on their profile,
 * else their email up to the @ (what Home greets the signed-in person with).
 * Never the whole email: other members see this.
 */
export function displayNameOf(user: Pick<UserSummary, "displayName" | "email">): DisplayName {
  const name = user.displayName?.trim();
  if (name) return name;
  const local = user.email.trim().split("@")[0]?.trim();
  return local ? local : null;
}

function isUserSummary(value: unknown): value is UserSummary {
  if (!value || typeof value !== "object") return false;
  const user = value as Record<string, unknown>;
  return (
    typeof user.subjectId === "string" &&
    typeof user.email === "string" &&
    (user.displayName === null || typeof user.displayName === "string")
  );
}

async function lookup(identityWorker: Fetcher, subjectIds: readonly string[], requestId: string): Promise<UserSummary[]> {
  let response: Response;
  try {
    response = await identityWorker.fetch("http://identity-worker/v1/internal/identity/users/lookup", {
      method: "POST",
      headers: { "content-type": "application/json", "x-request-id": requestId },
      body: JSON.stringify({ subjectIds }),
    });
  } catch {
    return [];
  }
  if (!response.ok) return [];
  try {
    const parsed = (await response.json()) as { data?: { users?: unknown } } | null;
    const users = parsed?.data?.users;
    return Array.isArray(users) ? users.filter(isUserSummary) : [];
  } catch {
    return [];
  }
}

/** A names reader for one request; a missing binding names nobody. */
export function createPeople(identityWorker: Fetcher | undefined, requestId: string): People {
  const cache = new Map<string, Promise<DisplayName>>();
  return {
    async names(subjectIds) {
      const wanted = [...new Set(subjectIds)];
      const missing = wanted.filter((id) => !cache.has(id));
      for (let i = 0; i < missing.length; i += USERS_LOOKUP_MAX) {
        const chunk = missing.slice(i, i + USERS_LOOKUP_MAX);
        const batch = identityWorker ? lookup(identityWorker, chunk, requestId) : Promise.resolve([]);
        for (const id of chunk) {
          cache.set(
            id,
            batch.then((users) => {
              const user = users.find((u) => u.subjectId === id);
              return user ? displayNameOf(user) : null;
            }),
          );
        }
      }
      const out = new Map<string, DisplayName>();
      for (const id of wanted) out.set(id, await cache.get(id)!);
      return out;
    },
  };
}
