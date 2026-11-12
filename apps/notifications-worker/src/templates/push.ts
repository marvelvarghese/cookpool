/**
 * Push messages (Cookpool PW-5): the three kinds as Web Push, from the same
 * templateData their emails are rendered from. One line each, in the app's
 * words (design §4, canvas `AppNotify`):
 *
 *   kitchen.portion_set   "Anu said you had 1 portion of Egg fried rice"
 *   kitchen.dish_posted   "Egg fried rice is ready to claim"
 *   kitchen.paid_you      "Dev paid you ₹400.00 · UPI"
 *
 * and the social kinds (CM-3), which are push only — their email is never
 * sent (PUSH_ONLY_KINDS):
 *
 *   kitchen.followed        "Sam started following you"
 *   kitchen.follow_request  "Priya wants to follow you"
 *   kitchen.commented       "Kabir commented: Roast the spices first…"
 *   kitchen.yum             "Meera said Yum to your Chicken curry"
 *   kitchen.cooked_yours    "Dev cooked your Chicken curry · 1 kg"
 *
 * and Spliteco's (SE-3), titled "Spliteco":
 *
 *   spliteco.reminder     "Anu sent a friendly nudge: ₹620.00 · Goa Trip"
 *   spliteco.paid_you     "Dev paid you ₹400.00 · UPI"
 *   spliteco.expense_for_you  "Anu via Claude added “Sunset cruise” ₹3,200.00 · Goa Trip" (SE-6)
 *
 * The title is the app's name; `url` is the path in the app the email links
 * to (the service worker opens it on its own origin); `tag` is the caller's
 * idempotency key, which names what it is about and for whom, so a repeat
 * replaces the notification shown rather than stacking. The JSON stays well
 * under PUSH_MESSAGE_MAX_BYTES: every field is bounded here.
 */

import { KITCHEN_EMAILS } from "@saas/contracts/kitchen";
import { SPLITECO_EMAILS } from "@saas/contracts/spliteco";
import {
  PUSH_MESSAGE_MAX_BYTES,
  isNotificationKind,
  type NotificationKind,
  type PushMessage,
} from "@saas/contracts/notifications";
import { expenseChangeWords, oneLine, portionsPhrase, str, type TemplateData } from "./index.js";

export const PUSH_TITLE = "Cookpool";
/** Spliteco's kinds are titled with its own name. */
export const SPLITECO_PUSH_TITLE = "Spliteco";

/** Longest body and tag a push carries; the rest is cut with an ellipsis. */
const MAX_BODY = 200;
const MAX_TAG = 200;
/** A comment's push quotes this much of it. */
const COMMENT_EXCERPT_MAX = 40;

function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

/**
 * The path of an app link ("/dishes/dsh_…"), or `fallback` when the link is
 * empty or not http(s). Only the path, query and fragment: the push opens on
 * the app's own origin, whatever host the email's link names.
 */
export function appPath(link: string, fallback = "/home"): string {
  if (!link) return fallback;
  try {
    const url = new URL(link);
    if (url.protocol !== "https:" && url.protocol !== "http:") return fallback;
    const path = `${url.pathname}${url.search}${url.hash}`;
    return path.startsWith("/") && !path.startsWith("//") ? path : fallback;
  } catch {
    return fallback;
  }
}

type PushRenderer = (data: TemplateData) => { body: string; url: string };

