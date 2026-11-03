import {
  JOIN_CODE_ALPHABET,
  extractJoinCode,
  formatJoinCode,
  joinFailureKind,
  joinPath,
  joinUrl,
  normalizeJoinCode,
} from "@web-console-next/components/kitchen/join-code";

describe("normalizeJoinCode (mirrors membership-worker ids.ts)", () => {
  it("upper-cases and drops spaces and dashes", () => {
    expect(normalizeJoinCode(" ktch-2345")).toBe("KTCH2345");
    expect(normalizeJoinCode("KTCH 2345")).toBe("KTCH2345");
    expect(normalizeJoinCode("k-t-c-h-2-3-4-5")).toBe("KTCH2345");
  });

  it("refuses anything that cannot be a code", () => {
    expect(normalizeJoinCode("")).toBeNull();
    expect(normalizeJoinCode("KTCH234")).toBeNull(); // too short
    expect(normalizeJoinCode("KTCH23456")).toBeNull(); // too long
    expect(normalizeJoinCode("KTCH0O1I")).toBeNull(); // look-alikes are not in the alphabet
    expect(normalizeJoinCode("KTCH_234")).toBeNull();
  });

  it("uses the server's alphabet, without 0/O and 1/I/L", () => {
    expect(JOIN_CODE_ALPHABET).not.toMatch(/[0O1IL]/);
    expect(JOIN_CODE_ALPHABET).toHaveLength(31);
  });
});

describe("extractJoinCode", () => {
  it("accepts the code on its own, typed any way", () => {
    expect(extractJoinCode("KTCH2345")).toBe("KTCH2345");
    expect(extractJoinCode("  ktch-2345 ")).toBe("KTCH2345");
  });

  it("finds the code in a pasted link", () => {
    expect(extractJoinCode("https://cookpool-web-console-next-prod.example.workers.dev/join/KTCH2345")).toBe(
      "KTCH2345",
    );
    expect(extractJoinCode("https://cookpool.store/join/ktch-2345?ref=whatsapp#top")).toBe("KTCH2345");
    expect(extractJoinCode("cookpool.store/join/KTCH2345/")).toBe("KTCH2345");
    expect(extractJoinCode("/join/KTCH%202345")).toBe("KTCH2345");
    expect(extractJoinCode("join/ktch2345")).toBe("KTCH2345");
    expect(extractJoinCode("HTTPS://COOKPOOL.APP/JOIN/KTCH2345")).toBe("KTCH2345");
  });

  it("keeps only the code from another host's link (joining happens on this app)", () => {
    expect(extractJoinCode("https://evil.example/join/KTCH2345")).toBe("KTCH2345");
  });

  it("returns null when there is no code", () => {
    expect(extractJoinCode("")).toBeNull();
    expect(extractJoinCode("   ")).toBeNull();
    expect(extractJoinCode(null)).toBeNull();
    expect(extractJoinCode("https://cookpool.store/join/")).toBeNull();
    expect(extractJoinCode("https://cookpool.store/groups/flat-4b")).toBeNull();
    expect(extractJoinCode("/join/%E0%A4%A")).toBeNull(); // malformed escape, not a code
    expect(extractJoinCode("hello there")).toBeNull();
  });
});

describe("join links", () => {
  it("formats a code for reading aloud", () => {
    expect(formatJoinCode("KTCH2345")).toBe("KTCH-2345");
    expect(formatJoinCode("ABC")).toBe("ABC");
  });

  it("builds the in-app path and the shareable URL", () => {
    expect(joinPath("KTCH2345")).toBe("/join/KTCH2345");
    expect(joinUrl("https://cookpool.store", "KTCH2345")).toBe("https://cookpool.store/join/KTCH2345");
    expect(joinUrl("https://cookpool.store/", "KTCH2345")).toBe("https://cookpool.store/join/KTCH2345");
  });

  it("round-trips: a shared URL extracts back to its code", () => {
    expect(extractJoinCode(joinUrl("https://cookpool.store", "KTCH2345"))).toBe("KTCH2345");
  });
});

describe("joinFailureKind", () => {
  it("an unknown or rotated code is not found", () => {
    expect(joinFailureKind({ code: "not_found" }, 404)).toBe("not_found");
  });

  it("a 412 is a full group, or too many groups for the person", () => {
    expect(joinFailureKind({ code: "precondition_failed", reason: "limit_reached" }, 412)).toBe("full");
    expect(joinFailureKind({ code: "precondition_failed" }, 412)).toBe("full");
    expect(joinFailureKind({ code: "precondition_failed", reason: "groups_per_person" }, 412)).toBe(
      "too_many_groups",
    );
  });

  it("anything else is a plain error", () => {
    expect(joinFailureKind({ code: "network_error" }, 0)).toBe("error");
    expect(joinFailureKind({ code: "internal_error" }, 503)).toBe("error");
  });
});
