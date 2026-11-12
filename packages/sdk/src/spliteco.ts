import type {
  SplitecoActivityResponse,
  SplitecoCommentRequest,
  SplitecoCommentResponse,
  SplitecoCreateGroupRequest,
  SplitecoCreateGroupResponse,
  SplitecoDirectGroupResponse,
  SplitecoExpenseRequest,
  SplitecoExpenseResponse,
  SplitecoExport,
  SplitecoFriendResponse,
  SplitecoGroupResponse,
  SplitecoGroupsResponse,
  SplitecoHomeResponse,
  SplitecoInsightsQuery,
  SplitecoInsightsResponse,
  SplitecoGroupSettingsRequest,
  SplitecoGroupSettingsResponse,
  SplitecoMoveRequest,
  SplitecoProfileRequest,
  SplitecoProfileResponse,
  SplitecoReminderRequest,
  SplitecoReminderResponse,
  SplitecoSettlePlanResponse,
  SplitecoSettlementRequest,
  SplitecoSettlementResponse,
  SplitecoWriteResponse,
} from "@saas/contracts/spliteco";

import { decodeError } from "./errors.js";
import type { RequestOptions, Transport } from "./transport.js";

const BASE = "/v1/spliteco";

const seg = (id: string): string => encodeURIComponent(id);

/**
 * Spliteco (cookpool-spliteco SE1): groups, expenses split six ways, and
 * balances on the ledger Cookpool shares, under `/v1/spliteco/…`. Every write
 * takes an `idempotencyKey` (pass one per user action, so a retry cannot post
 * twice). Edit, delete, restore and move answer the version now in effect.
 */
export class SplitecoClient {
  constructor(private readonly transport: Transport) {}

  /** GET /v1/spliteco/me/home — totals per currency and everyone you have money with. */
  home(opts: RequestOptions = {}): Promise<SplitecoHomeResponse> {
    return this.transport.request<SplitecoHomeResponse>({ method: "GET", path: `${BASE}/me/home` }, opts);
  }

  /** GET /v1/spliteco/me/groups — every group you're in (kitchens too) and your friends. */
  groups(opts: RequestOptions = {}): Promise<SplitecoGroupsResponse> {
    return this.transport.request<SplitecoGroupsResponse>({ method: "GET", path: `${BASE}/me/groups` }, opts);
  }

  /** POST /v1/spliteco/groups — make a group in Spliteco (Cookpool never sees it). */
  createGroup(body: SplitecoCreateGroupRequest, opts: RequestOptions = {}): Promise<SplitecoCreateGroupResponse> {
    return this.transport.request<SplitecoCreateGroupResponse>({ method: "POST", path: `${BASE}/groups`, body }, opts);
  }

  /** GET /v1/spliteco/groups/{org} — balances, the simplified plan and the expenses. */
  group(groupId: string, opts: RequestOptions = {}): Promise<SplitecoGroupResponse> {
    return this.transport.request<SplitecoGroupResponse>({ method: "GET", path: `${BASE}/groups/${seg(groupId)}` }, opts);
  }

  /** GET /v1/spliteco/me/friends/{usr} — the balance across every group you share, and the shared expenses. */
  friend(subjectId: string, opts: RequestOptions = {}): Promise<SplitecoFriendResponse> {
    return this.transport.request<SplitecoFriendResponse>(
      { method: "GET", path: `${BASE}/me/friends/${seg(subjectId)}` },
      opts,
    );
  }

  /**
   * POST /v1/spliteco/me/friends/{usr}/direct — the two-person group for
   * expenses outside any group, made on first use. Only someone you share a
   * group with.
   */
  directGroup(subjectId: string, opts: RequestOptions = {}): Promise<SplitecoDirectGroupResponse> {
    return this.transport.request<SplitecoDirectGroupResponse>(
      { method: "POST", path: `${BASE}/me/friends/${seg(subjectId)}/direct` },
      opts,
    );
  }

