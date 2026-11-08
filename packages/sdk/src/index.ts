// `@saas/sdk` — Cookpool TypeScript SDK.
//
// Stable public surface:
//   - `Cookpool`              → the client class
//   - Per-resource clients reachable via `client.<resource>`
//   - typed error hierarchy from `./errors`
//   - request/response types re-exported from `@saas/contracts`
//
// The transport (`Transport`, `generateRequestId`) is exported for advanced
// callers (custom retry middleware, alt resource fan-out) but the typical
// integration path is the `Cookpool` class.

import { ApiKeysClient } from "./apiKeys.js";
import { AuthClient } from "./auth.js";
import { IntegrationsClient } from "./integrations.js";
import { KitchenClient } from "./kitchen.js";
import { BillingClient } from "./billing.js";
import { ConfigClient } from "./config.js";
import { EnvironmentsClient } from "./environments.js";
import { EventsClient } from "./events.js";
import { MembershipsClient } from "./memberships.js";
import { MeteringClient } from "./metering.js";
import { NotificationsClient } from "./notifications.js";
import { OrganizationsClient } from "./organizations.js";
import { ProjectsClient } from "./projects.js";
import { SecurityEventsClient } from "./securityEvents.js";
import { WebhooksClient } from "./webhooks.js";
import { Transport, type ClientOptions } from "./transport.js";

export class Cookpool {
  readonly organizations: OrganizationsClient;
  readonly projects: ProjectsClient;
  readonly environments: EnvironmentsClient;
  readonly memberships: MembershipsClient;
  readonly apiKeys: ApiKeysClient;
  readonly webhooks: WebhooksClient;
  readonly metering: MeteringClient;
  readonly billing: BillingClient;
  readonly events: EventsClient;
  readonly securityEvents: SecurityEventsClient;
  readonly config: ConfigClient;
  readonly notifications: NotificationsClient;
  readonly auth: AuthClient;
  readonly integrations: IntegrationsClient;
  readonly kitchen: KitchenClient;
  /** Underlying HTTP transport. Exposed for advanced extension. */
  readonly transport: Transport;

  constructor(options: ClientOptions) {
    this.transport = new Transport(options);
    this.organizations = new OrganizationsClient(this.transport);
    this.projects = new ProjectsClient(this.transport);
    this.environments = new EnvironmentsClient(this.transport);
    this.memberships = new MembershipsClient(this.transport);
    this.apiKeys = new ApiKeysClient(this.transport);
    this.webhooks = new WebhooksClient(this.transport);
    this.metering = new MeteringClient(this.transport);
    this.billing = new BillingClient(this.transport);
    this.events = new EventsClient(this.transport);
    this.securityEvents = new SecurityEventsClient(this.transport);
    this.config = new ConfigClient(this.transport);
    this.notifications = new NotificationsClient(this.transport);
    this.auth = new AuthClient(this.transport);
    this.integrations = new IntegrationsClient(this.transport);
    this.kitchen = new KitchenClient(this.transport);
  }
}

// Resource clients (also reachable via `client.<resource>`).
export { OrganizationsClient } from "./organizations.js";
export { ProjectsClient } from "./projects.js";
export { EnvironmentsClient } from "./environments.js";
export { MembershipsClient } from "./memberships.js";
export {
  ApiKeysClient,
  type ListApiKeysResponse,
  type GetApiKeyResponse,
  type CreateApiKeyResponse,
  type RevokeApiKeyResponse,
} from "./apiKeys.js";
export {
  WebhooksClient,
  type ListDeliveryAttemptsQuery,
  type DeliveryAttemptsPage,
} from "./webhooks.js";
export { MeteringClient } from "./metering.js";
export { BillingClient } from "./billing.js";
export {
  EventsClient,
  AUDIT_ITERATOR_MAX_PAGES,
  type AuditEntryFilters,
  type ListAuditEntriesQuery,
  type ListAuditEntriesResult,
} from "./events.js";
export {
  SecurityEventsClient,
  type ListSecurityEventsQuery,
  type SecurityEventsPage,
} from "./securityEvents.js";
export { ConfigClient, type ConfigScope } from "./config.js";
export { NotificationsClient } from "./notifications.js";
export { AuthClient } from "./auth.js";
export { IntegrationsClient } from "./integrations.js";
export { KitchenClient } from "./kitchen.js";

