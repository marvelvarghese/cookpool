// A short, human label for a subscribed device, from the User-Agent it
// subscribed with (PW-5): "Chrome on Android", "Safari on iPhone". Stored so
// a person can tell their devices apart; never used to decide anything.

const BROWSERS: Array<[RegExp, string]> = [
  [/\bEdg(A|iOS)?\//, "Edge"],
  [/\bSamsungBrowser\//, "Samsung Internet"],
  [/\b(OPR|OPT)\//, "Opera"],
  [/\b(Firefox|FxiOS)\//, "Firefox"],
  [/\b(Chrome|CriOS)\//, "Chrome"],
  [/\bVersion\/[\d.]+.*\bSafari\//, "Safari"],
];

const SYSTEMS: Array<[RegExp, string]> = [
  [/\biPhone\b/, "iPhone"],
  [/\biPad\b/, "iPad"],
  [/\bAndroid\b/, "Android"],
  [/\bCrOS\b/, "ChromeOS"],
  [/\bWindows\b/, "Windows"],
  [/\bMac OS X\b|\bMacintosh\b/, "Mac"],
  [/\bLinux\b/, "Linux"],
];

/** At most 64 characters (the column's limit); null when the User-Agent says nothing we know. */
export function deviceLabel(userAgent: string | null | undefined): string | null {
  if (!userAgent) return null;
  const ua = userAgent.slice(0, 512);
  const system = SYSTEMS.find(([re]) => re.test(ua))?.[1] ?? null;
  let browser = BROWSERS.find(([re]) => re.test(ua))?.[1] ?? null;
  // An app installed to an iPhone's Home Screen reports WebKit without Safari's token.
  if (!browser && (system === "iPhone" || system === "iPad") && /AppleWebKit\//.test(ua)) browser = "Safari";
  const label = browser && system ? `${browser} on ${system}` : (browser ?? system);
  return label ? label.slice(0, 64) : null;
}