  /** POST /v1/spliteco/groups/{org}/expenses — any of the six splits, one or several payers. */
  createExpense(groupId: string, body: SplitecoExpenseRequest, opts: RequestOptions = {}): Promise<SplitecoWriteResponse> {
    return this.transport.request<SplitecoWriteResponse>(
      { method: "POST", path: `${BASE}/groups/${seg(groupId)}/expenses`, body },
      opts,
    );
  }

  /** GET /v1/spliteco/expenses/{txn} — the breakdown, items, adjustments, comments and history. */
  expense(txnId: string, opts: RequestOptions = {}): Promise<SplitecoExpenseResponse> {
    return this.transport.request<SplitecoExpenseResponse>({ method: "GET", path: `${BASE}/expenses/${seg(txnId)}` }, opts);
  }

  /** PUT /v1/spliteco/expenses/{txn} — edit: the old version is reversed and the new one posted. */
  editExpense(txnId: string, body: SplitecoExpenseRequest, opts: RequestOptions = {}): Promise<SplitecoWriteResponse> {
    return this.transport.request<SplitecoWriteResponse>(
      { method: "PUT", path: `${BASE}/expenses/${seg(txnId)}`, body },
      opts,
    );
  }

  /** DELETE /v1/spliteco/expenses/{txn} — reversed, and restorable for 30 days. */
  deleteExpense(txnId: string, opts: RequestOptions = {}): Promise<SplitecoWriteResponse> {
    return this.transport.request<SplitecoWriteResponse>({ method: "DELETE", path: `${BASE}/expenses/${seg(txnId)}` }, opts);
  }

  /** POST /v1/spliteco/expenses/{txn}/restore — re-post a deleted expense, within 30 days. */
  restoreExpense(txnId: string, opts: RequestOptions = {}): Promise<SplitecoWriteResponse> {
    return this.transport.request<SplitecoWriteResponse>(
      { method: "POST", path: `${BASE}/expenses/${seg(txnId)}/restore` },
      opts,
    );
  }

  /** POST /v1/spliteco/expenses/{txn}/move — into another group where everyone on it is a member. */
  moveExpense(txnId: string, body: SplitecoMoveRequest, opts: RequestOptions = {}): Promise<SplitecoWriteResponse> {
    return this.transport.request<SplitecoWriteResponse>(
      { method: "POST", path: `${BASE}/expenses/${seg(txnId)}/move`, body },
      opts,
    );
  }

  /** POST /v1/spliteco/expenses/{txn}/comments. */
  addComment(txnId: string, body: SplitecoCommentRequest, opts: RequestOptions = {}): Promise<SplitecoCommentResponse> {
    return this.transport.request<SplitecoCommentResponse>(
      { method: "POST", path: `${BASE}/expenses/${seg(txnId)}/comments`, body },
      opts,
    );
  }

  /** GET /v1/spliteco/groups/{org}/activity — every change in the group, newest first. */
  groupActivity(groupId: string, opts: RequestOptions = {}): Promise<SplitecoActivityResponse> {
    return this.transport.request<SplitecoActivityResponse>(
      { method: "GET", path: `${BASE}/groups/${seg(groupId)}/activity` },
      opts,
    );
  }

  /** GET /v1/spliteco/me/activity — every change across your groups, newest first. */
  activity(opts: RequestOptions = {}): Promise<SplitecoActivityResponse> {
    return this.transport.request<SplitecoActivityResponse>({ method: "GET", path: `${BASE}/me/activity` }, opts);
  }

  /** GET /v1/spliteco/insights?groupId&month&currency — by category, by payer and by month. */
  insights(query: SplitecoInsightsQuery = {}, opts: RequestOptions = {}): Promise<SplitecoInsightsResponse> {
    return this.transport.request<SplitecoInsightsResponse>(
      {
        method: "GET",
        path: `${BASE}/insights`,
        query: { groupId: query.groupId, month: query.month, currency: query.currency },
      },
      opts,
    );
  }

  /** GET /v1/spliteco/groups/{org}/export.json — everything in the group, as data. */
  exportJson(groupId: string, opts: RequestOptions = {}): Promise<SplitecoExport> {
    return this.transport.request<SplitecoExport>(
      { method: "GET", path: `${BASE}/groups/${seg(groupId)}/export.json` },
      opts,
    );
  }