// Transport surface.
export {
  Transport,
  generateRequestId,
  type AuthOption,
  type ClientOptions,
  type RequestOptions,
  type SuccessEnvelope,
} from "./transport.js";

// Typed error hierarchy.
export {
  CookpoolError,
  BadRequestError,
  UnauthenticatedError,
  ForbiddenError,
  NotFoundError,
  ConflictError,
  ValidationError,
  PreconditionFailedError,
  UnsupportedError,
  InternalError,
  RateLimitError,
  decodeError,
  type ErrorEnvelope,
  type RateLimitWindow,
} from "./errors.js";

// Re-export contract types so consumers don't import `@saas/contracts` directly.
export type {
  PublicOrganization,
  CreateOrganizationRequest,
  CreateOrganizationResponse,
  GetOrganizationResponse,
  ListOrganizationsResponse,
  PublicMember,
  PublicMemberRoleAssignment,
  ListMembersResponse,
  InvitationRole,
  CreateInvitationRequest,
  CreateInvitationResponse,
  PublicInvitation,
  ListInvitationsResponse,
  RevokeInvitationResponse,
  UpdateMemberRoleRequest,
  UpdateMemberRoleResponse,
  RemoveMemberResponse,
  AcceptInvitationRequest,
  AcceptInvitationResponse,
  JoinCodeResponse,
  JoinPreview,
  JoinRequest,
  JoinResponse,
  LeaveResponse,
} from "@saas/contracts/membership";

export { ORGANIZATION_ROLES } from "@saas/contracts/membership";

export type {
  PublicProject,
  PublicEnvironment,
  CreateProjectRequest,
  CreateProjectResponse,
  GetProjectResponse,
  ListProjectsResponse,
  ArchiveProjectResponse,
  CreateEnvironmentRequest,
  CreateEnvironmentResponse,
  GetEnvironmentResponse,
  ListEnvironmentsResponse,
  ArchiveEnvironmentResponse,
} from "@saas/contracts/projects";

export type {
  PublicApiKey,
  PublicApiKeyServicePrincipal,
  PublicApiKeyCreateResult,
  PublicApiKeyRevokeResult,
  CreateApiKeyRequest,
} from "@saas/contracts/api-keys";

export type {
  PublicWebhookEndpoint,
  ListWebhookEndpointsResponse,
  GetWebhookEndpointResponse,
  CreateWebhookEndpointRequest,
  CreateWebhookEndpointResponse,
  UpdateWebhookEndpointRequest,
  UpdateWebhookEndpointResponse,
  EnableWebhookEndpointRequest,
  EnableWebhookEndpointResponse,
  DisableWebhookEndpointRequest,
  DisableWebhookEndpointResponse,
  DeleteWebhookEndpointResponse,
  RotateWebhookSecretResponse,
  PublicWebhookSubscription,
  ListWebhookSubscriptionsResponse,
  GetWebhookSubscriptionResponse,
  CreateWebhookSubscriptionRequest,
  CreateWebhookSubscriptionResponse,
  UpdateWebhookSubscriptionRequest,
  UpdateWebhookSubscriptionResponse,
  DeleteWebhookSubscriptionResponse,
  PublicWebhookDeliveryAttempt,
  ListWebhookDeliveryAttemptsResponse,
  GetWebhookDeliveryAttemptResponse,
  ReplayWebhookDeliveryRequest,
  ReplayWebhookDeliveryResponse,
} from "@saas/contracts/webhooks";

