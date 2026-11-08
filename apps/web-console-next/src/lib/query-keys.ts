/**
 * Stable react-query cache keys (Task 0130 / PERF1).
 *
 * Dependency-free (no React, no react-query) so the key composition is
 * unit-testable in isolation. One factory per resource; the id args already
 * encode the org/project scope, so keys never collide across resources, and
 * the same resource+scope always produces an equal key (shared cache entry).
 */
export const qk = {
  orgs: () => ["orgs"] as const,
  profile: () => ["profile"] as const,
  projects: (orgId: string) => ["projects", orgId] as const,
  environments: (orgId: string, projectId: string) =>
    ["environments", orgId, projectId] as const,
  members: (orgId: string) => ["members", orgId] as const,
  invitations: (orgId: string) => ["invitations", orgId] as const,
  apiKeys: (orgId: string) => ["apiKeys", orgId] as const,
  webhooks: (orgId: string) => ["webhooks", orgId] as const,
  webhookEndpoint: (orgId: string, endpointId: string) =>
    ["webhookEndpoint", orgId, endpointId] as const,
  notificationPrefs: (orgId: string) => ["notificationPrefs", orgId] as const,
  integrations: (orgId: string) => ["integrations", orgId] as const,
  repoLinks: (orgId: string, projectId: string) => ["repoLinks", orgId, projectId] as const,
  configSettings: (scopeKey: string) => ["configSettings", scopeKey] as const,
  configFlags: (scopeKey: string) => ["configFlags", scopeKey] as const,
  configSecrets: (scopeKey: string) => ["configSecrets", scopeKey] as const,
  billingSummary: (orgId: string) => ["billingSummary", orgId] as const,
  entitlements: (orgId: string) => ["entitlements", orgId] as const,
  invoices: (orgId: string) => ["invoices", orgId] as const,
  // Cookpool (CP-5): a group's kitchen settings, its join code (owners and
  // admins), and the preview a join link shows.
  kitchenSettings: (orgId: string) => ["kitchenSettings", orgId] as const,
  joinCode: (orgId: string) => ["joinCode", orgId] as const,
  joinPreview: (code: string) => ["joinPreview", code] as const,
  // Cookpool's ledger (CP-8), per group: the activity feed (paged), the whole
  // feed (for the debts behind a settle plan), balances and the settle plan.
  // Each starts with `kitchenLedger(orgId)`, so one invalidation of that
  // prefix refreshes all four after a write.
  kitchenLedger: (orgId: string) => ["kitchenLedger", orgId] as const,
  kitchenActivity: (orgId: string) => ["kitchenLedger", orgId, "activity"] as const,
  kitchenActivityAll: (orgId: string) => ["kitchenLedger", orgId, "activityAll"] as const,
  kitchenBalances: (orgId: string) => ["kitchenLedger", orgId, "balances"] as const,
  kitchenSettlePlan: (orgId: string) => ["kitchenLedger", orgId, "settlePlan"] as const,
  // Cookpool's people (CP-9): the caller's balances across every group and
  // the "why" for one person, both under `kitchenMe()` so a ledger write
  // refreshes them together; a group's members, by name and role.
  kitchenMe: () => ["kitchenMe"] as const,
  kitchenMyBalances: () => ["kitchenMe", "balances"] as const,
  kitchenPerson: (subjectId: string) => ["kitchenMe", "person", subjectId] as const,
  kitchenMembers: (orgId: string) => ["kitchenMembers", orgId] as const,
  // Every group's member list at once (SI-6: a rename refreshes them all).
  kitchenMembersAll: () => ["kitchenMembers"] as const,
  // Cookpool's pantries (CP-12): every pantry with its totals, the items of
  // one pantry ("all", "personal" or a group's org id), Home's use-soon strip,
  // one item (by its page ref, `me:itm_…` / `org:org_…:itm_…`) and its
  // history. All start with `kitchenPantry()`, so one invalidation after a
  // stock write refreshes every pantry read.
  kitchenPantry: () => ["kitchenPantry"] as const,
  kitchenPantries: () => ["kitchenPantry", "pantries"] as const,
  kitchenPantryItems: (pantry: string) => ["kitchenPantry", "items", pantry] as const,
  kitchenUseSoon: () => ["kitchenPantry", "useSoon"] as const,
  kitchenItem: (ref: string) => ["kitchenPantry", "item", ref] as const,
  kitchenItemMoves: (ref: string) => ["kitchenPantry", "moves", ref] as const,
  // Quick use (CP-13): what the caller often uses, a search across every
  // pantry they may use from, and their usable items (the strip before they
  // have usuals). Under `kitchenPantry()` too, so a use refreshes them.
  kitchenUsuals: () => ["kitchenPantry", "usuals"] as const,
  // The new frame's usuals (cookpool-pantry PN-5): per part of the day, so the
  // read runs again when the morning ends. Under `kitchenUsuals()` too.
  kitchenUsualsAt: (bucket: string) => ["kitchenPantry", "usuals", bucket] as const,
  // Ask before use (cookpool-pantry PN-9): the asks the caller answers and
  // their own from the last day. Under `kitchenPantry()`, so every stock
  // write (an approval is one) reads them again.
  kitchenAsks: () => ["kitchenPantry", "asks"] as const,
  kitchenSearch: (q: string) => ["kitchenPantry", "search", q] as const,
  kitchenUsable: () => ["kitchenPantry", "usable"] as const,
  // Restocking (cookpool-pantry PN-6): what was finished this week, what is
  // running low, what you usually buy. Under `kitchenPantry()`, so every
  // stock write and every purchase reads it again.
  kitchenRestock: () => ["kitchenPantry", "restock"] as const,
  // The dish maker (CP-15): the items the cook may cook with, under
  // `kitchenPantry()` so any stock write refreshes them.
  kitchenCookable: () => ["kitchenPantry", "cookable"] as const,
  // From before (SM-9): names bought before and dishes cooked before, per
  // typed text. Under `kitchenPantry()` too, so adding an item, a use and
  // cooking (which refreshes every pantry read) refresh them: a count, or
  // what an ingredient would come from now, may have changed.
  kitchenItemHistory: (q: string) => ["kitchenPantry", "history", q] as const,
  kitchenRecipes: (q: string) => ["kitchenPantry", "recipes", q] as const,
  // Recipes (cookpool-recipes RC-4; RC-5's screens and RC-6's session share
  // these). What your pantries hold for them: Cook now and one recipe's
  // match at a factor, under `kitchenPantry()`, so every stock write (a use,
  // an add, cooking) refreshes them; a recipe write refreshes them by these
  // keys.
  kitchenCookNow: () => ["kitchenPantry", "cookNow"] as const,
  kitchenRecipeMatches: (recipeId: string) => ["kitchenPantry", "recipeMatch", recipeId] as const,
  kitchenRecipeMatch: (recipeId: string, factorMilli: number) => ["kitchenPantry", "recipeMatch", recipeId, factorMilli] as const,
  // Every recipe's match at once (RC-8: an Always have edit or a food answer
  // changes what every recipe finds), and Explore per source, search and
  // kind, its rows carrying their match, so it sits under the pantry too.
  kitchenAllRecipeMatches: () => ["kitchenPantry", "recipeMatch"] as const,
  kitchenExploreAll: () => ["kitchenPantry", "explore"] as const,
  kitchenExplore: (source: string, q: string, kind: string) => ["kitchenPantry", "explore", source, q, kind] as const,
  // Recipes themselves: yours and your copies (My recipes, You), and one
  // recipe in full with the caller's last cook of it (its page, the session).
  // Both start with `kitchenRecipeBook()`, so one invalidation after a write,
  // a copy, a delete or a cook refreshes every recipe read. The food list,
  // per typed text, for writing a line.
  kitchenRecipeBook: () => ["kitchenRecipeBook"] as const,
  kitchenMyRecipes: () => ["kitchenRecipeBook", "mine"] as const,
  kitchenRecipe: (recipeId: string) => ["kitchenRecipeBook", "recipe", recipeId] as const,
  // The same recipe read at a size (cookpool-guided GC-6's plan): only its
  // steps' learned ranges (GC-7) differ, so it sits under the recipe's own
  // key, and anything that refreshes or patches the recipe reaches it too.
  kitchenRecipeAt: (recipeId: string, factorMilli: number) => ["kitchenRecipeBook", "recipe", recipeId, "f", factorMilli] as const,
  // RC-8: a person's recipes (their page) and the recipe a link opens, under
  // the book too, so a copy refreshes their "saved by".
  kitchenPersonRecipes: (subjectId: string) => ["kitchenRecipeBook", "person", subjectId] as const,
  kitchenRecipeLink: (code: string) => ["kitchenRecipeBook", "link", code] as const,
  // Always have (RC-8): the foods you count as there.
  kitchenAlwaysHave: () => ["kitchenAlwaysHave"] as const,
  kitchenFoods: (q: string) => ["kitchenFoods", q] as const,
  // Cookpool's dishes (CP-17): one dish (its page) and a group's dishes (the
  // group's Dishes tab). Both start with `kitchenDishes()`, so one
  // invalidation after cooking, a claim, an assignment, a finalize, a
  // correction or a cancel refreshes every dish read.
  kitchenDishes: () => ["kitchenDishes"] as const,
  kitchenDish: (dishId: string) => ["kitchenDishes", "dish", dishId] as const,
  kitchenGroupDishes: (orgId: string) => ["kitchenDishes", "group", orgId] as const,
  // The dishes you cooked or that were shared with your groups (cookpool-recipes
  // RC-2: Home's "From your groups", your page and a person's cooks), paged.
  kitchenMyDishes: () => ["kitchenDishes", "mine"] as const,
  // Home (CP-23): the inbox — under `kitchenMe()`, so every ledger write
  // refreshes it; stock writes and dish writes refresh it by this key too —
  // and each group's newest entries for Recent activity, under the group's
  // `kitchenLedger(orgId)`, so a write in that group refreshes them.
  kitchenInbox: () => ["kitchenMe", "inbox"] as const,
  kitchenRecentActivity: (orgId: string) => ["kitchenLedger", orgId, "recent"] as const,
  // Community (cookpool-community CM-5): your profile, a handle's
  // availability, someone's profile and its lists, your follow requests,
  // blocks, people search and suggestions. All start with
  // `kitchenCommunity()`, so a follow, block or mute refreshes every one.
  // A profile's public recipes sit under the recipe book, so a copy refreshes
  // their "saved by".
  kitchenCommunity: () => ["kitchenCommunity"] as const,
  kitchenMyProfile: () => ["kitchenCommunity", "me"] as const,
  kitchenHandle: (handle: string) => ["kitchenCommunity", "handle", handle] as const,
  kitchenPersonProfile: (handle: string) => ["kitchenCommunity", "profile", handle] as const,
  kitchenProfilePeople: (handle: string, list: "followers" | "following") => ["kitchenCommunity", "people", handle, list] as const,
  kitchenFollowRequests: () => ["kitchenCommunity", "requests"] as const,
  kitchenBlocks: () => ["kitchenCommunity", "blocks"] as const,
  kitchenPeopleSearch: (q: string) => ["kitchenCommunity", "search", q] as const,
  kitchenPeopleSuggestions: () => ["kitchenCommunity", "suggestions"] as const,
  kitchenProfileRecipes: (handle: string) => ["kitchenRecipeBook", "profile", handle] as const,
  // Notifications (cookpool-app PW-6): the environment's VAPID public key
  // (null while it has none) and the person's push kinds, in every group.
  pushKey: () => ["push", "key"] as const,
  pushPrefs: () => ["push", "prefs"] as const,
};
