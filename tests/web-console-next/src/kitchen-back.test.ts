import {
  DEFAULT_PARENT,
  OUTSIDE_THE_APP,
  SCREENS_WITH_PARENT,
  TAB_PAGES,
  TRAIL_STAMP_KEY,
  backParent,
  createTrail,
  followTrail,
  hasAppHistory,
  stampedState,
  trailStamp,
  type TrailHistory,
} from "@web-console-next/components/kitchen/back";
import { STATIC_PAGES } from "@web-console-next/lib/static-pages.mjs";
import { KITCHEN_NAV_LINKS } from "@web-console-next/components/kitchen/nav";

// cookpool-app PW-3: one back control on every non-tab screen; back goes to
// the screen's parent when the app has no history of its own behind it.

describe("the parent map (backParent)", () => {
  it("covers every page: a tab, a screen with a parent, or outside the app's frame", () => {
    // A new page must say where Back takes it, or this fails.
    expect([...OUTSIDE_THE_APP].sort()).toEqual(["/", "/auth/callback", "/login"]);
    for (const page of SCREENS_WITH_PARENT) expect(STATIC_PAGES).toContain(page);
  });

  it("gives the tabs none: they have no back control", () => {
    expect(TAB_PAGES).toEqual(KITCHEN_NAV_LINKS.map((l) => l.href));
    for (const tab of ["/home", "/pantry", "/groups", "/people", "/home/", "/groups/"]) expect(backParent(tab)).toBeNull();
  });

  it.each([
    // Use, Bought, Cook (the + Add sheet and the home-screen shortcuts) and You → Home.
    ["/use", "/home"],
    ["/cook", "/home"],
    ["/pantry/new", "/home"],
    ["/you", "/home"],
    // An item → Pantry, on the item's own pantry.
    ["/pantry/me:itm_abc123", "/pantry?pantry=personal"],
    ["/pantry/me%3Aitm_abc123", "/pantry?pantry=personal"],
    ["/pantry/org:org_f1a:itm_abc123", "/pantry?pantry=org_f1a"],
    ["/pantry/not-an-item", "/pantry"],
    // Its stock check (PN-7) → the item.
    ["/pantry/me:itm_abc123/check", "/pantry/me:itm_abc123"],
    ["/pantry/org:org_f1a:itm_abc123/check", "/pantry/org:org_f1a:itm_abc123"],
    // A dish → Home until its group is known (and for a dish of your own).
    ["/dishes/dsh_1", "/home"],
    // A group → Groups; its Settings and Add a bill → the group.
    ["/groups/flat-4b-k3x9", "/groups"],
    ["/groups/flat-4b-k3x9/settings", "/groups/flat-4b-k3x9"],
    ["/groups/flat-4b-k3x9/expense", "/groups/flat-4b-k3x9"],
    ["/groups/flat-4b-k3x9/settings/", "/groups/flat-4b-k3x9"],
    // A join link → Groups.
    ["/join/K3X9AB", "/groups"],
    // A person → People; /settle only opens People.
    ["/people/usr_000000000000000000000000000000aa", "/people"],
    ["/settle", "/people"],
  ])("%s → %s", (path, parent) => {
    expect(backParent(path)).toBe(parent);
  });

  it("sends a shared dish to its group once the group is known, and your own dish Home", () => {
    expect(backParent("/dishes/dsh_1", { groupSlug: "flat-4b-k3x9" })).toBe("/groups/flat-4b-k3x9");
    expect(backParent("/dishes/dsh_1", { groupSlug: "a b" })).toBe("/groups/a%20b");
    expect(backParent("/dishes/dsh_1", { groupSlug: null })).toBe("/home");
    // Only a dish reads the group: anywhere else the address decides.
    expect(backParent("/groups/flat-4b-k3x9", { groupSlug: "other" })).toBe("/groups");
  });

  it("sends an address it does not know Home", () => {
    expect(DEFAULT_PARENT).toBe("/home");
    expect(backParent("/nowhere")).toBe("/home");
    expect(backParent("/groups/a/b/c")).toBe("/home");
    expect(backParent("")).toBe("/home");
    expect(backParent(null)).toBe("/home");
    expect(backParent(undefined)).toBe("/home");
  });

  it("always reaches a tab by following parents, in at most three steps", () => {
    const samples = [
      "/use",
      "/cook",
      "/pantry/new",
      "/you",
      "/pantry/org:org_f1a:itm_abc123",
      "/dishes/dsh_1",
      "/groups/flat/settings",
      "/groups/flat/expense",
      "/join/K3X9AB",
      "/people/usr_1",
      "/settle",
    ];
    for (const start of samples) {
      let path: string = start;
      let steps = 0;
      for (let next = backParent(path); next !== null; next = backParent(path)) {
        path = next.split("?")[0]!;
        steps += 1;
        expect(steps).toBeLessThanOrEqual(3);
      }
      expect(TAB_PAGES).toContain(path);
    }
  });
});

