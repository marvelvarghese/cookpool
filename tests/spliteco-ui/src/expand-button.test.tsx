/**
 * @jest-environment jsdom
 */
// money-native MY-3: the one expanding button.

import { jest } from "@jest/globals";
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { EXPAND_FADE_MS, EXPAND_MS, ExpandButton, type ExpandButtonProps } from "@saas/spliteco-ui/expand-button";
import { lookColours } from "@saas/spliteco-ui/look";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

function mockReducedMotion(reduce: boolean) {
  window.matchMedia = ((q: string) => ({
    matches: reduce && q.includes("prefers-reduced-motion"), media: q, onchange: null,
    addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

function mount(props: Partial<ExpandButtonProps> = {}) {
  act(() => {
    root.render(
      <div>
        <ExpandButton kind="settle" label="Settle ₹1,500" theme="cookpool" {...props}>
          {({ close }) => (<><input aria-label="Amount" /><button type="button" onClick={close}>Done</button></>)}
        </ExpandButton>
        <a href="#outside">outside</a>
      </div>,
    );
  });
}

const launcher = () => host.querySelector<HTMLButtonElement>('button[aria-haspopup="dialog"]')!;
const dialog = () => host.querySelector<HTMLElement>('[role="dialog"]');
const box = () => host.querySelector<HTMLElement>("[data-expand-box]")!;
const dim = () => host.querySelector<HTMLElement>("[data-expand-dim]")!;
const key = (k: string, init: KeyboardEventInit = {}) => act(() => { (document.activeElement ?? document.body).dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, ...init })); });
const click = (el: Element) => act(() => { (el as HTMLElement).click(); });

beforeEach(() => {
  jest.useFakeTimers();
  mockReducedMotion(false);
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  jest.useRealTimers();
});

describe("opening and closing", () => {
  it("is a real button with an accessible name, and the box is not there until it opens", () => {
    mount();
    expect(launcher().tagName).toBe("BUTTON");
    expect(launcher().getAttribute("aria-label")).toBe("Settle ₹1,500");
    expect(launcher().getAttribute("aria-expanded")).toBe("false");
    expect(dialog()).toBeNull();
    expect(box().style.borderRadius).toBe("12px");
  });

  it("opens into a named modal box, dims the page and grows to 20px corners", () => {
    mount();
    click(launcher());
    expect(dialog()!.getAttribute("aria-modal")).toBe("true");
    expect(dialog()!.getAttribute("aria-labelledby")).toBe(host.querySelector("h2")!.id);
    expect(host.querySelector("h2")!.textContent).toBe("Settle ₹1,500");
    expect(launcher().getAttribute("aria-expanded")).toBe("true");
    expect(dim().style.opacity).toBe("1");
    expect(box().style.borderRadius).toBe("20px");
    expect(box().style.transition).toContain(`${EXPAND_MS}ms`);
  });

  it("closes by the X, the dim area, Done and Escape, and returns focus to the button", () => {
    mount();
    const closers: Array<() => void> = [
      () => click(host.querySelector('button[aria-label="Close"]')!),
      () => click(dim()),
      () => click(Array.from(host.querySelectorAll("button")).find((b) => b.textContent === "Done")!),
      () => key("Escape"),
    ];
    for (const closeIt of closers) {
      click(launcher());
      expect(dialog()).not.toBeNull();
      closeIt();
      expect(launcher().getAttribute("aria-expanded")).toBe("false");
      expect(dim().style.opacity).toBe("0");
      expect(document.activeElement).toBe(launcher());
      act(() => { jest.advanceTimersByTime(EXPAND_MS); });
      expect(dialog()).toBeNull();
    }
  });

  it("moves focus into the box on open and traps Tab inside it", () => {
    mount();
    launcher().focus();
    click(launcher());
    const close = host.querySelector<HTMLElement>('button[aria-label="Close"]')!;
    expect(document.activeElement).toBe(close);
    const done = Array.from(host.querySelectorAll<HTMLElement>("button")).find((b) => b.textContent === "Done")!;
    done.focus();
    key("Tab");
    expect(document.activeElement).toBe(close);
    key("Tab", { shiftKey: true });
    expect(document.activeElement).toBe(done);
  });

  it("tells the host when it opens and closes, and can be controlled", () => {
    const seen: boolean[] = [];
    mount({ onOpenChange: (o) => seen.push(o), open: false });
    click(launcher());
    expect(seen).toEqual([true]);
    expect(dialog()).toBeNull();
    mount({ onOpenChange: (o) => seen.push(o), open: true });
    expect(dialog()).not.toBeNull();
    key("Escape");
    expect(seen).toEqual([true, false]);
  });

  it("holds no content of its own: the box is only the title, the X and what is passed in", () => {
    mount();
    click(launcher());
    expect(dialog()!.textContent).toBe("Settle ₹1,500" + "" + "Done");
  });
});

describe("reduced motion", () => {
  it.each([["the media query", { }, true], ["the prop", { reduceMotion: true }, false]] as const)("has no grow or shrink, only a fade of at most 120ms (%s)", (_n, props, viaQuery) => {
    if (viaQuery) mockReducedMotion(true);
    mount(props);
    expect(box().style.transition).toBe("none");
    click(launcher());
    expect(box().style.transition).toBe("none");
    expect(box().style.borderRadius).toBe("20px");
    expect(dialog()!.style.transition).toBe(`opacity ${EXPAND_FADE_MS}ms ease`);
    expect(EXPAND_FADE_MS).toBeLessThanOrEqual(120);
    key("Escape");
    expect(dialog()!.style.opacity).toBe("0");
    act(() => { jest.advanceTimersByTime(EXPAND_FADE_MS); });
    expect(dialog()).toBeNull();
  });

  it("moves the box with a transition otherwise", () => {
    mount({ reduceMotion: false });
    expect(box().style.transition).toContain("cubic-bezier");
  });
});

describe("both themes", () => {
  it.each(["cookpool", "spliteco"] as const)("%s sets its tokens on the scope", (theme) => {
    mount({ theme });
    click(launcher());
    const scope = host.querySelector<HTMLElement>("[data-expand-button]")!;
    const c = lookColours(theme);
    expect(scope.dataset.look).toBe(theme);
    expect(scope.style.getPropertyValue("--look-primary")).toBe(c.primary);
    expect(scope.style.getPropertyValue("--look-surface")).toBe(c.surface);
    expect(scope.style.getPropertyValue("--look-ink")).toBe(c.ink);
  });
});

describe("kinds", () => {
  it.each([["settle", "Settle ₹1,500"], ["expense", "Expense"], ["people", "Settle up"]] as const)("%s labels its button", (kind, label) => {
    mount({ kind, label });
    expect(launcher().getAttribute("aria-label")).toBe(label);
    expect(host.querySelector(`[data-expand-button="${kind}"]`)).not.toBeNull();
  });
});
