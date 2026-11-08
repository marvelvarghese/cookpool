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
import { handleActivityFeed, handleMarkActivityRead, handleUnreadActivity } from "./handlers/community-activity.js";
import {
  handleCreatePost,
  handleDeletePost,
  handleFeed,
  handleGetPost,
  handleProfilePosts,
  handleRestorePost,
  handleUpdatePost,
} from "./handlers/community-posts.js";
import {
  handleAddComment,
  handleComments,
  handleDeleteComment,
  handleReport,
  handleUnyum,
  handleYum,
} from "./handlers/community-reactions.js";
import type { MeRoute } from "./router.js";

// Profiles and following (CM-2, cookpool-community design §1), and posts,
// the feeds, reactions, reports and Activity (CM-3, §2): the caller's
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
  // Posts, the feeds, Yum, comments, reports and Activity (CM-3, design §2).
  {
    name: "kitchen.me.posts",
    pattern: /^\/v1\/kitchen\/me\/posts$/,
    methods: { POST: handleCreatePost },
  },
  {
    name: "kitchen.me.post",
    pattern: /^\/v1\/kitchen\/me\/posts\/([^/]+)$/,
    methods: { PATCH: handleUpdatePost, DELETE: handleDeletePost },
  },
  {
    name: "kitchen.me.post.restore",
    pattern: /^\/v1\/kitchen\/me\/posts\/([^/]+)\/restore$/,
    methods: { POST: handleRestorePost },
  },
  {
    name: "kitchen.post",
    pattern: /^\/v1\/kitchen\/posts\/([^/]+)$/,
    methods: { GET: handleGetPost },
  },
  {
    name: "kitchen.post.yum",
    pattern: /^\/v1\/kitchen\/posts\/([^/]+)\/yum$/,
    methods: { POST: handleYum, DELETE: handleUnyum },
  },
  {
    name: "kitchen.post.comments",
    pattern: /^\/v1\/kitchen\/posts\/([^/]+)\/comments$/,
    methods: { GET: handleComments, POST: handleAddComment },
  },
  {
    name: "kitchen.comment",
    pattern: /^\/v1\/kitchen\/comments\/([^/]+)$/,
    methods: { DELETE: handleDeleteComment },
  },
  {
    name: "kitchen.reports",
    pattern: /^\/v1\/kitchen\/reports$/,
    methods: { POST: handleReport },
  },
  {
    name: "kitchen.me.feed",
    pattern: /^\/v1\/kitchen\/me\/feed$/,
    methods: { GET: handleFeed },
  },
  {
    name: "kitchen.profile.posts",
    pattern: /^\/v1\/kitchen\/profiles\/([^/]+)\/posts$/,
    methods: { GET: handleProfilePosts },
  },
  {
    name: "kitchen.me.activity",
    pattern: /^\/v1\/kitchen\/me\/activity$/,
    methods: { GET: handleActivityFeed },
  },
  {
    name: "kitchen.me.activity.read",
    pattern: /^\/v1\/kitchen\/me\/activity\/read$/,
    methods: { POST: handleMarkActivityRead },
  },
  {
    name: "kitchen.me.activity.unread",
    pattern: /^\/v1\/kitchen\/me\/activity\/unread$/,
    methods: { GET: handleUnreadActivity },
  },
];