export type {
  RecordUsageRequest,
  RecordUsageResponse,
  PublicUsageRecord,
  IngestUsageBatchRequest,
  IngestUsageBatchResponse,
  GetUsageSummaryRequest,
  PublicUsageRollup,
  GetUsageSummaryResponse,
  CheckQuotaRequest,
  CheckQuotaResponse,
  ListQuotaViolationsRequest,
  PublicQuotaViolation,
  ListQuotaViolationsResponse,
} from "@saas/contracts/metering";

export type {
  PublicPlan,
  PublicPlanStatus,
  PublicBillingInterval,
  ListPlansRequest,
  ListPlansResponse,
  PublicBillingCustomer,
  PublicBillingCustomerStatus,
  GetBillingCustomerResponse,
  PublicSubscription,
  PublicSubscriptionStatus,
  PublicInvoice,
  PublicInvoiceStatus,
  ListInvoicesRequest,
  ListInvoicesResponse,
  PublicEntitlement,
  PublicEntitlementValueType,
  PublicEntitlementSource,
  GetEntitlementsRequest,
  GetEntitlementsResponse,
  GetBillingSummaryResponse,
} from "@saas/contracts/billing";

export type {
  PublicAuditEntry,
  ListAuditEntriesResponse,
  EventActorType,
} from "@saas/contracts/events";

export type {
  PublicSecurityEvent,
  SecurityEventListResponse,
} from "@saas/contracts/security-events";

export type {
  PublicSetting,
  ListSettingsResponse,
  CreateSettingRequest,
  UpdateSettingRequest,
  CreateSettingResponse,
  UpdateSettingResponse,
  PublicFeatureFlag,
  ListFeatureFlagsResponse,
  CreateFeatureFlagRequest,
  UpdateFeatureFlagRequest,
  CreateFeatureFlagResponse,
  UpdateFeatureFlagResponse,
  PublicSecretMetadata,
  ListSecretMetadataResponse,
  CreateSecretMetadataRequest,
  CreateSecretRequest,
  CreateSecretMetadataResponse,
  RotateSecretRequest,
  RotateSecretMetadataResponse,
  RevokeSecretMetadataResponse,
} from "@saas/contracts/config";

export type {
  NotificationChannel,
  NotificationCategory,
  NotificationStatus,
  NotificationSubjectKind,
  NotificationRecipient,
  EnqueueNotificationRequest,
  EnqueueNotificationResponse,
  GetNotificationResponse,
  NotificationDeliveryStatus,
  NotificationAttempt,
  NotificationCategoryPreferences,
  NotificationPreference,
  GetNotificationPreferencesQuery,
  GetNotificationPreferencesResponse,
  UpdateNotificationPreferencesRequest,
  UpdateNotificationPreferencesResponse,
  NotificationSuppressionReason,
  NotificationSuppression,
  SuppressRecipientRequest,
  SuppressRecipientResponse,
  // Web Push (Cookpool PW-5).
  NotificationPreferenceChannel,
  NotificationKind,
  NotificationKindPreferences,
  PushSubscriptionKeys,
  PushSubscriptionRequest,
  PushSubscriptionResponse,
  PushDevice,
  UnsubscribePushRequest,
  UnsubscribePushResponse,
  PushKeyResponse,
  PushTestRequest,
  PushTestResponse,
  PushMessage,
} from "@saas/contracts/notifications";

export {
  NOTIFICATION_KINDS,
  PUSH_PREFERENCES_ORG_ID,
  PUSH_SUBSCRIPTIONS_MAX_PER_PERSON,
} from "@saas/contracts/notifications";

export { ERROR_CODES, type ErrorCode } from "@saas/contracts/errors";

export type {
  LoginStartRequest,
  LoginStartResponse,
  LoginCompleteRequest,
  LoginCompleteResponse,
  SessionResponse,
  LogoutResponse,
  ProfileResponse,
  UpdateProfileRequest,
  AuthUser,
} from "@saas/contracts/auth";

