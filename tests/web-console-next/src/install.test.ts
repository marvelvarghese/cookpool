import {
  HIDE_DAYS,
  addDays,
  cannotInstallLine,
  dayKey,
  hideInstallCard,
  installLabel,
  installMemory,
  installWay,
  iosShareStep,
  isInAppBrowser,
  isIos,
  isIphoneSafari,
  showInstallCard,
  type InstallEnv,
  type InstallMemory,
} from "@web-console-next/lib/install";
import { clearDeviceRecords } from "@web-console-next/lib/sign-out";

// Cookpool PW-2 (cookpool-app design §2): the invitation to install, once,
// in the way the phone allows.

const UA = {
  iphoneSafari18:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1",
  // iOS 26 Safari keeps reporting OS 18_6; its own version says 26.
  iphoneSafari26:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1",
  iphoneChrome:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/140.0.7339.122 Mobile/15E148 Safari/604.1",
  iphoneInstagram:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 390.0.0.28.85 (iPhone15,3; iOS 18_5; en_IN)",
  ipadDesktop:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Safari/605.1.15",
  androidChrome:
    "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36",
  androidFirefox: "Mozilla/5.0 (Android 14; Mobile; rv:143.0) Gecko/143.0 Firefox/143.0",
  desktopFirefox: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:143.0) Gecko/20100101 Firefox/143.0",
  desktopChrome:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
};

const env = (over: Partial<InstallEnv>): InstallEnv => ({
  standalone: false,
  installedNow: false,
  promptHeld: false,
  promptApi: false,
  userAgent: UA.desktopFirefox,
  maxTouchPoints: 0,
  ...over,
});

describe("how this browser installs Cookpool", () => {
  it("offers nothing inside the installed app, or once the browser said it installed", () => {
    expect(installWay(env({ standalone: true, promptHeld: true, promptApi: true, userAgent: UA.androidChrome }))).toBe("installed");
    expect(installWay(env({ standalone: true, userAgent: UA.iphoneSafari18, maxTouchPoints: 5 }))).toBe("installed");
    expect(installWay(env({ installedNow: true, promptApi: true, userAgent: UA.androidChrome }))).toBe("installed");
  });

  it("is one tap on Chromium holding the prompt (Android, desktop Chrome)", () => {
    expect(installWay(env({ promptHeld: true, promptApi: true, userAgent: UA.androidChrome, maxTouchPoints: 5 }))).toBe("prompt");
    expect(installWay(env({ promptHeld: true, promptApi: true, userAgent: UA.desktopChrome }))).toBe("prompt");
  });

  it("is the two steps on an iPhone or iPad, in any iOS browser but an app's own web view", () => {
    expect(installWay(env({ userAgent: UA.iphoneSafari18, maxTouchPoints: 5 }))).toBe("ios");
    expect(installWay(env({ userAgent: UA.iphoneChrome, maxTouchPoints: 5 }))).toBe("ios");
    // An iPad asking for desktop sites says "Macintosh", but it has a touch screen.
    expect(installWay(env({ userAgent: UA.ipadDesktop, maxTouchPoints: 5 }))).toBe("ios");
    expect(installWay(env({ userAgent: UA.ipadDesktop, maxTouchPoints: 0 }))).toBe("none");
    expect(installWay(env({ userAgent: UA.iphoneInstagram, maxTouchPoints: 5 }))).toBe("none");
  });

  it("is the browser's menu on Chromium before it offers, and on Android browsers without the prompt", () => {
    expect(installWay(env({ promptApi: true, userAgent: UA.androidChrome }))).toBe("menu");
    expect(installWay(env({ promptApi: true, userAgent: UA.desktopChrome }))).toBe("menu");
    expect(installWay(env({ userAgent: UA.androidFirefox }))).toBe("menu");
  });

  it("is nothing on other browsers (Firefox or Safari on a computer)", () => {
    expect(installWay(env({ userAgent: UA.desktopFirefox }))).toBe("none");
    expect(installWay(env({ userAgent: UA.ipadDesktop }))).toBe("none");
  });

  it("knows iOS, app web views and Safari on an iPhone by their user agents", () => {
    expect(isIos(UA.iphoneSafari18, 5)).toBe(true);
    expect(isIos(UA.androidChrome, 5)).toBe(false);
    expect(isInAppBrowser(UA.iphoneInstagram)).toBe(true);
    expect(isInAppBrowser("Mozilla/5.0 (iPhone; …) Mobile/15E148 [FBAN/FBIOS;FBAV/480.0]")).toBe(true);
    expect(isInAppBrowser(UA.iphoneSafari18)).toBe(false);
    expect(isIphoneSafari(UA.iphoneSafari18)).toBe(true);
    expect(isIphoneSafari(UA.iphoneSafari26)).toBe(true);
    expect(isIphoneSafari(UA.iphoneChrome)).toBe(false);
    expect(isIphoneSafari(UA.ipadDesktop)).toBe(false);
  });

  it("says where Share is: behind ··· in Safari 26, in the toolbar before it and in other iOS browsers", () => {
    expect(iosShareStep(UA.iphoneSafari18)).toBe("Tap Share");
    expect(iosShareStep(UA.iphoneSafari26)).toBe("Tap ··· then Share");
    expect(iosShareStep(UA.iphoneChrome)).toBe("Tap Share");
  });

  it("labels the card's button for the way, and says in one line when there is nothing to tap", () => {
    expect(installLabel("prompt")).toBe("Install");
    expect(installLabel("ios")).toBe("How");
    expect(cannotInstallLine("menu")).toBe("Install it from your browser's menu.");
    expect(cannotInstallLine("none")).toBe("This browser can't install Cookpool.");
    expect(cannotInstallLine("prompt")).toBeNull();
    expect(cannotInstallLine("ios")).toBeNull();
  });
});