const RENDERERS: Record<NotificationKind, PushRenderer> = {
  [KITCHEN_EMAILS.PORTION_SET]: (data) => {
    const actor = oneLine(str(data, "actorName")) || "Someone";
    const dish = oneLine(str(data, "dishName")) || "a dish";
    const portions = oneLine(str(data, "portions"));
    const had = portions ? `${portionsPhrase(portions)} of ${dish}` : `some of ${dish}`;
    return { body: `${actor} said you had ${had}`, url: appPath(str(data, "dishUrl")) };
  },
  [KITCHEN_EMAILS.DISH_POSTED]: (data) => {
    const dish = oneLine(str(data, "dishName")) || "A dish";
    return { body: `${dish} is ready to claim`, url: appPath(str(data, "dishUrl")) };
  },
  [KITCHEN_EMAILS.PAID_YOU]: (data) => {
    const payer = oneLine(str(data, "payerName")) || "Someone";
    const amount = oneLine(str(data, "amount"));
    const method = oneLine(str(data, "method"));
    const paid = amount ? `${payer} paid you ${amount}` : `${payer} paid you`;
    return { body: method ? `${paid} · ${method}` : paid, url: appPath(str(data, "personUrl")) };
  },
  // The social kinds (CM-3): the actor is named by their profile, as kitchen-worker sends it.
  [KITCHEN_EMAILS.FOLLOWED]: (data) => ({
    body: `${oneLine(str(data, "actorName")) || "Someone"} started following you`,
    url: appPath(str(data, "url"), "/community/activity"),
  }),
  [KITCHEN_EMAILS.FOLLOW_REQUEST]: (data) => ({
    body: `${oneLine(str(data, "actorName")) || "Someone"} wants to follow you`,
    url: appPath(str(data, "url"), "/community/activity"),
  }),
  [KITCHEN_EMAILS.COMMENTED]: (data) => {
    const actor = oneLine(str(data, "actorName")) || "Someone";
    const said = clip(oneLine(str(data, "excerpt")), COMMENT_EXCERPT_MAX);
    return { body: said ? `${actor} commented: ${said}` : `${actor} commented on your post`, url: appPath(str(data, "url"), "/community/activity") };
  },
  [KITCHEN_EMAILS.YUM]: (data) => {
    const actor = oneLine(str(data, "actorName")) || "Someone";
    const dish = oneLine(str(data, "postTitle"));
    return { body: dish ? `${actor} said Yum to your ${dish}` : `${actor} said Yum to your post`, url: appPath(str(data, "url"), "/community/activity") };
  },
  [KITCHEN_EMAILS.COOKED_YOURS]: (data) => {
    const actor = oneLine(str(data, "actorName")) || "Someone";
    const recipe = oneLine(str(data, "recipeName")) || "recipe";
    const size = oneLine(str(data, "size"));
    const cooked = `${actor} cooked your ${recipe}`;
    return { body: size ? `${cooked} · ${size}` : cooked, url: appPath(str(data, "url"), "/community/activity") };
  },
  // Spliteco (SE-3): links are Spliteco's own paths.
  [SPLITECO_EMAILS.REMINDER]: (data) => {
    const from = oneLine(str(data, "fromName")) || "Someone";
    const amount = oneLine(str(data, "amount"));
    const group = oneLine(str(data, "groupName"));
    const nudge = amount ? `${from} sent a friendly nudge: ${amount}` : `${from} sent a friendly nudge`;
    return { body: group ? `${nudge} · ${group}` : nudge, url: appPath(str(data, "payUrl"), "/") };
  },
  [SPLITECO_EMAILS.PAID_YOU]: (data) => {
    const payer = oneLine(str(data, "payerName")) || "Someone";
    const amount = oneLine(str(data, "amount"));
    const method = oneLine(str(data, "method"));
    const paid = amount ? `${payer} paid you ${amount}` : `${payer} paid you`;
    return { body: method ? `${paid} · ${method}` : paid, url: appPath(str(data, "personUrl"), "/") };
  },
  [SPLITECO_EMAILS.EXPENSE_FOR_YOU]: (data) => {
    const actor = oneLine(str(data, "actorName")) || "Someone";
    const amount = oneLine(str(data, "amount"));
    const group = oneLine(str(data, "groupName"));
    const did = `${actor} ${expenseChangeWords(data)}${amount ? ` ${amount}` : ""}`;
    // A move already names where it went.
    const where = group && oneLine(str(data, "change")) !== "moved" ? ` · ${group}` : "";
    return { body: `${did}${where}`, url: appPath(str(data, "expenseUrl"), "/") };
  },
};

/** The push for a template, or null when the template is not one of the kinds. */
export function renderPushMessage(templateKey: string, data: TemplateData, tag: string): PushMessage | null {
  if (!isNotificationKind(templateKey)) return null;
  const { body, url } = RENDERERS[templateKey](data);
  const title = templateKey.startsWith("spliteco.") ? SPLITECO_PUSH_TITLE : PUSH_TITLE;
  return boundedMessage({ kind: templateKey, title, body, url, tag });
}

/** A push that tells a person their device gets notifications ("Send me a test"). */
export function testPushMessage(subjectId: string): PushMessage {
  return boundedMessage({
    kind: "test",
    title: PUSH_TITLE,
    body: "Notifications are on. This is how Cookpool will tell you.",
    url: "/you",
    tag: `test:${subjectId}`,
  });
}

function boundedMessage(message: PushMessage): PushMessage {
  const bounded: PushMessage = {
    ...message,
    body: clip(message.body, MAX_BODY),
    url: message.url.length <= 512 ? message.url : "/home",
    tag: clip(message.tag, MAX_TAG),
  };
  // Every field is bounded above; this only guards a future field.
  if (new TextEncoder().encode(JSON.stringify(bounded)).length > PUSH_MESSAGE_MAX_BYTES) {
    return { ...bounded, body: clip(bounded.body, 80) };
  }
  return bounded;
}
