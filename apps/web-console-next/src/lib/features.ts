// THE NEW FRAME, STAGE FIRST (Cookpool cookpool-recipes RC-2, design §1.1).
//
// The five tabs (Home · Pantry · Cook · Money · You), the new Home, Money,
// your page and a person's page are on wherever the app is not prod: dev,
// stage, a local build and a workers.dev host that names no environment.
// Prod keeps today's app until the owner says go (RC5 turns it on there and
// deletes the old screens).
//
// It is read at runtime, in the browser, from the environment the page's own
// host names (`appConfig()`, saas-console-artifact CA2): one build serves
// every environment, as before. A screen whose layout changes picks its
// component when it renders (`newFrame() ? <NewHome/> : <Home/>`), and every
// kitchen page renders only after the session is ready — never while it is
// prerendered — so the prerendered file is the same for both frames.
//
// Dependency-free but for the config, so it is unit-testable.

import { appConfig, type AppConfig } from "./app-config";

/** Whether an environment shows the new frame: every one but prod. */
export function newFrameFor(deployEnv: string | null | undefined): boolean {
  return deployEnv !== "prod";
}

/** Whether this page shows the new frame (true everywhere but prod). */
export function newFrame(config: Pick<AppConfig, "deployEnv"> = appConfig()): boolean {
  return newFrameFor(config.deployEnv);
}

/**
 * Pages that exist only in the new frame, and where today's frame sends a
 * visitor instead (design §1.1: a prod visitor goes to Home). `/you/settings`
 * is the new frame's home for today's You rows, so prod is sent to `/you`,
 * where those rows still are. The cooking session (RC-6) is the new frame's
 * too: prod's visitor goes Home.
 */
export const NEW_FRAME_ONLY: Readonly<Record<string, string>> = {
  "/money": "/home",
  "/you/settings": "/you",
  // The shopping run (cookpool-pantry PN-6): today's frame has none, so its visitor goes to the Pantry.
  "/pantry/run": "/pantry",
  // The cooking session (RC-6).
  "/cook/session": "/home",
  // The recipe screens (RC-5): a recipe, writing one and editing one.
  "/recipes/new": "/home",
  "/recipes/:recipeId": "/home",
  "/recipes/:recipeId/edit": "/home",
  // The plan (cookpool-guided GC-6).
  "/recipes/:recipeId/plan": "/home",
  // Recipes travel (RC-8): Explore and a recipe's link.
  "/explore": "/home",
  "/r/:code": "/home",
  // Community (cookpool-community CM-5): the feed, people search, Activity,
  // a profile and a post are the Cook tab's; HandleSetup and blocked people
  // are You's (today's You has none, so its visitor goes there).
  "/community": "/home",
  "/community/search": "/home",
  "/community/activity": "/home",
  "/u/:handle": "/home",
  "/p/:postId": "/home",
  "/you/profile": "/you",
  "/you/blocked": "/you",
  // The stock check (cookpool-pantry PN-7): today's frame has none, so its visitor goes to the Pantry.
  "/pantry/:itemRef/check": "/pantry",
};

/** Where a page (static-pages.mjs's pattern) sends a visitor in this frame, or null when it shows. */
export function frameRedirect(page: string, isNewFrame: boolean): string | null {
  return isNewFrame ? null : (NEW_FRAME_ONLY[page] ?? null);
}
