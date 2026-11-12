import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { CopyRecipeRequest, RecipeResponse, RecipeVisibility, UpdateRecipeRequest } from "@saas/contracts/kitchen";
import type { ApiResult } from "@web-console-next/lib/api";
import { applyPatches, type CacheKey, type CacheLike } from "@web-console-next/lib/optimistic";
import { qk } from "@web-console-next/lib/query-keys";
import {
  COPIED_MS,
  LINK_GONE_TEXT,
  LINK_MAKING_TEXT,
  canShareRecipe,
  copyLink,
  groupNamesText,
  linkFailure,
  linkHaveText,
  linkLines,
  linkSaveNote,
  linkSaveState,
  linkSavedNote,
  parseLinkCode,
  recipeLinkHref,
  recipeLinkUrl,
  saveFromLink,
  savedByText,
  sendShare,
  servesLine,
  shareOptions,
  sharedByText,
  sharedToastTitle,
  undoCallFor,
  undoSave,
  visibilityAfter,
  visibilityCall,
  visibilityPatches,
  type ShareCall,
  type ShareDeps,
} from "@web-console-next/components/kitchen/recipe-share";
import { ShareSheetBody } from "@web-console-next/components/kitchen/recipe-share-views";
import { LinkGone, RecipeLinkView } from "@web-console-next/components/kitchen/recipe-link-views";
import { ANU, curryMatch, line, recipe, summary } from "./kitchen-recipe-fixtures";

// cookpool-recipes RC-8 (design §5.1, §5.2, the canvas's `ShareRecipe`):
// your recipe's share sheet — Only me, My groups, Anyone with the link —
// and the page a link opens, `/r/<code>`, which saves your own copy.

const html = (el: React.ReactElement) => renderToStaticMarkup(el);
const CODE = "7kq2mxAb3Z";

function ok(data: RecipeResponse): ApiResult<RecipeResponse> {
  return { ok: true, data, meta: { requestId: "req_1", cursor: null } };
}
const refused: ApiResult<RecipeResponse> = { ok: false, status: 404, error: { code: "not_found", message: "Not found" } };

/** Records each SDK call a sharing write makes, answering with the recipe as the server would. */
function fakeShare() {
  const calls: { what: string; args: unknown[] }[] = [];
  const answer = (visibility: RecipeVisibility, linkCode: string | null) => Promise.resolve(ok({ recipe: recipe({ visibility, linkCode }), lastCook: null }));
  const deps: ShareDeps = {
    updateRecipe: (id: string, body: UpdateRecipeRequest) => {
      calls.push({ what: "PATCH /v1/kitchen/me/recipes/{id}", args: [id, body] });
      return answer(body.visibility ?? "groups", body.visibility === "link" ? "NEWcode234" : null);
    },
    shareRecipeLink: (id: string) => {
      calls.push({ what: "POST /v1/kitchen/me/recipes/{id}/link", args: [id] });
      return answer("link", "ROTcode234");
    },
    stopRecipeLink: (id: string) => {
      calls.push({ what: "DELETE /v1/kitchen/me/recipes/{id}/link", args: [id] });
      return answer("groups", null);
    },
  };
  return { deps, calls };
}

/** A cache over a Map, as `queryCacheOf` builds one over the QueryClient. */
function mapCache(entries: [CacheKey, unknown][]): CacheLike & { map: Map<string, unknown> } {
  const map = new Map(entries.map(([k, v]) => [JSON.stringify(k), v] as const));
  return {
    map,
    entries: (prefix) =>
      [...map.entries()]
        .map(([k, v]) => [JSON.parse(k) as CacheKey, v] as const)
        .filter(([k]) => prefix.every((p, i) => JSON.stringify(k[i]) === JSON.stringify(p))),
    get: (key) => map.get(JSON.stringify(key)),
    set: (key, data) => void map.set(JSON.stringify(key), data),
  };
}