export type {
  KitchenAction,
  KitchenErrorReason,
  KitchenSettings,
  WastePolicy,
  GetKitchenSettingsResponse,
  UpdateKitchenSettingsRequest,
  UpdateKitchenSettingsResponse,
  KitchenTxnKind,
  SplitMode,
  SettlementMethod,
  KitchenSplit,
  KitchenTxn,
  CreateExpenseRequest,
  CreateExpenseResponse,
  CreateSettlementRequest,
  CreateSettlementResponse,
  ReverseTxnRequest,
  ReverseTxnResponse,
  KitchenTxnResponse,
  KitchenFlagState,
  KitchenFlag,
  FlagTxnRequest,
  FlagTxnResponse,
  ActivityQuery,
  ActivityPage,
  Balance,
  BalancesResponse,
  SettlePayment,
  SettlePlan,
  KitchenItemState,
  KitchenDimension,
  ItemFilter,
  PantryRef,
  PantryTotals,
  PersonalPantry,
  GroupPantry,
  Pantry,
  PantriesResponse,
  KitchenItem,
  ItemsQuery,
  GroupItemsQuery,
  ItemsPage,
  SearchItemsQuery,
  SearchItemsResponse,
  CreatePersonalItemRequest,
  CreateGroupItemRequest,
  UpdatePersonalItemRequest,
  UpdateGroupItemRequest,
  KitchenItemResponse,
  ReachableItem,
  ReachableItemsPage,
  StockMoveKind,
  KitchenStockMove,
  UseGroupItemRequest,
  UsePersonalItemRequest,
  WasteItemRequest,
  TransferItemRequest,
  StockMoveResponse,
  UseItemResponse,
  WasteItemResponse,
  TransferItemResponse,
  UndoMoveResponse,
  MovesQuery,
  MovesResponse,
  KitchenUsual,
  UsualsQuery,
  UsualsResponse,
  KitchenDishState,
  DishSplitMode,
  CookIngredientRequest,
  CookNewItemRequest,
  CookDishRequest,
  KitchenDishIngredient,
  DishOwed,
  KitchenDish,
  DishResponse,
  CookDishResponse,
  CancelDishResponse,
  DishesQuery,
  DishesPage,
} from "@saas/contracts/kitchen";

export {
  KITCHEN_ACTIONS,
  KITCHEN_ERROR_REASONS,
  WASTE_POLICIES,
  DEFAULT_KITCHEN_CURRENCY,
  DEFAULT_WASTE_POLICY,
  TXN_KINDS,
  SPLIT_MODES,
  SETTLEMENT_METHODS,
  FLAG_STATES,
  ITEM_STATES,
  DIMENSIONS,
  ITEM_FILTERS,
  USE_SOON_DAYS,
  STOCK_MOVE_KINDS,
  USUALS_DAYS,
  DISH_STATES,
  DISH_SPLIT_MODES,
  MAX_DISH_INGREDIENTS,
} from "@saas/contracts/kitchen";

// Usuals by time of day and by food, and the row's suggestion (Cookpool PN-2).
export type {
  UsualBucket,
  UsualNow,
  UseSuggestionReason,
  UseLadderStep,
  SuggestUsual,
  SuggestUseInput,
  UseSuggestion,
  RunningLowInput,
} from "@saas/contracts/kitchen-usuals";

export {
  USUAL_BUCKETS,
  USUAL_BUCKET_LABELS,
  USUAL_BUCKET_HOURS,
  TZ_OFFSET_MIN,
  TZ_OFFSET_MAX,
  USUALS_NOW_DAYS,
  USUAL_NOW_MIN_USES,
  USUAL_STRIP_MIN_USES,
  USE_SUGGESTION_REASONS,
  RUNNING_LOW_PERCENT,
  usualBucketOfHour,
  usualBucketAt,
  isTzOffset,
  suggestUse,
  isRunningLow,
} from "@saas/contracts/kitchen-usuals";

