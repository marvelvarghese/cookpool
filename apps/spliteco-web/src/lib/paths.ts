// Where a Spliteco screen's own links go (money-inside MN-7). In the Spliteco
// app a path is itself. Cookpool and Tripeco show these same screens inside
// their Money tab under their own addresses, so each sets a mapper once
// (`setPathMapper`) and every link and router call on these screens goes
// through `to()`. Sign-in, the handoff, shared links and the app's own tab bar
// are not mapped: they are the Spliteco app's.

let mapper: (path: string) => string = (path) => path;

/** Set where Spliteco paths go in this app; the identity unless a host sets it. */
export function setPathMapper(next: (path: string) => string): void {
  mapper = next;
}

/** A Spliteco path ("/group?id=…") as this app's address. */
export function to(path: string): string {
  return mapper(path);
}
