/**
 * The app shell's inline script (cookpool-app PW-2): what must run before
 * React, on every page, so Cookpool behaves like an app from the first frame.
 * The root layout puts it at the top of <body>.
 *
 * 1. **The install prompt.** Chromium fires `beforeinstallprompt` once per
 *    page load, whenever it decides the app can be installed — possibly
 *    before any component has mounted. The script takes it every time
 *    (`preventDefault`, so the browser's own mini-infobar never shows: the
 *    one invitation is Home's card) and keeps it on `window` for the card
 *    and You's row (`src/lib/install.ts`). `appinstalled` drops it and marks
 *    the page as installed. Either change sends `cookpool:install-change`.
 * 2. **The focused field stays above the keyboard.** When a text field gets
 *    focus, and again when the keyboard resizes the visual viewport, a field
 *    that is still outside what can be seen is scrolled to the middle of it.
 *    Browsers usually do this themselves; this only acts when they did not.
 * 3. **The first look at a back or forward** (cookpool-recipes RC-11). The
 *    page transitions must see a `popstate` before Next restores the page:
 *    React renders that restore at once, inside the event, and Next's own
 *    listener is registered long before the kitchen frame mounts. So the
 *    first listener of all is this one, which hands the event to the frame
 *    (`window.__cookpoolPopstate`, while the frame is up).
 *
 * A string, not a module, because it runs inline during parsing (like the
 * RSC shim in static-pages.mjs). Dependency-free.
 */

import { INSTALLED_KEY, INSTALL_CHANGE, PROMPT_KEY } from "./install";

/** Where the kitchen frame takes the shell's first look at each `popstate` (RC-11's page transitions). */
export const POPSTATE_HOOK = "__cookpoolPopstate";

/** Input types that open no keyboard. */
const NO_KEYBOARD = "button|checkbox|color|file|hidden|image|radio|range|reset|submit";

export function appShellScript(): string {
  return `(function(w){if(w.__cookpoolShell)return;w.__cookpoolShell=1;
function changed(){try{w.dispatchEvent(new Event(${JSON.stringify(INSTALL_CHANGE)}))}catch(e){}}
w.addEventListener("beforeinstallprompt",function(e){e.preventDefault();w.${PROMPT_KEY}=e;changed()});
w.addEventListener("appinstalled",function(){w.${PROMPT_KEY}=null;w.${INSTALLED_KEY}=true;changed()});
w.addEventListener("popstate",function(e){var h=w.${POPSTATE_HOOK};if(typeof h==="function")h(e)},true);
var d=w.document,v=w.visualViewport;
function field(el){if(!el||!el.tagName)return false;var t=el.tagName;if(t==="TEXTAREA"||t==="SELECT")return true;if(t==="INPUT")return !/^(${NO_KEYBOARD})$/i.test(el.type||"");return el.isContentEditable===true}
function check(){var el=d.activeElement;if(!field(el))return;var r=el.getBoundingClientRect(),top=v?v.offsetTop:0,h=v?v.height:w.innerHeight;if(r.top<top||r.bottom>top+h)el.scrollIntoView({block:"center"})}
d.addEventListener("focusin",function(e){if(field(e.target))w.setTimeout(check,350)});
if(v)v.addEventListener("resize",function(){w.setTimeout(check,60)})})(window);`;
}
