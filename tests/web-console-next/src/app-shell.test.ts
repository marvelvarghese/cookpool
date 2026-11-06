import { appShellScript } from "@web-console-next/lib/app-shell";
import { INSTALLED_KEY, INSTALL_CHANGE, PROMPT_KEY } from "@web-console-next/lib/install";

// Cookpool PW-2: the root layout's inline script, run against a fake window.

type FakeEvent = { type: string; target?: unknown; preventDefault?: () => void };
type Handler = (e: FakeEvent) => void;

function target() {
  const handlers = new Map<string, Handler[]>();
  return {
    handlers,
    addEventListener: (type: string, fn: Handler) => void handlers.set(type, [...(handlers.get(type) ?? []), fn]),
    dispatchEvent: (e: FakeEvent) => {
      for (const fn of handlers.get(e.type) ?? []) fn(e);
      return true;
    },
  };
}

interface FakeField {
  tagName: string;
  type?: string;
  isContentEditable?: boolean;
  rect: { top: number; bottom: number };
  scrolled: unknown[];
  getBoundingClientRect: () => { top: number; bottom: number };
  scrollIntoView: (o: unknown) => void;
}

function field(tagName: string, type: string | undefined, top: number): FakeField {
  const f: FakeField = {
    tagName,
    ...(type ? { type } : {}),
    rect: { top, bottom: top + 44 },
    scrolled: [],
    getBoundingClientRect: () => f.rect,
    scrollIntoView: (o) => void f.scrolled.push(o),
  };
  return f;
}

function run() {
  const win = target() as ReturnType<typeof target> & Record<string, unknown>;
  const doc = { ...target(), activeElement: null as FakeField | null };
  const viewport = { ...target(), offsetTop: 0, height: 844 };
  const changes: string[] = [];
  Object.assign(win, { document: doc, visualViewport: viewport, innerHeight: 844, setTimeout: (fn: () => void) => fn() });
  win.addEventListener(INSTALL_CHANGE, (e) => void changes.push(e.type));
  new Function("window", appShellScript())(win);
  return { win, doc, viewport, changes };
}

describe("the app shell script: the install prompt", () => {
  it("keeps the browser's prompt (so its own banner never shows) and says it changed", () => {
    const { win, changes } = run();
    let prevented = 0;
    const event = { type: "beforeinstallprompt", preventDefault: () => void prevented++ };
    win.dispatchEvent(event);
    expect(prevented).toBe(1);
    expect(win[PROMPT_KEY]).toBe(event);
    expect(changes).toEqual([INSTALL_CHANGE]);
  });

  it("drops it and marks the page installed when the browser installs the app", () => {
    const { win, changes } = run();
    win.dispatchEvent({ type: "beforeinstallprompt", preventDefault: () => undefined });
    win.dispatchEvent({ type: "appinstalled" });
    expect(win[PROMPT_KEY]).toBeNull();
    expect(win[INSTALLED_KEY]).toBe(true);
    expect(changes).toEqual([INSTALL_CHANGE, INSTALL_CHANGE]);
  });

  it("installs its listeners once, however often it runs", () => {
    const { win } = run();
    new Function("window", appShellScript())(win);
    expect(win.handlers.get("beforeinstallprompt")).toHaveLength(1);
    expect(win.handlers.get("appinstalled")).toHaveLength(1);
  });
});

describe("the app shell script: a focused field stays above the keyboard", () => {
  it("scrolls a text field the keyboard covers to the middle of what can be seen", () => {
    const { doc, viewport } = run();
    const input = field("INPUT", "text", 700);
    doc.activeElement = input;
    // The keyboard opens: the visual viewport shrinks to the top 450px.
    viewport.height = 450;
    viewport.dispatchEvent({ type: "resize" });
    expect(input.scrolled).toEqual([{ block: "center" }]);
  });

  it("leaves a field alone when it can be seen", () => {
    const { doc } = run();
    const input = field("TEXTAREA", undefined, 200);
    doc.activeElement = input;
    doc.dispatchEvent({ type: "focusin", target: input });
    expect(input.scrolled).toEqual([]);
  });

  it("acts on focus too, for text fields only (not checkboxes or buttons)", () => {
    const { doc, viewport } = run();
    viewport.height = 400;
    const email = field("INPUT", "email", 600);
    doc.activeElement = email;
    doc.dispatchEvent({ type: "focusin", target: email });
    expect(email.scrolled).toHaveLength(1);
    const box = field("INPUT", "checkbox", 600);
    doc.activeElement = box;
    doc.dispatchEvent({ type: "focusin", target: box });
    viewport.dispatchEvent({ type: "resize" });
    expect(box.scrolled).toEqual([]);
  });

  it("measures against the visual viewport where it has scrolled to", () => {
    const { doc, viewport } = run();
    const input = field("INPUT", "number", 500);
    doc.activeElement = input;
    viewport.offsetTop = 300;
    viewport.height = 400;
    viewport.dispatchEvent({ type: "resize" });
    expect(input.scrolled).toEqual([]);
    viewport.offsetTop = 0;
    viewport.dispatchEvent({ type: "resize" });
    expect(input.scrolled).toHaveLength(1);
  });
});