  // ── SE2: settle up and reminders ──

  /**
   * POST /v1/spliteco/groups/{org}/settlements — record that you paid someone,
   * only once you confirm it ("I paid"). Never more than you owe them.
   */
  settle(groupId: string, body: SplitecoSettlementRequest, opts: RequestOptions = {}): Promise<SplitecoSettlementResponse> {
    return this.transport.request<SplitecoSettlementResponse>(
      { method: "POST", path: `${BASE}/groups/${seg(groupId)}/settlements`, body },
      opts,
    );
  }

  /** POST /v1/spliteco/settlements/{txn}/not-received — the person paid says it never came; it is reversed. */
  notReceived(txnId: string, opts: RequestOptions = {}): Promise<SplitecoSettlementResponse> {
    return this.transport.request<SplitecoSettlementResponse>(
      { method: "POST", path: `${BASE}/settlements/${seg(txnId)}/not-received` },
      opts,
    );
  }

  /** GET /v1/spliteco/groups/{org}/settle-plan — the plan balance by balance, and what you owe each person. */
  settlePlan(groupId: string, opts: RequestOptions = {}): Promise<SplitecoSettlePlanResponse> {
    return this.transport.request<SplitecoSettlePlanResponse>(
      { method: "GET", path: `${BASE}/groups/${seg(groupId)}/settle-plan` },
      opts,
    );
  }

  /** PUT /v1/spliteco/groups/{org}/settings — simplify debts on or off. */
  setGroupSettings(groupId: string, body: SplitecoGroupSettingsRequest, opts: RequestOptions = {}): Promise<SplitecoGroupSettingsResponse> {
    return this.transport.request<SplitecoGroupSettingsResponse>(
      { method: "PUT", path: `${BASE}/groups/${seg(groupId)}/settings`, body },
      opts,
    );
  }

  /** POST /v1/spliteco/reminders — nudge someone who owes you; at most once a day per person (409 otherwise). */
  remind(body: SplitecoReminderRequest, opts: RequestOptions = {}): Promise<SplitecoReminderResponse> {
    return this.transport.request<SplitecoReminderResponse>({ method: "POST", path: `${BASE}/reminders`, body }, opts);
  }

  /** GET /v1/spliteco/me/profile — your UPI ID and default currency. */
  profile(opts: RequestOptions = {}): Promise<SplitecoProfileResponse> {
    return this.transport.request<SplitecoProfileResponse>({ method: "GET", path: `${BASE}/me/profile` }, opts);
  }

  /** PUT /v1/spliteco/me/profile — set your UPI ID (null removes it). */
  setProfile(body: SplitecoProfileRequest, opts: RequestOptions = {}): Promise<SplitecoProfileResponse> {
    return this.transport.request<SplitecoProfileResponse>({ method: "PUT", path: `${BASE}/me/profile`, body }, opts);
  }

  /**
   * GET /v1/spliteco/groups/{org}/export.csv — one row per expense, a column
   * per person. The CSV text, not an envelope.
   */
  async exportCsv(groupId: string, opts: RequestOptions = {}): Promise<string> {
    const url = `${this.transport.baseUrl}${BASE}/groups/${seg(groupId)}/export.csv`;
    const headers = new Headers({ ...this.transport.defaultHeaders, accept: "text/csv" });
    const auth = this.transport.auth;
    if (auth?.kind === "bearer") headers.set("authorization", `Bearer ${auth.token}`);
    else if (auth?.kind === "session") headers.set("cookie", auth.cookie);
    const requestId = opts.requestId ?? `req_${crypto.randomUUID().replace(/-/g, "")}`;
    headers.set("x-request-id", requestId);
    for (const [k, v] of Object.entries(opts.headers ?? {})) headers.set(k, v);
    const init: RequestInit = { method: "GET", headers };
    if (opts.signal !== undefined) init.signal = opts.signal;
    const response = await this.transport.fetchImpl(url, init);
    if (!response.ok) throw await decodeError(response, requestId);
    return response.text();
  }
}