describe("the share sheet: who can see it", () => {
  it("offers three levels, in order, each saying where it shows", () => {
    expect(shareOptions(["Flat 4B", "Lunch club"])).toEqual([
      { id: "only_me", title: "Only me", sub: "In your recipes, nowhere else", icon: "lock" },
      { id: "groups", title: "My groups", sub: "On your page for Flat 4B and Lunch club", icon: "groups" },
      { id: "link", title: "Anyone with the link", sub: "They can see it and save a copy", icon: "link" },
    ]);
  });

  it("names your groups in a few words", () => {
    expect(groupNamesText([])).toBe("your groups");
    expect(groupNamesText(["Flat 4B"])).toBe("Flat 4B");
    expect(groupNamesText(["Flat 4B", "Lunch club"])).toBe("Flat 4B and Lunch club");
    expect(groupNamesText(["Flat 4B", "Lunch club", "Goa trip"])).toBe("Flat 4B and 2 more");
  });

  it("is for your own recipe only: not someone else's, not Cookpool's", () => {
    expect(canShareRecipe(summary({ mine: true }))).toBe(true);
    expect(canShareRecipe(summary({ mine: false, ownerId: ANU }))).toBe(false);
    expect(canShareRecipe(summary({ mine: true, isSystem: true }))).toBe(false);
  });

  it("draws the chosen row as a checked radio, tinted green with a green border", () => {
    const out = html(
      React.createElement(ShareSheetBody, {
        options: shareOptions(["Flat 4B"]),
        visibility: "groups",
        linkUrl: null,
        copied: false,
        savedBy: 4,
        onPick: () => undefined,
        onCopy: () => undefined,
        onRotate: () => undefined,
        onTurnOff: () => undefined,
        onDone: () => undefined,
      }),
    );
    expect(out).toContain('role="radiogroup"');
    expect(out.match(/role="radio"/g)).toHaveLength(3);
    expect(out.match(/aria-checked="true"/g)).toHaveLength(1);
    expect(out).toMatch(/role="radio" aria-checked="true" class="[^"]*border-primary bg-cp-herb-tint/);
    expect(out).toContain("On your page for Flat 4B");
    // No link box unless the link is on; Saved by and Done always.
    expect(out).not.toContain("Copy");
    expect(out).toContain("Saved by 4");
    expect(out).toContain(">Done<");
  });
});

describe("choosing a level: one PATCH of its visibility", () => {
  it.each(["only_me", "groups", "link"] as const)("%s → one PATCH of { visibility }", async (to) => {
    const { deps, calls } = fakeShare();
    const call = visibilityCall(to);
    expect(call).toEqual({ kind: "visibility", body: { visibility: to } });
    const r = await sendShare("rcp_curry", call, deps);
    expect(calls).toEqual([{ what: "PATCH /v1/kitchen/me/recipes/{id}", args: ["rcp_curry", { visibility: to }] }]);
    expect(r.ok && r.data.recipe.visibility).toBe(to);
  });

  it("shows at once: the recipe's page and its row on My recipes take the level (a code only while it stays a link)", () => {
    const cache = mapCache([
      [qk.kitchenRecipe("rcp_curry"), { recipe: recipe({ visibility: "link", linkCode: CODE }), lastCook: null }],
      [qk.kitchenMyRecipes(), [summary({ visibility: "link" }), summary({ id: "rcp_other", name: "Dal" })]],
    ]);
    applyPatches(cache, visibilityPatches("rcp_curry", { visibility: "only_me" }));
    const page = cache.get(qk.kitchenRecipe("rcp_curry")) as RecipeResponse;
    expect(page.recipe.visibility).toBe("only_me");
    expect(page.recipe.linkCode).toBeNull();
    const mine = cache.get(qk.kitchenMyRecipes()) as { id: string; visibility: string }[];
    expect(mine.map((r) => [r.id, r.visibility])).toEqual([
      ["rcp_curry", "only_me"],
      ["rcp_other", "groups"],
    ]);
    // Back to the link, waiting for its code: "Making a link…".
    applyPatches(cache, visibilityPatches("rcp_curry", { visibility: "link", linkCode: null }));
    expect((cache.get(qk.kitchenRecipe("rcp_curry")) as RecipeResponse).recipe).toMatchObject({ visibility: "link", linkCode: null });
  });

  it("leaves a read that doesn't show the recipe alone", () => {
    const list = [summary({ id: "rcp_other" })];
    const cache = mapCache([[qk.kitchenMyRecipes(), list]]);
    expect(applyPatches(cache, visibilityPatches("rcp_curry", { visibility: "only_me" }))).toEqual([]);
    expect(cache.get(qk.kitchenMyRecipes())).toBe(list);
  });

  it("offers Undo: the level it was before, as a PATCH", () => {
    expect(undoCallFor(visibilityCall("only_me"), "groups")).toEqual(visibilityCall("groups"));
    expect(undoCallFor(visibilityCall("link"), "only_me")).toEqual(visibilityCall("only_me"));
    // Back to the link mints a new code: the old one can't come back.
    expect(undoCallFor(visibilityCall("groups"), "link")).toEqual(visibilityCall("link"));
    // Nothing changed: nothing to undo.
    expect(undoCallFor(visibilityCall("groups"), "groups")).toBeNull();
  });

  it("says what it did in the toast", () => {
    expect(sharedToastTitle("only_me")).toBe("Only you can see it");
    expect(sharedToastTitle("groups")).toBe("Your groups can see it");
    expect(sharedToastTitle("link")).toBe("Anyone with the link can see it");
  });
});