// People across groups (Cookpool CP-9).
export type {
  KitchenGroupRole,
  MyGroupBalance,
  PersonGroupNet,
  PersonBalance,
  CurrencyTotal,
  MyBalancesResponse,
  PersonLine,
  ShortcutVia,
  PersonGroupView,
  PersonViewResponse,
  KitchenMember,
  GroupMembersResponse,
} from "@saas/contracts/kitchen";

export { KITCHEN_GROUP_ROLES } from "@saas/contracts/kitchen";

// Foods and recipes (Cookpool RC-4).
export type {
  FoodDimension,
  KitchenFood,
  FoodMatch,
  FoodsQuery,
  FoodsResponse,
  SetFoodAnswerRequest,
  FoodAnswer,
  SetFoodAnswerResponse,
  AlwaysHaveResponse,
  SetAlwaysHaveRequest,
  RecipeVisibility,
  RecipeKind,
  RecipeUnit,
  RecipeLineInput,
  KitchenRecipeLine,
  RecipeSource,
  RecipeSummary,
  KitchenRecipe,
  RecipeLastCookLine,
  RecipeLastCook,
  RecipeResponse,
  CreateRecipeRequest,
  SaveDishAsRecipeRequest,
  CreateRecipeBody,
  UpdateRecipeRequest,
  CopyRecipeRequest,
  MyRecipesResponse,
  PersonRecipesResponse,
  RecipeLineStatus,
  RecipeMatchItem,
  RecipeLineMatch,
  RecipeMatchSummary,
  UnlinkedItem,
  RecipeMatchQuery,
  RecipeMatchResponse,
  ExploreSource,
  ExploreRecipesQuery,
  ExploreRecipe,
  ExploreRecipesResponse,
  CookNowEntry,
  CookNowResponse,
  ScaledPortions,
  // Guided steps (GC-2).
  StepPhase,
  StepTimeRule,
  StepSense,
  StepHeat,
  KitchenRecipeStep,
  RecipeStepInput,
  RecipeStepWrite,
  LongPrepStep,
  StepTimeAt,
  StepTiming,
  StepLogEntry,
  UpdateStepTimesRequest,
  StepTimesInput,
  // Learned ranges (GC-7).
  LearnedStepRange,
  RecipeQuery,
} from "@saas/contracts/kitchen";

export {
  FOOD_DIMENSIONS,
  DEFAULT_ALWAYS_HAVE,
  RECIPE_VISIBILITIES,
  RECIPE_KINDS,
  RECIPE_UNITS,
  RECIPE_LINE_STATUSES,
  EXPLORE_SOURCES,
  RECIPE_MIN_FACTOR_MILLI,
  RECIPE_MAX_FACTOR_MILLI,
  COOK_NOW_LIMIT,
  foodNameKey,
  foodLookupKeys,
  scaleLine,
  scalePortions,
  factorForMain,
  factorForPortions,
  lineQuantity,
  // Guided steps (GC-2).
  STEP_PHASES,
  STEP_TIME_RULES,
  STEP_SENSES,
  MAX_STEP_SECONDS,
  MAX_STEP_WHISTLES,
  MAX_STEP_CHECKPOINT,
  MAX_STEP_TIP,
  MAX_RECIPE_TOOLS,
  MAX_RECIPE_TOOL,
  LONG_PREP_SECONDS,
  MAX_STEP_LOG,
  stepTimeAt,
  stepTimeMultiplier,
  isLongPrep,
  longPrepOf,
  // Learned ranges (GC-7).
  LEARNED_MIN_SAMPLES,
  LEARNED_MIN_COOKS,
} from "@saas/contracts/kitchen";

// The stock check (Cookpool PN-4).
export type {
  StockMoveVia,
  StockCheckGone,
  StockCheckLevel,
  CheckGroupItemRequest,
  CheckPersonalItemRequest,
  CheckItemResponse,
  KitchenCheckErrorReason,
} from "@saas/contracts/kitchen";

export { STOCK_MOVE_VIAS, STOCK_CHECK_GONE, KITCHEN_CHECK_ERROR_REASONS } from "@saas/contracts/kitchen";