describe("has the app history of its own (followTrail)", () => {
  it("has none on the first screen: opened from a link, a shortcut, a notification", () => {
    const opened = followTrail(5, { kind: "open", stamp: null });
    expect(opened).toBe(0);
    expect(hasAppHistory(opened)).toBe(false);
  });

  it("counts a push, keeps the count on a replace", () => {
    let depth = followTrail(0, { kind: "open", stamp: null });
    depth = followTrail(depth, { kind: "push" });
    expect(depth).toBe(1);
    expect(hasAppHistory(depth)).toBe(true);
    depth = followTrail(depth, { kind: "replace" });
    expect(depth).toBe(1);
    depth = followTrail(depth, { kind: "push" });
    expect(depth).toBe(2);
  });

  it("does not count Back's own replace with the parent: the parent's Back goes to its parent", () => {
    // /dishes/dsh_1 opened from a notification, Back → /groups/flat (a replace), Back again.
    let depth = followTrail(0, { kind: "open", stamp: null });
    depth = followTrail(depth, { kind: "replace" });
    expect(hasAppHistory(depth)).toBe(false);
  });

  it("takes a back or forward's count from the entry it lands on, and 0 from one without", () => {
    expect(followTrail(3, { kind: "pop", stamp: 1 })).toBe(1);
    expect(followTrail(3, { kind: "pop", stamp: null })).toBe(0);
  });

  it("trusts the count of the screen it opens on after a reload", () => {
    expect(followTrail(0, { kind: "open", stamp: 2 })).toBe(2);
  });

  it("reads and writes the count beside Next's state", () => {
    const next = { __NA: true, __PRIVATE_NEXTJS_INTERNALS_TREE: ["", {}] };
    const stamped = stampedState(next, 2);
    expect(stamped).toEqual({ ...next, [TRAIL_STAMP_KEY]: 2 });
    expect(trailStamp(stamped)).toBe(2);
    expect(stampedState(null, 0)).toEqual({ [TRAIL_STAMP_KEY]: 0 });
    for (const bad of [null, undefined, "x", 3, {}, { [TRAIL_STAMP_KEY]: -1 }, { [TRAIL_STAMP_KEY]: 1.5 }, { [TRAIL_STAMP_KEY]: "2" }]) {
      expect(trailStamp(bad)).toBeNull();
    }
  });
});

/** A tab's history, as the browser keeps it: entries, the current one, push truncating forward. */
class FakeHistory implements TrailHistory {
  entries: { state: unknown; url: string }[];
  index = 0;
  constructor(url: string, before: string[] = []) {
    this.entries = [...before.map((u) => ({ state: null, url: u })), { state: null, url }];
    this.index = this.entries.length - 1;
  }
  get state(): unknown {
    return this.entries[this.index]!.state;
  }
  get url(): string {
    return this.entries[this.index]!.url;
  }
  pushState(data: unknown, _unused: string, url?: string | URL | null): void {
    this.entries = this.entries.slice(0, this.index + 1);
    this.entries.push({ state: data, url: url ? String(url) : this.url });
    this.index += 1;
  }
  replaceState(data: unknown, _unused: string, url?: string | URL | null): void {
    this.entries[this.index] = { state: data, url: url ? String(url) : this.url };
  }
  /** The browser's back: lands on the entry before and hands its state to `pop`. */
  back(): unknown {
    this.index -= 1;
    return this.state;
  }
  forward(): unknown {
    this.index += 1;
    return this.state;
  }
}

/** What Next's router writes: its own state, without the count. */
const nextState = (url: string) => ({ __NA: true, __PRIVATE_NEXTJS_INTERNALS_TREE: url });