describe("when Home shows the install card", () => {
  const seen = (over: Partial<InstallMemory> = {}): InstallMemory => ({
    firstDay: "2026-11-05",
    hiddenOn: null,
    firstSession: false,
    ...over,
  });

  it("never inside the installed app, and only where there is a way to offer", () => {
    expect(showInstallCard("installed", "2026-11-06", seen())).toBe(false);
    expect(showInstallCard("menu", "2026-11-06", seen())).toBe(false);
    expect(showInstallCard("none", "2026-11-06", seen())).toBe(false);
    expect(showInstallCard("prompt", "2026-11-06", seen())).toBe(true);
    expect(showInstallCard("ios", "2026-11-06", seen())).toBe(true);
  });

  it("not on the first day, nor in the first session; from the second day", () => {
    expect(showInstallCard("prompt", "2026-11-05", seen())).toBe(false);
    expect(showInstallCard("prompt", "2026-11-06", seen({ firstSession: true }))).toBe(false);
    expect(showInstallCard("ios", "2026-11-06", seen())).toBe(true);
    expect(showInstallCard("ios", "2027-02-01", seen())).toBe(true);
  });

  it("not for 30 days after ✕, then again", () => {
    expect(HIDE_DAYS).toBe(30);
    const hidden = seen({ hiddenOn: "2026-11-10" });
    expect(showInstallCard("prompt", "2026-11-10", hidden)).toBe(false);
    expect(showInstallCard("prompt", "2026-12-09", hidden)).toBe(false);
    expect(showInstallCard("prompt", "2026-12-10", hidden)).toBe(true);
  });

  it("not when the day cannot be read: no first day stored, a malformed one, or a clock gone back", () => {
    expect(showInstallCard("prompt", "2026-11-06", seen({ firstDay: null }))).toBe(false);
    expect(showInstallCard("prompt", "2026-11-06", seen({ firstDay: "yesterday" }))).toBe(false);
    expect(showInstallCard("prompt", "2026-11-06", seen({ hiddenOn: "soon" }))).toBe(false);
    expect(showInstallCard("prompt", "2026-11-04", seen())).toBe(false);
  });

  it("counts local calendar days", () => {
    expect(dayKey(new Date(2026, 10, 5, 23, 59))).toBe("2026-11-05");
    expect(dayKey(new Date(2026, 0, 9, 0, 1))).toBe("2026-01-09");
    expect(addDays("2026-11-05", 30)).toBe("2026-12-05");
    expect(addDays("2026-12-20", 30)).toBe("2027-01-19");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDays("05/11/2026", 1)).toBeNull();
  });
});

describe("what this device remembers about the card", () => {
  const local = new Map<string, string>();
  const session = new Map<string, string>();
  let broken = false;
  const storage = (m: Map<string, string>) => ({
    getItem: (k: string) => {
      if (broken) throw new Error("SecurityError");
      return m.get(k) ?? null;
    },
    setItem: (k: string, v: string) => {
      if (broken) throw new Error("QuotaExceededError");
      m.set(k, v);
    },
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
    broken = false;
  });

  it("records the first day once, and that session as the first", () => {
    expect(installMemory("2026-11-05")).toEqual({ firstDay: "2026-11-05", hiddenOn: null, firstSession: true });
    expect([...local.keys()]).toEqual(["cookpool.next.install.first-day"]);
    expect(installMemory("2026-11-06")).toEqual({ firstDay: "2026-11-05", hiddenOn: null, firstSession: true });
    // A new browser session the next day: the card's day.
    session.clear();
    const next = installMemory("2026-11-06");
    expect(next).toEqual({ firstDay: "2026-11-05", hiddenOn: null, firstSession: false });
    expect(showInstallCard("prompt", "2026-11-06", next)).toBe(true);
  });

  it("remembers ✕ for 30 days", () => {
    installMemory("2026-11-01");
    session.clear();
    hideInstallCard("2026-11-06");
    const after = installMemory("2026-11-07");
    expect(after.hiddenOn).toBe("2026-11-06");
    expect(showInstallCard("ios", "2026-11-07", after)).toBe(false);
    expect(showInstallCard("ios", "2026-12-06", after)).toBe(true);
  });

  it("is per device: signing out keeps it", () => {
    installMemory("2026-11-01");
    hideInstallCard("2026-11-03");
    clearDeviceRecords();
    expect(local.get("cookpool.next.install.first-day")).toBe("2026-11-01");
    expect(local.get("cookpool.next.install.hidden-on")).toBe("2026-11-03");
  });

  it("shows nothing when storage throws (private modes, blocked storage)", () => {
    broken = true;
    const memory = installMemory("2026-11-06");
    expect(memory).toEqual({ firstDay: null, hiddenOn: null, firstSession: false });
    expect(showInstallCard("prompt", "2026-11-06", memory)).toBe(false);
    expect(() => hideInstallCard("2026-11-06")).not.toThrow();
  });
});
