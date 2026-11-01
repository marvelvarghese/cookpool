/**
 * Home's small pure helpers (Cookpool CP-5): the greeting and the name it
 * uses. Dependency-free so they are unit-testable.
 */

/** "Good morning" before noon, "Good afternoon" until 5pm, then "Good evening". */
export function greetingFor(hour: number): string {
  if (hour >= 5 && hour < 12) return "Good morning";
  if (hour >= 12 && hour < 17) return "Good afternoon";
  return "Good evening";
}

/**
 * The name to greet someone by: the first word of their display name, else
 * their email's local part, else null (the greeting then has no name).
 */
export function friendlyName(displayName: string | null | undefined, email: string | null | undefined): string | null {
  const first = (displayName ?? "").trim().split(/\s+/)[0];
  if (first) return first;
  const local = (email ?? "").trim().split("@")[0];
  return local ? local : null;
}
