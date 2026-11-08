// The five social pushes (Cookpool CM-3, cookpool-community design §2):
//
//   kitchen.followed        "Sam started following you"
//   kitchen.follow_request  "Priya wants to follow you"
//   kitchen.commented       "Kabir commented: Roast the spices first…"
//   kitchen.yum             "Meera said Yum to your Chicken curry"   (at most once an hour per post)
//   kitchen.cooked_yours    "Dev cooked your Chicken curry · 1 kg"
//
// They take the PREFERENCE path the portion, the dish and the payment take
// (PW-5), not push-to-subject: kitchen-worker enqueues the kind with
// notifications-worker under the system organization, tagged with the
// recipient, and notifications-worker pushes it to a person who turned that
// kind on (opt-in). Their email is never sent: notifications-worker records
// every PUSH_ONLY_KINDS enqueue as suppressed. The recipient's address comes
// from identity only because an enqueue names one; it never reaches a
// response.
//
// Every name in a push is the actor's PROFILE name, never identity's. A
// push is sent only after the write that causes it committed and wrote its
// Activity row (so never to oneself or across a block), through `ctx.defer`:
// it never fails or holds up the write.

import { KITCHEN_EMAILS, type KitchenEmailData } from "@saas/contracts/kitchen";
import type { RequestContext } from "./context.js";
import { SYSTEM_ORG_ID, appLink, mailKey, sendKitchenMail } from "./emails.js";

export type SocialPushKind =
  | typeof KITCHEN_EMAILS.FOLLOWED
  | typeof KITCHEN_EMAILS.FOLLOW_REQUEST
  | typeof KITCHEN_EMAILS.COMMENTED
  | typeof KITCHEN_EMAILS.YUM
  | typeof KITCHEN_EMAILS.COOKED_YOURS;

export interface SocialPush {
  kind: SocialPushKind;
  /** Whom it is for (`usr_…`). */
  to: string;
  /** What the push names: `actorName`, and `postTitle`, `excerpt`, `recipeName`, `size` as the kind needs. */
  data: KitchenEmailData;
  /** An app path ("/p/pst_…"); made absolute with APP_URL. */
  path: string;
  /** What makes it one push: the key is `<kind>:<…these>:<to>`. */
  keyParts: readonly string[];
}

/** Ask notifications-worker for one social push. Never throws; a person identity can't read gets none. */
export async function sendSocialPush(ctx: RequestContext, push: SocialPush): Promise<void> {
  const idempotencyKey = mailKey(push.kind, ...push.keyParts, push.to);
  if (!idempotencyKey) return;
  const people = await ctx.people.users([push.to]);
  const to = people.get(push.to);
  if (!to || !to.email.trim()) return;
  await sendKitchenMail(ctx.env, ctx, {
    orgId: SYSTEM_ORG_ID,
    templateKey: push.kind,
    templateData: { ...push.data, url: appLink(ctx.env, push.path) },
    to,
    idempotencyKey,
  });
}

/** Send it after the response (or before it, with no waitUntil): best-effort. */
export function deferSocialPush(ctx: RequestContext, push: SocialPush | null): Promise<void> {
  if (!push) return Promise.resolve();
  return ctx.defer(() => sendSocialPush(ctx, push));
}
