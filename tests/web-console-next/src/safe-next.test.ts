import {
  HOME_PATH,
  loginPathFor,
  nextParamFrom,
  postLoginDestination,
  safeNextPath,
} from "@web-console-next/lib/safe-next";

describe("safeNextPath", () => {
  it("accepts same-origin paths, keeping query and hash", () => {
    expect(safeNextPath("/join/KTCH2345")).toBe("/join/KTCH2345");
    expect(safeNextPath("/groups/flat-4b?tab=rules#invite")).toBe("/groups/flat-4b?tab=rules#invite");
    expect(safeNextPath("/orgs/acme/settings")).toBe("/orgs/acme/settings");
    expect(safeNextPath("  /home  ")).toBe("/home");
  });

  it("rejects absolute and cross-origin URLs", () => {
    expect(safeNextPath("https://evil.example/join/KTCH2345")).toBeNull();
    expect(safeNextPath("http://evil.example")).toBeNull();
    expect(safeNextPath("javascript:alert(1)")).toBeNull();
    expect(safeNextPath("data:text/html,hi")).toBeNull();
    expect(safeNextPath("evil.example/join")).toBeNull();
    expect(safeNextPath("join/KTCH2345")).toBeNull();
  });

  it("rejects protocol-relative URLs, however they are spelled", () => {
    expect(safeNextPath("//evil.example")).toBeNull();
    expect(safeNextPath("//evil.example/join/KTCH2345")).toBeNull();
    expect(safeNextPath("/\\evil.example")).toBeNull();
    expect(safeNextPath("\\\\evil.example")).toBeNull();
    expect(safeNextPath("/..//evil.example")).toBeNull();
    expect(safeNextPath("/./\\evil.example")).toBeNull();
  });

  it("rejects control characters (stripped by browsers before parsing)", () => {
    expect(safeNextPath("/\t/evil.example")).toBeNull();
    expect(safeNextPath("/\n/evil.example")).toBeNull();
    expect(safeNextPath("/home\u0000")).toBeNull();
  });

  it("rejects the sign-in pages themselves (no loops)", () => {
    expect(safeNextPath("/login")).toBeNull();
    expect(safeNextPath("/login?next=/home")).toBeNull();
    expect(safeNextPath("/auth/callback")).toBeNull();
  });

  it("rejects missing values", () => {
    expect(safeNextPath(null)).toBeNull();
    expect(safeNextPath(undefined)).toBeNull();
    expect(safeNextPath("")).toBeNull();
  });
});

describe("postLoginDestination", () => {
  it("goes to a safe next path", () => {
    expect(postLoginDestination("/join/KTCH2345")).toBe("/join/KTCH2345");
  });

  it("falls back to Home for a missing or unsafe one", () => {
    expect(HOME_PATH).toBe("/home");
    expect(postLoginDestination(null)).toBe("/home");
    expect(postLoginDestination("https://evil.example")).toBe("/home");
    expect(postLoginDestination("//evil.example")).toBe("/home");
  });
});

describe("loginPathFor", () => {
  it("carries a safe path through sign-in, encoded", () => {
    expect(loginPathFor("/join/KTCH2345")).toBe("/login?next=%2Fjoin%2FKTCH2345");
    expect(loginPathFor("/groups/flat-4b?x=1")).toBe("/login?next=%2Fgroups%2Fflat-4b%3Fx%3D1");
  });

  it("is plain /login for the root, Home, or an unsafe path", () => {
    expect(loginPathFor("/")).toBe("/login");
    expect(loginPathFor("/home")).toBe("/login");
    expect(loginPathFor("//evil.example")).toBe("/login");
    expect(loginPathFor(null)).toBe("/login");
  });

  it("round-trips through the login page's query string", () => {
    const login = loginPathFor("/join/KTCH2345?ref=wa");
    const search = login.slice(login.indexOf("?"));
    expect(postLoginDestination(nextParamFrom(search))).toBe("/join/KTCH2345?ref=wa");
  });
});