describe("the link: its address, Copy, New link and Turn off", () => {
  it("is the full address of /r/<code> on this app", () => {
    expect(recipeLinkHref(CODE)).toBe(`/r/${CODE}`);
    expect(recipeLinkUrl("https://stage.cookpool.store", CODE)).toBe(`https://stage.cookpool.store/r/${CODE}`);
    expect(recipeLinkUrl("http://localhost:3001/", CODE)).toBe(`http://localhost:3001/r/${CODE}`);
  });

  it("shows the address in a box with a dark Copy, New link and Turn off", () => {
    const props = {
      options: shareOptions([]),
      visibility: "link" as const,
      linkUrl: `https://stage.cookpool.store/r/${CODE}`,
      copied: false,
      savedBy: 0,
      onPick: () => undefined,
      onCopy: () => undefined,
      onRotate: () => undefined,
      onTurnOff: () => undefined,
      onDone: () => undefined,
    };
    const out = html(React.createElement(ShareSheetBody, props));
    expect(out).toContain(`https://stage.cookpool.store/r/${CODE}`);
    expect(out).toMatch(/class="[^"]*bg-foreground[^"]*text-background[^"]*">Copy<\/button>/);
    expect(out).toContain(">New link<");
    expect(out).toContain(">Turn off<");
    expect(out).toContain("Saved by 0");
    // Copied, once it is on the clipboard.
    expect(html(React.createElement(ShareSheetBody, { ...props, copied: true }))).toContain(">Copied<");
    // While the code is on its way: no address to copy yet.
    const making = html(React.createElement(ShareSheetBody, { ...props, linkUrl: null }));
    expect(making).toContain(LINK_MAKING_TEXT);
    expect(making).toMatch(/disabled="" class="[^"]*">Copy</);
  });

  it("Copy writes the address to the clipboard, and says so for a moment", async () => {
    const written: string[] = [];
    const clipboard = { writeText: (text: string) => (written.push(text), Promise.resolve()) };
    await expect(copyLink(`https://stage.cookpool.store/r/${CODE}`, clipboard)).resolves.toBe(true);
    expect(written).toEqual([`https://stage.cookpool.store/r/${CODE}`]);
    expect(COPIED_MS).toBeGreaterThanOrEqual(2000);
  });

  it("Copy is false, never a throw, without a clipboard or permission", async () => {
    await expect(copyLink("x", null)).resolves.toBe(false);
    await expect(copyLink("x", { writeText: () => Promise.reject(new Error("NotAllowedError")) })).resolves.toBe(false);
  });

  it("New link is a POST of …/link: a fresh code, no Undo (the old one is gone)", async () => {
    const { deps, calls } = fakeShare();
    const rotate: ShareCall = { kind: "rotate" };
    const r = await sendShare("rcp_curry", rotate, deps);
    expect(calls).toEqual([{ what: "POST /v1/kitchen/me/recipes/{id}/link", args: ["rcp_curry"] }]);
    expect(r.ok && r.data.recipe.linkCode).toBe("ROTcode234");
    expect(visibilityAfter(rotate, "link")).toBe("link");
    expect(undoCallFor(rotate, "link")).toBeNull();
  });

  it("Turn off is a DELETE of …/link, back to My groups; Undo turns the link on again", async () => {
    const { deps, calls } = fakeShare();
    const off: ShareCall = { kind: "off" };
    const r = await sendShare("rcp_curry", off, deps);
    expect(calls).toEqual([{ what: "DELETE /v1/kitchen/me/recipes/{id}/link", args: ["rcp_curry"] }]);
    expect(r.ok && r.data.recipe).toMatchObject({ visibility: "groups", linkCode: null });
    expect(visibilityAfter(off, "link")).toBe("groups");
    expect(undoCallFor(off, "link")).toEqual(visibilityCall("link"));
  });

  it("says Saved by N", () => {
    expect(savedByText(0)).toBe("Saved by 0");
    expect(savedByText(4)).toBe("Saved by 4");
  });
});

