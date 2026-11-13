import { readFileSync } from "node:fs";
import { cwd } from "node:process";
import { BINDING_PROPS } from "@/worker/api-forward.mjs";
import { handoffNext, rememberName, rememberedName, signInViaSplitecoUrl, splitecoGroupUrl, splitecoOriginFor } from "@/lib/links";
import { km, parseRupees, rupees, rupeesDecimal, signedRupees } from "@/lib/money";
import { needLine, tabIndexOf, tabPath } from "@/lib/home";
import { myNet, rideAmount } from "@/lib/rides";
import type { TripecoProof, TripecoRide } from "@saas/contracts/tripeco";

// The Tripeco app (tripeco TR-5): its pure rules, its look and its Worker.

const APP = `${cwd()}/../../apps/tripeco-web`;
const STAGE = "cookpool-tripeco-web-stage.cookpool.workers.dev";

describe("signing in through Spliteco (design §0.10)", () => {
  it("uses this environment's Spliteco only", () => {
    expect(splitecoOriginFor(STAGE)).toBe("https://cookpool-spliteco-web-stage.cookpool.workers.dev");
    expect(splitecoOriginFor("cookpool-tripeco-web-prod.cookpool.workers.dev")).toBe("https://cookpool-spliteco-web-prod.cookpool.workers.dev");
    expect(splitecoOriginFor("localhost:3003")).toBe("http://localhost:3002");
    expect(splitecoOriginFor("evil.example")).toBeNull();
  });
  it("sends you to Spliteco's /handoff/out with this origin and where to go next", () => {
    const url = new URL(signInViaSplitecoUrl(`https://${STAGE}`, STAGE, "/ride?id=trp_1")!);
    expect(url.origin + url.pathname).toBe("https://cookpool-spliteco-web-stage.cookpool.workers.dev/handoff/out");
    expect(url.searchParams.get("to")).toBe(`https://${STAGE}`);
    expect(url.searchParams.get("next")).toBe("/ride?id=trp_1");
    expect(new URL(signInViaSplitecoUrl(`https://${STAGE}`, STAGE, "/")!).searchParams.has("next")).toBe(false);
  });
  it("opens only an own path after the handoff", () => {
    expect(handoffNext("/ride?id=trp_1")).toBe("/ride?id=trp_1");
    for (const bad of [null, "", "//evil.example", "https://evil.example", "/sign-in", "/handoff?code=x", "/\\evil"]) expect(handoffNext(bad)).toBe("/");
  });
  it("remembers a first name for Continue as …", () => {
    const store = new Map<string, string>();
    const s = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
    expect(rememberedName(s)).toBeNull();
    rememberName(s, "Rahul Varghese", "r@example.com");
    expect(rememberedName(s)).toBe("Rahul");
    rememberName(s, null, "anu@example.com");
    expect(rememberedName(s)).toBe("anu");
  });
  it("links to a group in Spliteco", () => {
    expect(splitecoGroupUrl(STAGE, "org_1")).toBe("https://cookpool-spliteco-web-stage.cookpool.workers.dev/group?id=org_1");
    expect(splitecoGroupUrl(STAGE, null)).toBe("https://cookpool-spliteco-web-stage.cookpool.workers.dev/groups");
  });
});

describe("money and distance", () => {
  it("shows whole rupees, Indian grouping, and signs", () => {
    expect(rupees(69300)).toBe("₹693");
    expect(rupees(312000)).toBe("₹3,120");
    expect(signedRupees(51900)).toBe("+₹519");
    expect(signedRupees(-17300)).toBe("−₹173");
    expect(signedRupees(0)).toBe("₹0");
    expect(rupeesDecimal(559)).toBe("₹5.6");
    expect(parseRupees("104.5")).toBe(10450);
    expect(parseRupees("₹1,250")).toBe(125000);
    expect(parseRupees("abc")).toBeNull();
    expect(km(48336)).toBe("48,336");
    expect(km(124)).toBe("124");
    expect(km(124.5)).toBe("124.5");
  });
});

