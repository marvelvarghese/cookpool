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
  kitchenSearch: (q: string) => ["kitchenPantry", "search", q] as const,
  kitchenUsable: () => ["kitchenPantry", "usable"] as const,
  // The dish maker (CP-15): the items the cook may cook with, under
  // `kitchenPantry()` so any stock write refreshes them.
  kitchenCookable: () => ["kitchenPantry", "cookable"] as const,
  // From before (SM-9): names bought before and dishes cooked before, per
  // typed text. Under `kitchenPantry()` too, so adding an item, a use and
  // cooking (which refreshes every pantry read) refresh them: a count, or
  // what an ingredient would come from now, may have changed.
  kitchenItemHistory: (q: string) => ["kitchenPantry", "history", q] as const,
  kitchenRecipes: (q: string) => ["kitchenPantry", "recipes", q] as const,
  // What your pantries hold for recipes (cookpool-recipes RC-5): Cook now and
  // one recipe's match at a factor. Under `kitchenPantry()`, so every stock
  // write (a use, an add, cooking) refreshes them; a recipe write refreshes
  // them by these keys.
  kitchenCookNow: () => ["kitchenPantry", "cookNow"] as const,
  kitchenRecipeMatches: (recipeId: string) => ["kitchenPantry", "recipeMatch", recipeId] as const,
  kitchenRecipeMatch: (recipeId: string, factorMilli: number) => ["kitchenPantry", "recipeMatch", recipeId, factorMilli] as const,
  // Recipes themselves (RC-5): yours and your copies (My recipes, You), and
  // one recipe in full. Both start with `kitchenRecipeBook()`, so one
  // invalidation after a write, a copy or a delete refreshes every recipe
  // read. The food list, per typed text, for writing a line.
  kitchenRecipeBook: () => ["kitchenRecipeBook"] as const,
  kitchenMyRecipes: () => ["kitchenRecipeBook", "mine"] as const,
  kitchenRecipe: (recipeId: string) => ["kitchenRecipeBook", "recipe", recipeId] as const,
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
  // Notifications (cookpool-app PW-6): the environment's VAPID public key
  // (null while it has none) and the person's push kinds, in every group.
  pushKey: () => ["push", "key"] as const,
  pushPrefs: () => ["push", "prefs"] as const,
};