// Timers that find you (Cookpool GC-3).
export type {
  KitchenTimer,
  KitchenTimerErrorReason,
  CreateKitchenTimerRequest,
  KitchenTimerResponse,
  KitchenTimersResponse,
} from "@saas/contracts/kitchen";

export {
  KITCHEN_TIMER_LABEL_MAX,
  KITCHEN_TIMER_BODY_MAX,
  KITCHEN_TIMER_URL_MAX,
  KITCHEN_TIMER_MIN_SECONDS,
  KITCHEN_TIMER_MAX_SECONDS,
  KITCHEN_TIMERS_MAX_ACTIVE,
  KITCHEN_TIMER_DEFAULT_URL,
  KITCHEN_TIMER_DEFAULT_BODY,
  KITCHEN_TIMER_ERROR_REASONS,
  isKitchenTimerUrl,
} from "@saas/contracts/kitchen";

// Restocking and shopping runs (Cookpool PN-3).
export type {
  RestockReason,
  RestockLast,
  RestockLine,
  FinishedRestockLine,
  RunningLowRestockLine,
  UsualRestockLine,
  RestockResponse,
  PurchaseLine,
  CreatePurchaseRequest,
  PurchaseResponse,
  UndoPurchaseResponse,
} from "@saas/contracts/kitchen";

export {
  RESTOCK_FINISHED_DAYS,
  RESTOCK_USUAL_DAYS,
  RESTOCK_USUAL_MIN_TIMES,
  RESTOCK_LOW_PERCENT,
  RESTOCK_MAX_LINES,
  RESTOCK_REASONS,
  PURCHASE_MAX_LINES,
} from "@saas/contracts/kitchen";

// Ask before use (Cookpool PN-8).
export type {
  AskState,
  AskSource,
  AskItem,
  KitchenAsk,
  AskToUseRequest,
  AskResponse,
  ApproveAskRequest,
  ApproveAskResponse,
  AsksResponse,
  AskInboxItem,
  KitchenAskErrorReason,
} from "@saas/contracts/kitchen";

export {
  ASK_STATES,
  ASK_SOURCES,
  ASK_LAPSE_HOURS,
  ASK_LAPSE_MS,
  ASK_MINE_HOURS,
  ASKS_LIST_MAX,
  ASK_ALLOWED_MAX,
  KITCHEN_ASK_PUSH_KIND,
  KITCHEN_ASK_ERROR_REASONS,
  askPushUrl,
} from "@saas/contracts/kitchen";

// Profiles and following (Cookpool CM-2).
export type {
  CommunityProfile,
  MyProfile,
  MyProfileResponse,
  SaveMyProfileRequest,
  HandleAvailabilityResponse,
  FollowState,
  ProfilePrivacy,
  ProfileCounts,
  ProfileRelationship,
  ProfileName,
  PersonProfileResponse,
  ProfileRecipesResponse,
  CommunityPerson,
  PeoplePage,
  PeoplePageQuery,
  FollowResponse,
  RemoveFollowerResponse,
  BlockResponse,
  MuteResponse,
  BlockedPerson,
  BlocksResponse,
  PeopleSearchResponse,
  SuggestedPerson,
  PeopleSuggestionsResponse,
  KitchenCommunityErrorReason,
} from "@saas/contracts/kitchen";

export {
  HANDLE_RE,
  HANDLE_MIN,
  HANDLE_MAX,
  RESERVED_HANDLES,
  RESERVED_HANDLE_PREFIX,
  HANDLE_CHANGE_DAYS,
  normalizeHandle,
  handleProblem,
  PROFILE_PRIVACIES,
  DEFAULT_PROFILE_PRIVACY,
  PROFILE_NAME_MAX,
  PROFILE_ABOUT_MAX,
  FOLLOW_STATES,
  FOLLOWED_BY_MAX,
  COMMUNITY_PAGE_SIZE,
  PEOPLE_SEARCH_MAX,
  SUGGESTIONS_MAX,
  POPULAR_DAYS,
  FOLLOWS_PER_DAY,
  BLOCKS_PER_DAY,
  SEARCHES_PER_MINUTE,
  KITCHEN_COMMUNITY_ERROR_REASONS,
} from "@saas/contracts/kitchen";

