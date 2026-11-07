// A handler's catch-all 500 leaves one log line (Cookpool PW-10): where, the
// request id, the error's name and message — and nothing from the request.
import { logUnexpected } from "@notifications-worker/http";

describe("logUnexpected", () => {
  let lines: string[];
  const original = console.error;

  beforeEach(() => {
    lines = [];
    console.error = (...args: unknown[]) => void lines.push(args.map(String).join(" "));
  });

  afterEach(() => {
    console.error = original;
  });

  it("names where, the request id, and the error's name and message, on one line", () => {
    logUnexpected("put-preferences", "req_1", new TypeError("Cannot read properties of undefined (reading 'x')"));
    expect(lines).toEqual([
      "[notifications-worker] put-preferences req_1: TypeError: Cannot read properties of undefined (reading 'x')",
    ]);
  });

  it("logs a thrown non-Error by its type and text", () => {
    logUnexpected("enqueue", "req_2", "boom");
    expect(lines).toEqual(["[notifications-worker] enqueue req_2: string: boom"]);
  });

  it("keeps a long message to 300 characters", () => {
    logUnexpected("push", "req_3", new Error("x".repeat(1000)));
    expect(lines[0]!.endsWith("x".repeat(300))).toBe(true);
    expect(lines[0]!.length).toBeLessThan(400);
  });

  it("logs only the error, never other properties a thrown object carries", () => {
    const err = Object.assign(new Error("db failed"), { body: "secret-body", token: "tok_secret" });
    logUnexpected("get-preferences", "req_4", err);
    expect(lines[0]).not.toContain("secret-body");
    expect(lines[0]).not.toContain("tok_secret");
  });
});
