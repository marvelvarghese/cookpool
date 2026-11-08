import { browserAppConfig } from "@web-console-next/lib/app-config";
import { frameRedirect, newFrame, newFrameFor } from "@web-console-next/lib/features";

// cookpool-recipes RC-2 (design §1.1): stage first. The new frame is on
// wherever the app is not prod, read at runtime from the environment the
// page's host names (one build serves every environment).

describe("newFrame(): on everywhere but prod, from the page's host", () => {
  const onHost = (host: string) => newFrame(browserAppConfig(host));

  it("is off on prod, by its custom domain and its workers.dev host", () => {
    expect(onHost("cookpool.store")).toBe(false);
    expect(onHost("cookpool-web-console-next-prod.cookpool.workers.dev")).toBe(false);
  });

  it("is on on stage, by its custom domain and its workers.dev host", () => {
    expect(onHost("stage.cookpool.store")).toBe(true);
    expect(onHost("cookpool-web-console-next-stage.cookpool.workers.dev")).toBe(true);
  });

  it("is on on a workers.dev host that names no environment, and on localhost", () => {
    expect(onHost("cookpool-web-console-next.cookpool.workers.dev")).toBe(true);
    expect(onHost("localhost:3001")).toBe(true);
    expect(onHost("127.0.0.1:3001")).toBe(true);
  });

  it("is decided by the environment alone", () => {
    expect(newFrameFor("prod")).toBe(false);
    expect(newFrameFor("stage")).toBe(true);
    expect(newFrameFor("dev")).toBe(true);
    expect(newFrameFor(undefined)).toBe(true);
    expect(newFrameFor(null)).toBe(true);
  });
});

describe("pages that exist only in the new frame", () => {
  it("send a prod visitor away: Money to Home, settings to You", () => {
    expect(frameRedirect("/money", false)).toBe("/home");
    expect(frameRedirect("/you/settings", false)).toBe("/you");
  });

  it("stay put in the new frame, and every other page stays put in both", () => {
    expect(frameRedirect("/money", true)).toBeNull();
    expect(frameRedirect("/you/settings", true)).toBeNull();
    for (const page of ["/home", "/you", "/people/:subjectId", "/cook"]) {
      expect(frameRedirect(page, false)).toBeNull();
      expect(frameRedirect(page, true)).toBeNull();
    }
  });
});