describe("tabs and rows", () => {
  it("maps addresses to tabs and back", () => {
    expect(["/", "/vehicles", "/groups", "/groups/", "/nope"].map(tabIndexOf)).toEqual([0, 1, 2, 2, -1]);
    expect([0, 1, 2, 9].map(tabPath)).toEqual(["/", "/vehicles", "/groups", "/"]);
    expect(needLine("Airport drop", 25700)).toBe("Airport drop · ₹257");
    expect(needLine("Swift end km", null)).toBe("Swift end km");
  });
  const ride = (over: Partial<TripecoRide>): TripecoRide =>
    ({
      state: "done",
      solo: false,
      totalMinor: 69300,
      riders: [
        { subjectId: "me", on: true, km: 124, shareMinor: 17400 },
        { subjectId: "anu", on: true, km: 124, shareMinor: 17300 },
      ],
      ...over,
    }) as TripecoRide;
  it("a posted ride reads +what riders owe; a ride to post its total; a solo drive dim", () => {
    expect(rideAmount(ride({ state: "posted" }))).toEqual({ text: "+₹173", tone: "get" });
    expect(rideAmount(ride({}))).toEqual({ text: "₹693", tone: "money" });
    expect(rideAmount(ride({ solo: true }))).toEqual({ text: "₹693", tone: "dim" });
  });
  it("your side of a group's rides", () => {
    const p = { ownerSubject: "me", riders: [{ subjectId: "me", shareMinor: 100 }, { subjectId: "anu", shareMinor: 300 }] } as TripecoProof;
    expect(myNet(p, "me")).toBe(300);
    expect(myNet(p, "anu")).toBe(-300);
    expect(myNet(p, "dev")).toBe(-0);
  });
});

describe("the look and the Worker", () => {
  it("is Asphalt & lime with Plus Jakarta Sans and Share Tech Mono", () => {
    const css = readFileSync(`${APP}/src/app/globals.css`, "utf8").toLowerCase();
    for (const hex of ["#0b0c0e", "#060708", "#17191c", "#22252a", "#24272c", "#3a3e45", "#8e949c", "#f2f3f5", "#c6f432", "#141a04", "#d9f99d", "#ffc857", "#5eead4", "#ff8a7a", "#2563eb"]) {
      expect(css).toContain(hex);
    }
    const layout = readFileSync(`${APP}/src/app/layout.tsx`, "utf8");
    expect(layout).toContain("@fontsource-variable/plus-jakarta-sans");
    expect(layout).toContain("@fontsource/share-tech-mono");
  });
  it("forwards /api with the caller api-edge trusts", () => {
    expect(BINDING_PROPS).toEqual({ caller: "tripeco-web" });
    const wrangler = readFileSync(`${APP}/wrangler.jsonc`, "utf8");
    expect(wrangler).toContain('"name": "cookpool-tripeco-web"');
    expect(wrangler).toContain('"service": "cookpool-api-edge-stage"');
    expect(wrangler).not.toContain("spliteco-web");
  });
  it("uses the shared gesture package, not a copy", () => {
    const surface = readFileSync(`${APP}/src/components/tab-surface.tsx`, "utf8");
    expect(surface).toContain('from "@saas/gestures/react/pager"');
  });
});

describe("the stage checks' fixes (TR-9)", () => {
  it("Posted reads its group on its own and tries again", () => {
    const posted = readFileSync(`${APP}/src/app/posted/page.tsx`, "utf8");
    expect(posted).toContain("read(2)");
    expect(posted).toContain("setTimeout(() => read(left - 1), 800)");
  });
  it("Add vehicle's fuel choices have names", () => {
    expect(readFileSync(`${APP}/src/app/vehicle/new/page.tsx`, "utf8")).toContain("aria-label={FUEL_LABEL[f]}");
  });
});
