import { safeTripecoTarget, tripecoHandoffUrl, tripecoOriginFor, tripecoRideHref } from "@/lib/tripeco-link";

// Spliteco ↔ Tripeco (tripeco TR-5): Tripeco signs in through /handoff/out
// here; only this environment's Tripeco is ever a handoff target.

const STAGE = "cookpool-spliteco-web-stage.cookpool.workers.dev";
const TRIPECO_STAGE = "https://cookpool-tripeco-web-stage.cookpool.workers.dev";

describe("Tripeco's address", () => {
  it("is this environment's", () => {
    expect(tripecoOriginFor(STAGE)).toBe(TRIPECO_STAGE);
    expect(tripecoOriginFor("cookpool-spliteco-web-prod.cookpool.workers.dev")).toBe("https://cookpool-tripeco-web-prod.cookpool.workers.dev");
    expect(tripecoOriginFor("localhost:3002")).toBe("http://localhost:3003");
    expect(tripecoOriginFor("spliteco.example")).toBeNull();
  });
  it("is the only handoff target", () => {
    expect(safeTripecoTarget(TRIPECO_STAGE, STAGE)).toBe(TRIPECO_STAGE);
    expect(safeTripecoTarget(`${TRIPECO_STAGE}/`, STAGE)).toBe(TRIPECO_STAGE);
    for (const bad of [
      "https://cookpool-tripeco-web-prod.cookpool.workers.dev",
      "https://evil.example",
      `${TRIPECO_STAGE}/steal`,
      "https://user:pw@cookpool-tripeco-web-stage.cookpool.workers.dev",
      "javascript:alert(1)",
      null,
    ]) {
      expect(safeTripecoTarget(bad, STAGE)).toBeNull();
    }
    expect(safeTripecoTarget("http://localhost:3003", "localhost:3002")).toBe("http://localhost:3003");
    expect(safeTripecoTarget("https://evil.example", "localhost:3002")).toBeNull();
  });
  it("lands on Tripeco's /handoff with the code and an own path", () => {
    const url = new URL(tripecoHandoffUrl(TRIPECO_STAGE, "hoc_x", "/ride?id=trp_1"));
    expect(url.origin + url.pathname).toBe(`${TRIPECO_STAGE}/handoff`);
    expect(url.searchParams.get("code")).toBe("hoc_x");
    expect(url.searchParams.get("next")).toBe("/ride?id=trp_1");
    expect(new URL(tripecoHandoffUrl(TRIPECO_STAGE, "hoc_x", "//evil.example")).searchParams.has("next")).toBe(false);
  });
  it("opens a ride in Tripeco (Edit in Tripeco, TR-7)", () => {
    const id = `trp_${"a".repeat(32)}`;
    expect(tripecoRideHref(STAGE, id)).toBe(`${TRIPECO_STAGE}/ride?id=${id}`);
    expect(tripecoRideHref(STAGE, "trp_bad")).toBeNull();
  });
});