describe("/r/<code>: the page a link opens", () => {
  const PANEER = recipe({
    id: "rcp_paneer",
    name: "Paneer bhurji",
    ownerId: ANU,
    ownerName: "Anu Thomas",
    mine: false,
    servesHalf: 4,
    serves: 2,
    minutes: 20,
    visibility: "link",
    linkCode: null,
    lines: [line(0, "Paneer", 200, "g", { isMain: true }), line(1, "Onion", 1, "onion"), line(2, "Tomato", 1, "tomato"), line(3, "Green chillies", 2, "pcs"), line(4, "Butter", 1, "tbsp"), line(5, "Salt", null, null)],
  });
  const match = {
    lines: [
      { position: 0, status: "missing" as const },
      { position: 1, status: "have" as const },
      { position: 2, status: "have" as const },
      { position: 3, status: "have" as const },
      { position: 4, status: "have" as const },
      { position: 5, status: "always" as const },
    ],
  };

  it("reads only a code that can be one (10 base-58 characters)", () => {
    expect(parseLinkCode(CODE)).toBe(CODE);
    expect(parseLinkCode("_")).toBeNull();
    expect(parseLinkCode("7kq2mxAb3")).toBeNull();
    expect(parseLinkCode("0OIl0OIl0O")).toBeNull();
    expect(parseLinkCode("%ZZ")).toBeNull();
    expect(parseLinkCode(null)).toBeNull();
  });

  it("says who shared it, from a link, then Serves 2 · 20 min", () => {
    expect(sharedByText(PANEER)).toEqual({ title: "Anu shared a recipe", sub: "From a link" });
    expect(sharedByText({ ...PANEER, isSystem: true })).toEqual({ title: "Cookpool shared a recipe", sub: "From a link" });
    expect(sharedByText({ ...PANEER, mine: true }).title).toBe("You shared this recipe");
    expect(servesLine(PANEER)).toBe("Serves 2 · 20 min");
    expect(servesLine({ servesHalf: 3, minutes: null })).toBe("Serves 1½");
  });

  it("gives each line its amount and a dot: green for what you have (Always have too), red for missing", () => {
    expect(linkLines(PANEER, match).map((l) => [l.name, l.amount, l.tone])).toEqual([
      ["Paneer", "200 g", "missing"],
      ["Onion", "1 onion", "have"],
      ["Tomato", "1 tomato", "have"],
      ["Green chillies", "2 pcs", "have"],
      ["Butter", "1 tbsp", "have"],
      ["Salt", "To taste", "have"],
    ]);
    // Before the match answers: no dots yet.
    expect(linkLines(PANEER, null).every((l) => l.tone === null)).toBe(true);
  });

  it("sums it up: You have 5 of 6 · missing paneer", () => {
    expect(linkHaveText(PANEER, match)).toEqual({ text: "You have 5 of 6 · missing paneer", complete: false });
    const short = { lines: match.lines.map((l) => (l.position === 0 ? { ...l, status: "short" as const } : l)) };
    expect(linkHaveText(PANEER, short)?.text).toBe("You have 5 of 6 · short of paneer");
    const all = { lines: match.lines.map((l) => ({ ...l, status: "have" as const })) };
    expect(linkHaveText(PANEER, all)).toEqual({ text: "You have all 6", complete: true });
    expect(linkHaveText(PANEER, null)).toBeNull();
  });

  it("Save to my recipes is a copy by the link's code", async () => {
    const sent: CopyRecipeRequest[] = [];
    const r = await saveFromLink(CODE, {
      copyRecipe: (body) => (sent.push(body), Promise.resolve(ok({ recipe: recipe({ id: "rcp_mine", source: { recipeId: "rcp_paneer", ownerId: ANU, ownerName: "Anu Thomas" } }), lastCook: null }))),
    });
    expect(sent).toEqual([{ linkCode: CODE }]);
    expect(r.ok && r.data.recipe.source?.ownerName).toBe("Anu Thomas");
  });

  it("Saved · Undo deletes that copy once the save has landed — and nothing when it was refused", async () => {
    const deleted: string[] = [];
    const deps = { deleteRecipe: (id: string) => (deleted.push(id), Promise.resolve(ok({ recipe: recipe({ id }), lastCook: null }))) };
    const r = await undoSave(Promise.resolve(ok({ recipe: recipe({ id: "rcp_mine" }), lastCook: null })), deps);
    expect(deleted).toEqual(["rcp_mine"]);
    expect(r?.ok).toBe(true);
    await expect(undoSave(Promise.resolve(refused), deps)).resolves.toBeNull();
    expect(deleted).toEqual(["rcp_mine"]);
  });

  it("its button: Save, then Saved · Undo (linking to your copy), a copy from before opens it, your own opens itself", () => {
    const base = { recipe: { id: "rcp_paneer", mine: false }, existingCopyId: null, savedHere: null };
    expect(linkSaveState(base)).toEqual({ kind: "save" });
    expect(linkSaveState({ ...base, savedHere: { copyId: null } })).toEqual({ kind: "saved", copyId: null });
    expect(linkSaveState({ ...base, savedHere: { copyId: "rcp_mine" } })).toEqual({ kind: "saved", copyId: "rcp_mine" });
    // The server's copy is in My recipes before this page has its id: it links to it.
    expect(linkSaveState({ ...base, existingCopyId: "rcp_mine", savedHere: { copyId: null } })).toEqual({ kind: "saved", copyId: "rcp_mine" });
    expect(linkSaveState({ ...base, existingCopyId: "rcp_old" })).toEqual({ kind: "had", copyId: "rcp_old" });
    expect(linkSaveState({ ...base, recipe: { id: "rcp_paneer", mine: true } })).toEqual({ kind: "own", recipeId: "rcp_paneer" });
  });

  it("says whose edits won't change your copy", () => {
    expect(linkSaveNote(PANEER)).toBe("You get your own copy. Anu's edits won't change it.");
    expect(linkSaveNote({ isSystem: true, ownerName: "Cookpool" })).toBe("You get your own copy. Cookpool's edits won't change it.");
    expect(linkSavedNote(PANEER)).toBe("Open your copy · from Anu");
  });

  it("draws the sharer, the recipe, the lines, the sum and Save to my recipes", () => {
    const view = (save: Parameters<typeof RecipeLinkView>[0]["save"]) =>
      html(
        React.createElement(RecipeLinkView, {
          recipe: PANEER,
          meId: null,
          lines: linkLines(PANEER, match),
          have: linkHaveText(PANEER, match),
          save,
          onSave: () => undefined,
          onUndo: () => undefined,
        }),
      );
    const out = view({ kind: "save" });
    expect(out).toContain("Anu shared a recipe");
    expect(out).toContain("From a link");
    expect(out).toContain("Paneer bhurji");
    expect(out).toContain("Serves 2 · 20 min");
    expect(out).toContain("You have 5 of 6 · missing paneer");
    expect(out.match(/bg-destructive/g)).toHaveLength(1);
    expect(out.match(/h-2\.5 w-2\.5 shrink-0 rounded-full bg-primary/g)).toHaveLength(5);
    expect(out).toContain(">Save to my recipes<");
    expect(out).toContain("You get your own copy. Anu&#x27;s edits won&#x27;t change it.");

    const saved = view({ kind: "saved", copyId: "rcp_mine" });
    expect(saved).toContain(">Saved · Undo<");
    expect(saved).toContain('href="/recipes/rcp_mine"');
    expect(saved).toContain("Open your copy · from Anu");
    expect(view({ kind: "had", copyId: "rcp_old" })).toContain('href="/recipes/rcp_old"');
  });

  it("a dead or rotated link says it no longer works, with the way back to Cook", () => {
    expect(linkFailure({ code: "not_found" })).toBe("gone");
    expect(linkFailure({ code: "network_error" })).toBe("error");
    expect(linkFailure(null)).toBeNull();
    const out = html(React.createElement(LinkGone));
    expect(out).toContain(LINK_GONE_TEXT);
    expect(LINK_GONE_TEXT).toBe("This link no longer works");
    expect(out).toContain('href="/cook"');
  });

  it("matches with the link's code (RC-5's ?code= on the match), at the recipe's own size", () => {
    // The match the page reads is the recipe's own at × 1, as curryMatch shapes it.
    expect(linkLines(recipe(), curryMatch(1000)).map((l) => l.tone)).toEqual(["short", "have", "have", "missing", "have", "have", "have", "have"]);
    expect(linkHaveText(recipe(), curryMatch(1000))?.text).toBe("You have 6 of 8 · missing yogurt · short of chicken");
  });
});
