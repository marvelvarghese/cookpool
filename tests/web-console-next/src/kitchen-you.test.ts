import { qk } from "@web-console-next/lib/query-keys";
import {
  CHANGE_NAME,
  HOW_YOU_SIGN_IN,
  NAME_READS,
  SIGN_OUT_PHONE,
  STAY_AS_THEY_ARE,
  nameToSave,
  personInitials,
  shownName,
  signInRows,
} from "@web-console-next/components/kitchen/you";
import {
  clearNameAsked,
  lastSignInMethod,
  markNameAsked,
  nameAskedFor,
  rememberSignInMethod,
} from "@web-console-next/lib/first-run";
import {
  joinAfterSignInPending,
  rememberJoinAfterSignIn,
  rememberLoginNext,
  rememberOAuthProvider,
  takeOAuthProvider,
} from "@web-console-next/lib/login-return";
import { recordRecentGroup } from "@web-console-next/lib/recent-groups";
import { readLastOrgSlug, writeLastOrgSlug } from "@web-console-next/lib/last-org";
import { SIGNED_OUT_PATH, clearDeviceRecords, signOutOfThisDevice, signingOut } from "@web-console-next/lib/sign-out";

// Cookpool SI-6: You (name, how you sign in, sign out) and what a device
// remembers between sign-ins.

describe("You: the name your groups see", () => {
  it("is the name you chose, else the part of your email before the @ (CP-9's fallback)", () => {
    expect(shownName({ email: "rahul@example.com", displayName: "Rahul Varghese" })).toBe("Rahul Varghese");
    expect(shownName({ email: "rahul@example.com", displayName: "  Rahul   V " })).toBe("Rahul V");
    expect(shownName({ email: "rahul.v@example.com", displayName: null })).toBe("rahul.v");
    expect(shownName({ email: "rahul@example.com", displayName: "   " })).toBe("rahul");
  });

  it("puts that name's initials on your avatar", () => {
    expect(personInitials({ email: "rahul@example.com", displayName: "Rahul Varghese" })).toBe("RV");
    expect(personInitials({ email: "anu@example.com", displayName: "Anu" })).toBe("A");
    expect(personInitials({ email: "dev.patel@example.com", displayName: null })).toBe("DP");
  });

  it("saves only a real change", () => {
    expect(nameToSave("Rahul", "Rahul Varghese")).toBe("Rahul Varghese");
    expect(nameToSave("Rahul", "  Rahul  ")).toBeNull();
    expect(nameToSave("Rahul", "")).toBeNull();
    expect(nameToSave("Rahul", "   ")).toBeNull();
    expect(nameToSave(null, "Rahul")).toBe("Rahul");
    expect(nameToSave(null, "")).toBeNull();
  });

  it("refreshes every read that carries names after a change (CP-9)", () => {
    expect(NAME_READS).toEqual([qk.kitchenMe(), qk.kitchenMembersAll()]);
    // Prefixes of the reads Home, People and a group's members show names from.
    const prefixOf = (key: readonly unknown[], prefix: readonly unknown[]) => prefix.every((p, i) => key[i] === p);
    expect(prefixOf(qk.kitchenMyBalances(), NAME_READS[0])).toBe(true);
    expect(prefixOf(qk.kitchenPerson("usr_1"), NAME_READS[0])).toBe(true);
    expect(prefixOf(qk.kitchenInbox(), NAME_READS[0])).toBe(true);
    expect(prefixOf(qk.kitchenMembers("org_1"), NAME_READS[1])).toBe(true);
  });

  it("uses the artboard's words", () => {
    expect(CHANGE_NAME).toBe("Change your name");
    expect(HOW_YOU_SIGN_IN).toBe("How you sign in");
    expect(SIGN_OUT_PHONE).toBe("Sign out of this phone");
    expect(STAY_AS_THEY_ARE).toBe("Your groups, pantry and balances stay as they are.");
  });
});

describe("You: how you sign in", () => {
  it("always lists a code to your address", () => {
    expect(signInRows("rahul@example.com", null)).toEqual([
      { way: "code", label: "A code to rahul@example.com", lastUsed: false },
    ]);
    expect(signInRows("rahul@example.com", "code")).toEqual([
      { way: "code", label: "A code to rahul@example.com", lastUsed: true },
    ]);
  });

  it("lists Google, first and last used, only when this device signed in with it", () => {
    expect(signInRows("rahul@gmail.com", "google")).toEqual([
      { way: "google", label: "Google", lastUsed: true },
      { way: "code", label: "A code to rahul@gmail.com", lastUsed: false },
    ]);
  });
});