// Posts, the feed, Yum, comments, reports and Activity (Cookpool CM-3).
export type {
  PostAudience,
  PostShow,
  PostSizeStat,
  PostStats,
  PostRecipe,
  PostYums,
  PostStepCompare,
  CommunityPost,
  CreatePostRequest,
  UpdatePostRequest,
  PostResponse,
  DeletePostResponse,
  FeedTab,
  FeedQuery,
  FeedResponse,
  ProfilePostsResponse,
  YumResponse,
  PostComment,
  CommentsResponse,
  AddCommentRequest,
  CommentResponse,
  DeleteCommentResponse,
  ReportTargetKind,
  ReportReason,
  CreateReportRequest,
  KitchenReport,
  ReportResponse,
  ActivityKind,
  ActivityActor,
  ActivityItem,
  ActivityResponse,
  MarkActivityReadRequest,
  MarkActivityReadResponse,
  UnreadActivityResponse,
  KitchenPostsErrorReason,
} from "@saas/contracts/kitchen";

export {
  POST_AUDIENCES,
  DEFAULT_POST_AUDIENCE,
  POST_TITLE_MAX,
  POST_CAPTION_MAX,
  POST_UNDO_MINUTES,
  POST_UNDO_MS,
  POST_SHOW_KEYS,
  YUM_NAMES_MAX,
  FEED_TABS,
  FEED_PAGE_SIZE,
  DISCOVER_DAYS,
  DISCOVER_BOOST_HOURS,
  DISCOVER_BOOST_MAX_HOURS,
  discoverBoostMs,
  REPORTS_TO_HIDE,
  COMMENT_BODY_MAX,
  COMMENTS_PER_HOUR,
  COMMENTS_PAGE_SIZE,
  REPORT_TARGET_KINDS,
  REPORT_REASONS,
  REPORT_NOTE_MAX,
  KITCHEN_REPORT_EVENT,
  ACTIVITY_KINDS,
  ACTIVITY_PAGE_SIZE,
  ACTIVITY_ACTORS_MAX,
  ACTIVITY_REQUESTS_MAX,
  YUM_PUSH_EVERY_MS,
  KITCHEN_POSTS_ERROR_REASONS,
} from "@saas/contracts/kitchen";

export { PUSH_ONLY_KINDS, isPushOnlyKind, type PushOnlyKind } from "@saas/contracts/notifications";

// Cooked, then split later, and Home's split reminder (CM-8).
export type {
  SplitDishRequest,
  SplitDishResponse,
  SplitReminderInboxItem,
  SplitReminderDismissResponse,
  SplitSuggestReason,
  KitchenSplitErrorReason,
} from "@saas/contracts/kitchen";

export {
  KITCHEN_DISH_SPLIT_EVENT,
  KITCHEN_SPLIT_ERROR_REASONS,
  SPLIT_REMINDER_DAYS,
  SPLIT_REMINDER_MIN_PORTIONS_HALF,
  SPLIT_REMINDERS_MAX,
  SPLIT_SUGGEST_REASONS,
} from "@saas/contracts/kitchen";

// Cookpool AI (AI-2): the status read, say what you used, the limits and the AI refusal reasons.
export type {
  AiStatus,
  AiFeatureKey,
  AiUsesRequest,
  AiUsesResponse,
  AiUseProposal,
  AiUseFlag,
  AiItemRef,
  KitchenAiErrorReason,
} from "@saas/contracts/kitchen";
export {
  AI_DAILY_ACTIONS,
  AI_DAILY_VOICE_SECONDS,
  AI_USES_TEXT_MAX,
  AI_FEATURE_KEYS,
  AI_USE_FLAGS,
  KITCHEN_AI_ERROR_REASONS,
} from "@saas/contracts/kitchen";
