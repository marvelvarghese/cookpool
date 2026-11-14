// Where Spliteco's links go inside Cookpool (money-inside MN-8). Spliteco's own
// screens are shown under /money; a path they link to becomes Cookpool's
// address for the same screen. Settle up is /money/settle-up, because
// /money/settle is the kitchen's settle (dish pages and group settings link
// there). A screen Cookpool does not show (Spliteco's Home, You, Activity,
// Live) goes back to the Money tab. Dependency-free.

/** Spliteco's screens that Cookpool shows, by Spliteco path → Cookpool path. */
export const SPLITECO_SCREENS: Readonly<Record<string, string>> = Object.freeze({
  "/group": "/money/group",
  "/add": "/money/add",
  "/expense": "/money/expense",
  "/settle": "/money/settle-up",
  "/scan": "/money/scan",
  "/friend": "/money/friend",
  "/move": "/money/move",
  "/share": "/money/share",
  "/insights": "/money/insights",
});

/** A Spliteco path ("/group?id=org_1") as Cookpool's address ("/money/group?id=org_1"). */
export function splitecoToCookpool(path: string): string {
  const cut = path.search(/[?#]/);
  const base = (cut === -1 ? path : path.slice(0, cut)).replace(/\/+$/, "") || "/";
  const rest = cut === -1 ? "" : path.slice(cut);
  const at = SPLITECO_SCREENS[base];
  return at ? `${at}${rest}` : "/money";
}
