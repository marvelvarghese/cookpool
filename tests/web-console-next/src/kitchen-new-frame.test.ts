import {
  KITCHEN_SIDEBAR_LINKS,
  KITCHEN_TABS,
  NEW_FRAME_TABS,
  activeKitchenTab,
  activeNewFrameTab,
  isTabActiveIn,
  kitchenTabs,
  sidebarLinks,
} from "@web-console-next/components/kitchen/nav";
import { KITCHEN_ICONS } from "@web-console-next/components/kitchen/icons";
import { NEW_FRAME_TAB_PAGES, TAB_PAGES, backParent } from "@web-console-next/components/kitchen/back";
import { edgeSwipeBackOn, pullsToRefresh } from "@web-console-next/components/kitchen/gestures";
import { STATIC_PAGES } from "@web-console-next/lib/static-pages.mjs";
import { MANIFEST_SHORTCUTS, NEW_FRAME_SHORTCUTS, buildManifest } from "@web-console-next/lib/manifest";
import { GET } from "@web-console-next/app/manifest.webmanifest/route";

// cookpool-recipes RC-2 (design §1.1, §1.2): the new frame — five tabs,
// Home · Pantry · Cook · Money · You — is on everywhere but prod, read at
// runtime from the environment the page's host names. Prod keeps today's
// five (Home · Pantry · + Add · Groups · People).

describe("the tabs in each frame", () => {
  it("are today's five with newFrame() false: Home · Pantry · + Add · Groups · People", () => {
    expect(kitchenTabs(false)).toBe(KITCHEN_TABS);
    expect(kitchenTabs(false).map((t) => t.label)).toEqual(["Home", "Kitchen", "Add", "Groups", "People"]);
    expect(sidebarLinks(false)).toBe(KITCHEN_SIDEBAR_LINKS);
    expect(sidebarLinks(false).map((l) => l.label)).toEqual(["Home", "Kitchen", "Groups", "People", "Me"]);
  });

  it("are Home · Pantry · Cook · Money · You in the new frame, with no + Add", () => {
    expect(kitchenTabs(true).map((t) => [t.label, t.kind === "link" ? t.href : null])).toEqual([
      ["Home", "/home"],
      ["Kitchen", "/pantry"],
      ["Cook", "/cook"],
      ["Money", "/money"],
      ["You", "/you"],
    ]);
    expect(kitchenTabs(true).some((t) => t.kind === "action")).toBe(false);
    for (const t of NEW_FRAME_TABS) expect(KITCHEN_ICONS[t.icon]).toBeDefined();
  });

  it("put Cook in the middle, the one featured tab (its icon in a filled green square)", () => {
    expect(NEW_FRAME_TABS[2]!.id).toBe("cook");
    expect(NEW_FRAME_TABS.filter((t) => t.featured).map((t) => t.id)).toEqual(["cook"]);
  });

  it("are the same five in the sidebar from 900px", () => {
    expect(sidebarLinks(true).map((l) => [l.label, l.href])).toEqual(NEW_FRAME_TABS.map((t) => [t.label, t.href]));
  });

  it("are pages served as files, every one", () => {
    for (const t of NEW_FRAME_TABS) expect(STATIC_PAGES).toContain(t.href);
  });
});

describe("the new frame's active tab", () => {
  it("matches each tab's own path and what is under it", () => {
    expect(activeNewFrameTab("/home")).toBe("home");
    expect(activeNewFrameTab("/pantry/me:itm_1")).toBe("pantry");
    expect(activeNewFrameTab("/pantry/new")).toBe("pantry");
    expect(activeNewFrameTab("/cook")).toBe("cook");
    expect(activeNewFrameTab("/money")).toBe("money");
    expect(activeNewFrameTab("/you")).toBe("you");
    expect(activeNewFrameTab("/you/settings")).toBe("you");
    expect(activeNewFrameTab("/you/notifications")).toBe("you");
  });

  it("puts people, settling up and groups under Money (money lives in Money)", () => {
    for (const path of ["/people", "/people/usr_1", "/settle", "/groups", "/groups/flat-4b", "/groups/flat-4b/expense", "/join/KTCH2345"]) {
      expect([path, activeNewFrameTab(path)]).toEqual([path, "money"]);
    }
  });

  it("puts Use under Home, and a dish and the recipe screens under Cook", () => {
    expect(activeNewFrameTab("/use")).toBe("home");
    expect(activeNewFrameTab("/dishes/dsh_1")).toBe("cook");
    expect(activeNewFrameTab("/recipes/rcp_1")).toBe("cook");
    expect(activeNewFrameTab("/r/AB12")).toBe("cook");
  });

  it("matches no sibling prefix and nothing outside the app", () => {
    expect(activeNewFrameTab("/moneybox")).toBeNull();
    expect(activeNewFrameTab("/young")).toBeNull();
    expect(activeNewFrameTab("/rx")).toBeNull();
    expect(activeNewFrameTab("/orgs/acme")).toBeNull();
    expect(activeNewFrameTab(null)).toBeNull();
  });

  it("leaves today's matching as it was with newFrame() false", () => {
    expect(isTabActiveIn(false, "people", "/people/usr_1")).toBe(true);
    expect(isTabActiveIn(false, "money", "/people/usr_1")).toBe(false);
    expect(isTabActiveIn(false, "groups", "/join/KTCH2345")).toBe(true);
    expect(activeKitchenTab("/cook")).toBeNull();
    expect(isTabActiveIn(true, "money", "/people/usr_1")).toBe(true);
    expect(isTabActiveIn(true, "add", "/home")).toBe(false);
  });
});