describe("what this device remembers, and signing out", () => {
  const local = new Map<string, string>();
  const session = new Map<string, string>();
  const storage = (m: Map<string, string>) => ({
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
  });
  const g = globalThis as unknown as { window?: unknown };
  const hadWindow = "window" in g;

  beforeAll(() => {
    g.window = {
      localStorage: storage(local),
      sessionStorage: storage(session),
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => true,
    };
  });

  afterAll(() => {
    if (!hadWindow) delete g.window;
  });

  beforeEach(() => {
    local.clear();
    session.clear();
  });

  it("remembers who it asked for a name", () => {
    expect(nameAskedFor()).toBeNull();
    markNameAsked("usr_1");
    expect(nameAskedFor()).toBe("usr_1");
    expect([...local.keys()]).toEqual(["cookpool.next.name-asked"]);
    markNameAsked("");
    expect(nameAskedFor()).toBe("usr_1");
    clearNameAsked();
    expect(nameAskedFor()).toBeNull();
  });

  it("remembers how it last signed in, and nothing it does not recognise", () => {
    expect(lastSignInMethod()).toBeNull();
    rememberSignInMethod("google");
    expect(lastSignInMethod()).toBe("google");
    rememberSignInMethod("code");
    expect(lastSignInMethod()).toBe("code");
    rememberSignInMethod(null);
    expect(lastSignInMethod()).toBeNull();
    local.set("cookpool.next.sign-in-method", "github");
    expect(lastSignInMethod()).toBeNull();
  });

  it("carries the OAuth provider across the round trip once", () => {
    rememberOAuthProvider("google");
    expect(takeOAuthProvider()).toBe("google");
    expect(takeOAuthProvider()).toBeNull();
  });

  const seedSignedIn = () => {
    local.set("cookpool.next.token", "tok_si6");
    local.set("cookpool.next.target", "stage");
    rememberJoinAfterSignIn("KTCH2345", Date.now());
    rememberLoginNext("/join/KTCH2345");
    rememberOAuthProvider("google");
    markNameAsked("usr_1");
    rememberSignInMethod("google");
    recordRecentGroup("flat-4b-k3x9");
    writeLastOrgSlug("flat-4b-k3x9");
  };

  it("forgets everything it remembers for the person, keeping the device's API target", () => {
    seedSignedIn();
    expect(joinAfterSignInPending("KTCH2345")).toBe(true);
    clearDeviceRecords();
    expect(joinAfterSignInPending("KTCH2345")).toBe(false);
    expect(session.size).toBe(0);
    expect(nameAskedFor()).toBeNull();
    expect(lastSignInMethod()).toBeNull();
    expect(readLastOrgSlug()).toBeNull();
    // The token is the session's to clear (setToken); the target is the device's.
    expect([...local.keys()].sort()).toEqual(["cookpool.next.target", "cookpool.next.token"]);
  });

  it("signs out: logout, then the token, the cache and every record go, then /login", async () => {
    seedSignedIn();
    const steps: string[] = [];
    expect(signingOut()).toBe(false);
    await signOutOfThisDevice({
      logout: async () => {
        // While signing out, 401s and a missing token are not "you were signed out".
        expect(signingOut()).toBe(true);
        steps.push("logout");
      },
      setToken: (t) => {
        steps.push(`token:${String(t)}`);
        local.delete("cookpool.next.token");
      },
      clearCache: () => steps.push("cache"),
      go: (path) => {
        // By the time the page leaves, nothing of the person is left behind.
        expect(joinAfterSignInPending("KTCH2345")).toBe(false);
        expect(session.size).toBe(0);
        expect([...local.keys()]).toEqual(["cookpool.next.target"]);
        steps.push(`go:${path}`);
      },
    });
    expect(SIGNED_OUT_PATH).toBe("/login");
    expect(steps).toEqual(["logout", "token:null", "cache", "go:/login"]);
  });

  it("signs this device out even when logout fails", async () => {
    seedSignedIn();
    const steps: string[] = [];
    await signOutOfThisDevice({
      logout: async () => {
        throw new Error("offline");
      },
      setToken: () => steps.push("token"),
      clearCache: () => steps.push("cache"),
      go: (path) => steps.push(`go:${path}`),
    });
    expect(steps).toEqual(["token", "cache", "go:/login"]);
    expect(joinAfterSignInPending("KTCH2345")).toBe(false);
  });
});
