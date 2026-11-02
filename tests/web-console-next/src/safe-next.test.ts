import {
  HOME_PATH,
  SIGNED_OUT_PARAM,
  STEP_PARAM,
  loginPathFor,
  nameStepFrom,
  nameStepPath,
  nextParamFrom,
  postLoginDestination,
  safeNextPath,
  signedOutFrom,
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

describe("loginPathFor after a 401 (Cookpool SI-5)", () => {
  it("adds expired=1 after a safe next", () => {
    expect(SIGNED_OUT_PARAM).toBe("expired");
    expect(loginPathFor("/pantry", { signedOut: true })).toBe("/login?next=%2Fpantry&expired=1");
    expect(loginPathFor("/groups/flat-4b?tab=rules", { signedOut: true })).toBe(
      "/login?next=%2Fgroups%2Fflat-4b%3Ftab%3Drules&expired=1",
    );
  });

  it("is just the flag for Home, the root, or an unsafe path", () => {
    expect(loginPathFor("/home", { signedOut: true })).toBe("/login?expired=1");
    expect(loginPathFor("/", { signedOut: true })).toBe("/login?expired=1");
    expect(loginPathFor("//evil.example", { signedOut: true })).toBe("/login?expired=1");
  });

  it("round-trips: the page reads both the flag and next", () => {
    const login = loginPathFor("/join/KTCH2345", { signedOut: true });
    const search = login.slice(login.indexOf("?"));
    expect(signedOutFrom(search)).toBe(true);
    expect(postLoginDestination(nextParamFrom(search))).toBe("/join/KTCH2345");
    expect(signedOutFrom(loginPathFor("/join/KTCH2345").slice(6))).toBe(false);
    expect(signedOutFrom("?expired=0")).toBe(false);
    expect(signedOutFrom("")).toBe(false);
  });
});

describe("the Name step's URL (Cookpool SI-6)", () => {
  it("asks for the Name step and returns to a safe next", () => {
    expect(STEP_PARAM).toBe("step");
    expect(nameStepPath("/join/KTCH2345")).toBe("/login?step=name&next=%2Fjoin%2FKTCH2345");
    expect(nameStepPath("/pantry?filter=soon")).toBe("/login?step=name&next=%2Fpantry%3Ffilter%3Dsoon");
  });

  it("carries no next for Home, the root, nothing, or an unsafe path", () => {
    expect(nameStepPath("/home")).toBe("/login?step=name");
    expect(nameStepPath("/")).toBe("/login?step=name");
    expect(nameStepPath(null)).toBe("/login?step=name");
    expect(nameStepPath("//evil.example")).toBe("/login?step=name");
    expect(nameStepPath("https://evil.example/home")).toBe("/login?step=name");
  });

  it("never names the sign-in page itself as next (no loop back to the step)", () => {
    expect(nameStepPath("/login?step=name&next=%2Fhome")).toBe("/login?step=name");
    expect(nameStepPath("/auth/callback")).toBe("/login?step=name");
  });

  it("round-trips: the page reads the step and next", () => {
    const path = nameStepPath("/join/KTCH2345");
    const search = path.slice(path.indexOf("?"));
    expect(nameStepFrom(search)).toBe(true);
    expect(postLoginDestination(nextParamFrom(search))).toBe("/join/KTCH2345");
    expect(nameStepFrom("?step=code")).toBe(false);
    expect(nameStepFrom(loginPathFor("/join/KTCH2345").slice(6))).toBe(false);
    expect(nameStepFrom("")).toBe(false);
  });
});
