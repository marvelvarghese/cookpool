// Ask before use in the contract (Cookpool PN-8, cookpool-pantry design §8):
// the states an ask reads as, where it is asked from, its timing, its push,
// its refusal reasons beside the kitchen's, and the shapes of its routes —
// the item's ask fields, the request and answers, and Home's ask rows.

import {
  ASK_LAPSE_HOURS,
  ASK_LAPSE_MS,
  ASK_MINE_HOURS,
  ASK_SOURCES,
  ASK_STATES,
  KITCHEN_ASK_ERROR_REASONS,
  KITCHEN_ASK_PUSH_KIND,
  KITCHEN_CHECK_ERROR_REASONS,
  KITCHEN_ERROR_REASONS,
  askPushUrl,
  type ApproveAskRequest,
  type ApproveAskResponse,
  type AskInboxItem,
  type AskToUseRequest,
  type AsksResponse,
  type InboxResponse,
  type KitchenAsk,
  type KitchenItem,
  type UpdateGroupItemRequest,
} from "@saas/contracts/kitchen";
import { PUSH_TO_SUBJECT_KINDS, isNotificationKind, type PushToSubjectRequest } from "@saas/contracts/notifications";

describe("contracts: ask before use (Cookpool PN-8)", () => {
  it("names the states (lapsed is read-side), the sources, the timing and the reasons, never shadowing the kitchen's", () => {
    expect(ASK_STATES).toEqual(["pending", "approved", "declined", "canceled", "lapsed"]);
    expect(ASK_SOURCES).toEqual(["pantry", "cook"]);
    expect([ASK_LAPSE_HOURS, ASK_LAPSE_MS, ASK_MINE_HOURS]).toEqual([24, 86_400_000, 24]);
    expect(KITCHEN_ASK_ERROR_REASONS).toEqual({ ASK_FIRST: "ask_first", NO_NEED: "no_need", LAPSED: "lapsed", NOT_PENDING: "not_pending" });
    const others: readonly string[] = [...Object.values(KITCHEN_ERROR_REASONS), ...Object.values(KITCHEN_CHECK_ERROR_REASONS)];
    for (const reason of Object.values(KITCHEN_ASK_ERROR_REASONS)) expect(others).not.toContain(reason);
  });

  it("pushes as kitchen.ask, a kind pushed to a subject and never one a preference turns off, opening Home at the card", () => {
    expect(KITCHEN_ASK_PUSH_KIND).toBe("kitchen.ask");
    expect(PUSH_TO_SUBJECT_KINDS as readonly string[]).toContain(KITCHEN_ASK_PUSH_KIND);
    expect(isNotificationKind(KITCHEN_ASK_PUSH_KIND)).toBe(false);
    expect(askPushUrl("ask_1")).toBe("/home?ask=ask_1");
    const push: PushToSubjectRequest = {
      subjectId: "usr_meera",
      message: { kind: "kitchen.ask", title: "Dev asks for 1 pinch of your saffron", body: "For Dev and Anu · ₹12 to you", url: askPushUrl("ask_1"), tag: "ask_1" },
    };
    expect(push.message.kind).toBe(KITCHEN_ASK_PUSH_KIND);
  });

  it("types the setting on an item, the routes' bodies and answers, and Home's ask rows", () => {
    const setting: UpdateGroupItemRequest = { askFirst: true, allowed: ["usr_anu"] };
    const item: Pick<KitchenItem, "askFirst" | "allowed" | "mustAsk" | "answerer"> = { askFirst: true, allowed: ["usr_anu"], mustAsk: true, answerer: "usr_meera" };
    const request: AskToUseRequest = { quantity: 1, measure: "pinch", consumers: ["usr_dev", "usr_anu"], source: "cook" };
    const options: ApproveAskRequest = { alwaysAllow: true, takeWhatsLeft: false };
    const ask = { id: "ask_1", state: "pending", backMinor: 1200 } as KitchenAsk;
    const approved: Pick<ApproveAskResponse, "ask" | "txn"> = { ask: { ...ask, state: "approved" }, txn: null };
    const lists: AsksResponse = { toAnswer: [ask], mine: [] };
    const row: AskInboxItem = { kind: "ask", ask };
    const inbox: Pick<InboxResponse, "asks"> = { asks: [row] };
    expect([setting.askFirst, item.mustAsk, request.source, options.alwaysAllow, approved.ask.state]).toEqual([true, true, "cook", true, "approved"]);
    expect(lists.toAnswer[0]).toBe(inbox.asks![0]!.ask);
  });
});