describe("the trail (createTrail) over a tab's history", () => {
  it("opened straight onto a screen from another site: Back goes to the parent, never out of the app", () => {
    const h = new FakeHistory("/dishes/dsh_1", ["https://mail.example/inbox"]);
    const trail = createTrail(h);
    trail.start();
    expect(trailStamp(h.state)).toBe(0);
    expect(trail.canGoBack()).toBe(false);
    // Back replaces with the parent; on the group, Back again goes to Groups, not to the mail.
    h.replaceState(nextState("/groups/flat"), "", "/groups/flat");
    expect(trail.canGoBack()).toBe(false);
  });

  it("navigated in: Back goes back, all the way to the first screen and no further", () => {
    const h = new FakeHistory("/home");
    const trail = createTrail(h);
    trail.start();
    h.pushState(nextState("/groups"), "", "/groups");
    h.pushState(nextState("/groups/flat"), "", "/groups/flat");
    expect(trailStamp(h.state)).toBe(2);
    expect(trail.canGoBack()).toBe(true);
    trail.pop(h.back());
    expect(h.url).toBe("/groups");
    expect(trail.canGoBack()).toBe(true);
    trail.pop(h.back());
    expect(h.url).toBe("/home");
    expect(trail.canGoBack()).toBe(false);
    // Forward again knows its count.
    trail.pop(h.forward());
    expect(trail.canGoBack()).toBe(true);
  });

  it("counts a push after going back (the history did not grow) as a push", () => {
    // Home → a dish → back → an item: Back on the item returns Home.
    const h = new FakeHistory("/home");
    const trail = createTrail(h);
    trail.start();
    h.pushState(nextState("/dishes/dsh_1"), "", "/dishes/dsh_1");
    trail.pop(h.back());
    h.pushState(nextState("/pantry/me:itm_1"), "", "/pantry/me:itm_1");
    expect(h.entries).toHaveLength(2);
    expect(trail.canGoBack()).toBe(true);
    trail.pop(h.back());
    expect(h.url).toBe("/home");
  });

  it("keeps the count through the router's replaces (it rewrites the entry without it)", () => {
    const h = new FakeHistory("/home");
    const trail = createTrail(h);
    trail.start();
    h.pushState(nextState("/use?item=me:itm_1"), "", "/use?item=me:itm_1");
    h.replaceState(nextState("/use"), "", "/use");
    expect(trailStamp(h.state)).toBe(1);
    expect(h.state).toMatchObject({ __NA: true });
    expect(trail.canGoBack()).toBe(true);
  });

  it("passes everything through untouched while the frame is down, and starts afresh when it is back", () => {
    const h = new FakeHistory("/home");
    const trail = createTrail(h);
    trail.start();
    h.pushState(nextState("/dishes/dsh_1"), "", "/dishes/dsh_1");
    trail.stop(); // to sign-in
    h.pushState(nextState("/login"), "", "/login");
    expect(trailStamp(h.state)).toBeNull();
    expect(trail.canGoBack()).toBe(false);
    h.pushState(nextState("/dishes/dsh_2"), "", "/dishes/dsh_2");
    trail.start(); // the frame again, on a screen it did not push
    expect(trail.canGoBack()).toBe(false);
    // Back from sign-in onto a screen the frame stamped: its count holds.
    trail.stop();
    h.back();
    h.back();
    trail.start();
    expect(h.url).toBe("/dishes/dsh_1");
    expect(trail.canGoBack()).toBe(true);
  });

  it("trusts the stamp after a reload", () => {
    const h = new FakeHistory("/home");
    createTrail(h).start();
    h.pushState(nextState("/people/usr_1"), "", "/people/usr_1");
    // A reload: a new page load, the same entries.
    const reloaded = createTrail(h);
    reloaded.start();
    expect(reloaded.canGoBack()).toBe(true);
  });

  it("wraps the history once however often the frame mounts", () => {
    const h = new FakeHistory("/home");
    const trail = createTrail(h);
    trail.start();
    const push = h.pushState;
    trail.stop();
    trail.start();
    expect(h.pushState).toBe(push);
    h.pushState(nextState("/you"), "", "/you");
    expect(trailStamp(h.state)).toBe(1);
  });
});
