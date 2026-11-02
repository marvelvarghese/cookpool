// A person's display name, from identity-worker's service-internal lookup
// (POST /v1/internal/identity/users/lookup, Cookpool CP-9) over the
// IDENTITY_WORKER binding. Membership holds no names. Only the signed-out join
// preview (SI-4) asks, for one person: the group's first owner.
//
// The lookup also answers the person's email. It is read past here and never
// returned: the preview goes to people with no account, and they must never
// see an address. Names are a nicety, never a gate: no binding, a failed
// fetch, a non-2xx, a malformed body or an unknown id all read as "no name".

/** The name `subjectId` set on their profile, or null when there is none to show. */
export async function fetchDisplayName(
  identityWorker: Fetcher | undefined,
  subjectId: string,
  requestId: string,
): Promise<string | null> {
  if (!identityWorker) return null;
  let response: Response;
  try {
    response = await identityWorker.fetch("http://identity-worker/v1/internal/identity/users/lookup", {
      method: "POST",
      headers: { "content-type": "application/json", "x-request-id": requestId },
      body: JSON.stringify({ subjectIds: [subjectId] }),
    });
  } catch {
    return null;
  }
  if (!response.ok) return null;

  let parsed: unknown;
  try {
    parsed = await response.json();
  } catch {
    return null;
  }
  const users = (parsed as { data?: { users?: unknown } } | null)?.data?.users;
  if (!Array.isArray(users)) return null;
  const user = users.find(
    (u): u is { subjectId: string; displayName: unknown } =>
      !!u && typeof u === "object" && (u as { subjectId?: unknown }).subjectId === subjectId,
  );
  return user && typeof user.displayName === "string" ? user.displayName : null;
}

/**
 * The first word of a display name ("Anu Varghese" → "Anu"); null when there
 * is none. A word that looks like an email address (someone who typed theirs
 * as their name) is not shown either.
 */
export function firstNameOf(displayName: string | null | undefined): string | null {
  if (typeof displayName !== "string") return null;
  const first = displayName.trim().split(/\s+/u)[0] ?? "";
  if (first.length === 0 || first.includes("@")) return null;
  return first;
}
