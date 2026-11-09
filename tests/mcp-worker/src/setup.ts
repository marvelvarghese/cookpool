// The provider logs every OAuth error it answers (useful in Workers Logs).
// The tests provoke them on purpose. And outside workerd it cannot see the
// global_fetch_strictly_public flag the deployed config sets, so it says CIMD
// is off. Keep the output for anything else.
const warn = console.warn.bind(console);
console.warn = (...args: unknown[]): void => {
  if (typeof args[0] === "string" && (args[0].startsWith("OAuth error response") || args[0].startsWith("CIMD (Client ID Metadata Document) is disabled"))) return;
  warn(...args);
};
