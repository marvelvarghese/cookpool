import {
  handleAcceptFollow,
  handleBlock,
  handleDeclineFollow,
  handleFollow,
  handleFollowRequests,
  handleListBlocks,
  handleMute,
  handleRemoveFollower,
  handleUnblock,
  handleUnfollow,
  handleUnmute,
} from "./handlers/community-follows.js";
import { handlePeopleSuggestions, handleSearchPeople } from "./handlers/community-people.js";
import {
  handleGetMyProfile,
  handleGetProfile,
  handleHandleAvailable,
  handleProfileFollowers,
  handleProfileFollowing,
  handleProfileRecipes,
  handleSaveMyProfile,
} from "./handlers/community-profiles.js";
import type { MeRoute } from "./router.js";

// Profiles and following (CM-2, cookpool-community design §1): the caller's
// own routes, matched AHEAD of every other /v1/kitchen/… route —
// /me/people/suggestions before /me/people/{usr}, whose capture would
// otherwise take "suggestions". The router spreads these first.
export const COMMUNITY_ROUTES: readonly MeRoute[] = [
  {
    name: "kitchen.me.profile",
    pattern: /^\/v1\/kitchen\/me\/profile$/,
    methods: { GET: handleGetMyProfile, PUT: handleSaveMyProfile },
  },
  {
    name: "kitchen.handle",
    pattern: /^\/v1\/kitchen\/handles\/([^/]+)$/,
    methods: { GET: handleHandleAvailable },
  },
  {
    name: "kitchen.profile",
    pattern: /^\/v1\/kitchen\/profiles\/([^/]+)$/,
    methods: { GET: handleGetProfile },
  },
  {
    name: "kitchen.profile.recipes",
    pattern: /^\/v1\/kitchen\/profiles\/([^/]+)\/recipes$/,
    methods: { GET: handleProfileRecipes },
  },
  {
    name: "kitchen.profile.followers",
    pattern: /^\/v1\/kitchen\/profiles\/([^/]+)\/followers$/,
    methods: { GET: handleProfileFollowers },
  },
  {
    name: "kitchen.profile.following",
    pattern: /^\/v1\/kitchen\/profiles\/([^/]+)\/following$/,
    methods: { GET: handleProfileFollowing },
  },
  {
    name: "kitchen.me.follow",
    pattern: /^\/v1\/kitchen\/me\/follows\/([^/]+)$/,
    methods: { POST: handleFollow, DELETE: handleUnfollow },
  },
  {
    name: "kitchen.me.follow_requests",
    pattern: /^\/v1\/kitchen\/me\/follow-requests$/,
    methods: { GET: handleFollowRequests },
  },
  {
    name: "kitchen.me.follow_request.accept",
    pattern: /^\/v1\/kitchen\/me\/follow-requests\/([^/]+)\/accept$/,
    methods: { POST: handleAcceptFollow },
  },
  {
    name: "kitchen.me.follow_request.decline",
    pattern: /^\/v1\/kitchen\/me\/follow-requests\/([^/]+)\/decline$/,
    methods: { POST: handleDeclineFollow },
  },
  {
    name: "kitchen.me.follower",
    pattern: /^\/v1\/kitchen\/me\/followers\/([^/]+)$/,
    methods: { DELETE: handleRemoveFollower },
  },
  {
    name: "kitchen.me.blocks",
    pattern: /^\/v1\/kitchen\/me\/blocks$/,
    methods: { GET: handleListBlocks },
  },
  {
    name: "kitchen.me.block",
    pattern: /^\/v1\/kitchen\/me\/blocks\/([^/]+)$/,
    methods: { POST: handleBlock, DELETE: handleUnblock },
  },
  {
    name: "kitchen.me.mute",
    pattern: /^\/v1\/kitchen\/me\/mutes\/([^/]+)$/,
    methods: { POST: handleMute, DELETE: handleUnmute },
  },
  {
    name: "kitchen.people.search",
    pattern: /^\/v1\/kitchen\/people\/search$/,
    methods: { GET: handleSearchPeople },
  },
  {
    name: "kitchen.me.people.suggestions",
    pattern: /^\/v1\/kitchen\/me\/people\/suggestions$/,
    methods: { GET: handlePeopleSuggestions },
  },
];