describe("Back in the new frame", () => {
  it("has no back control on the new five", () => {
    for (const tab of NEW_FRAME_TAB_PAGES) expect(backParent(tab, {}, { newFrame: true })).toBeNull();
    expect(NEW_FRAME_TAB_PAGES).toEqual(NEW_FRAME_TABS.map((t) => t.href));
  });

  it("takes Groups, People, a group, a person and a join link back to Money", () => {
    for (const path of ["/groups", "/people", "/groups/flat-4b", "/people/usr_1", "/join/KTCH2345", "/settle"]) {
      expect([path, backParent(path, {}, { newFrame: true })]).toEqual([path, "/money"]);
    }
  });

  it("takes settings back to You, and Notifications back to settings", () => {
    expect(backParent("/you/settings", {}, { newFrame: true })).toBe("/you");
    expect(backParent("/you/notifications", {}, { newFrame: true })).toBe("/you");
    // RV-6: Your recipes and cooks, You's Account row.
    expect(backParent("/you/cooks", {}, { newFrame: true })).toBe("/you");
  });

  it("keeps every other parent", () => {
    expect(backParent("/groups/flat-4b/expense", {}, { newFrame: true })).toBe("/groups/flat-4b");
    expect(backParent("/dishes/dsh_1", { groupSlug: "flat-4b" }, { newFrame: true })).toBe("/groups/flat-4b");
    expect(backParent("/use", {}, { newFrame: true })).toBe("/home");
  });

  it("is today's with newFrame() false, and the new pages have a parent there", () => {
    for (const tab of TAB_PAGES) expect(backParent(tab)).toBeNull();
    expect(backParent("/you")).toBe("/home");
    expect(backParent("/people/usr_1")).toBe("/people");
    expect(backParent("/money")).toBe("/home");
    expect(backParent("/you/settings")).toBe("/you");
  });

  it("swipes back on the installed iPhone by the same rule", () => {
    const iphone = { userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X)", maxTouchPoints: 5, standalone: true };
    expect(edgeSwipeBackOn(iphone, "/money", true)).toBe(false);
    expect(edgeSwipeBackOn(iphone, "/you", true)).toBe(false);
    expect(edgeSwipeBackOn(iphone, "/groups", true)).toBe(true);
    expect(edgeSwipeBackOn(iphone, "/you")).toBe(true);
    expect(edgeSwipeBackOn(iphone, "/groups")).toBe(false);
  });

  it("pulls Money to refresh", () => {
    expect(pullsToRefresh("/money")).toBe(true);
    expect(pullsToRefresh("/you/settings")).toBe(false);
  });
});

describe("the home-screen shortcuts in each frame (design §1.2)", () => {
  const names = (m: ReturnType<typeof buildManifest>) => m.shortcuts.map((s) => [s.name, s.url]);

  it("are What did you use? and Start cooking in the new frame", () => {
    expect(names(buildManifest("cookpool", { newFrame: true }))).toEqual([
      ["What did you use?", "/use"],
      ["Start cooking", "/cook"],
    ]);
    for (const s of NEW_FRAME_SHORTCUTS) expect(MANIFEST_SHORTCUTS.flatMap((m) => m.icons.map((i) => i.src))).toContain(s.icons[0]!.src);
  });

  it("are today's three with newFrame() false", () => {
    expect(names(buildManifest("cookpool"))).toEqual(MANIFEST_SHORTCUTS.map((s) => [s.name, s.url]));
    expect(names(buildManifest("cookpool", { newFrame: false }))).toEqual(MANIFEST_SHORTCUTS.map((s) => [s.name, s.url]));
  });

  it("follow the host the manifest is asked for on: stage gets the new ones, prod keeps today's", async () => {
    const served = async (url?: string) => names((await GET(url ? new Request(url) : undefined).json()) as ReturnType<typeof buildManifest>);
    expect(await served("https://stage.cookpool.store/manifest.webmanifest")).toEqual([
      ["What did you use?", "/use"],
      ["Start cooking", "/cook"],
    ]);
    expect(await served("https://cookpool-web-console-next-stage.cookpool.workers.dev/manifest.webmanifest")).toHaveLength(2);
    expect(await served("https://cookpool.store/manifest.webmanifest")).toEqual(MANIFEST_SHORTCUTS.map((s) => [s.name, s.url]));
    expect(await served("https://cookpool-web-console-next-prod.cookpool.workers.dev/manifest.webmanifest")).toHaveLength(3);
    // A host that names no environment, or no request at all: today's, so prod's can never change by accident.
    expect(await served("http://localhost:3001/manifest.webmanifest")).toHaveLength(3);
    expect(await served()).toHaveLength(3);
  });
});
