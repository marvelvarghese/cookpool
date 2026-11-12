import {
  handleAddGroupShoppingItem,
  handleAddGroupStaple,
  handleAddMyShoppingItem,
  handleAddMyStaple,
  handleClearGroupShopping,
  handleClearMyShopping,
  handleGroupStapleBought,
  handleGroupStaples,
  handleMyStapleBought,
  handleMyStaples,
  handleRemoveGroupShoppingItem,
  handleRemoveGroupStaple,
  handleRemoveMyShoppingItem,
  handleRemoveMyStaple,
  handleUpdateGroupShoppingItem,
  handleUpdateGroupStaple,
  handleUpdateMyShoppingItem,
  handleUpdateMyStaple,
} from "./handlers/staples.js";
import type { MeRoute, OrgRoute } from "./router.js";

// Always have per pantry and the shopping list (cookpool-revamp RV-21): your
// own under /v1/kitchen/me, a group's under /v1/organizations/{org}/kitchen.

export const STAPLE_ME_ROUTES: readonly MeRoute[] = [
  { name: "kitchen.me.staples", pattern: /^\/v1\/kitchen\/me\/staples$/, methods: { GET: handleMyStaples, POST: handleAddMyStaple } },
  { name: "kitchen.me.staple", pattern: /^\/v1\/kitchen\/me\/staples\/([^/]+)$/, methods: { PATCH: handleUpdateMyStaple, DELETE: handleRemoveMyStaple } },
  { name: "kitchen.me.staple.bought", pattern: /^\/v1\/kitchen\/me\/staples\/([^/]+)\/bought$/, methods: { POST: handleMyStapleBought } },
  { name: "kitchen.me.shopping", pattern: /^\/v1\/kitchen\/me\/shopping$/, methods: { POST: handleAddMyShoppingItem } },
  // Ahead of the line route, which would read "clear" as an id.
  { name: "kitchen.me.shopping.clear", pattern: /^\/v1\/kitchen\/me\/shopping\/clear$/, methods: { POST: handleClearMyShopping } },
  { name: "kitchen.me.shopping.item", pattern: /^\/v1\/kitchen\/me\/shopping\/([^/]+)$/, methods: { PATCH: handleUpdateMyShoppingItem, DELETE: handleRemoveMyShoppingItem } },
];

export const STAPLE_ORG_ROUTES: readonly OrgRoute[] = [
  { name: "kitchen.staples", pattern: /^\/v1\/organizations\/([^/]+)\/kitchen\/staples$/, methods: { GET: handleGroupStaples, POST: handleAddGroupStaple } },
  { name: "kitchen.staple", pattern: /^\/v1\/organizations\/([^/]+)\/kitchen\/staples\/([^/]+)$/, methods: { PATCH: handleUpdateGroupStaple, DELETE: handleRemoveGroupStaple } },
  { name: "kitchen.staple.bought", pattern: /^\/v1\/organizations\/([^/]+)\/kitchen\/staples\/([^/]+)\/bought$/, methods: { POST: handleGroupStapleBought } },
  { name: "kitchen.shopping", pattern: /^\/v1\/organizations\/([^/]+)\/kitchen\/shopping$/, methods: { POST: handleAddGroupShoppingItem } },
  { name: "kitchen.shopping.clear", pattern: /^\/v1\/organizations\/([^/]+)\/kitchen\/shopping\/clear$/, methods: { POST: handleClearGroupShopping } },
  { name: "kitchen.shopping.item", pattern: /^\/v1\/organizations\/([^/]+)\/kitchen\/shopping\/([^/]+)$/, methods: { PATCH: handleUpdateGroupShoppingItem, DELETE: handleRemoveGroupShoppingItem } },
];
