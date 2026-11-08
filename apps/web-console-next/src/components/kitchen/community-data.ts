"use client";

import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  BlocksResponse,
  FollowResponse,
  FollowState,
  HandleAvailabilityResponse,
  MyProfileResponse,
  PeoplePage,
  PeopleSearchResponse,
  PeopleSuggestionsResponse,
  PersonProfileResponse,
  ProfilePrivacy,
  ProfileRecipesResponse,
  SaveMyProfileRequest,
} from "@saas/contracts/kitchen";
import { wrap, type ApiErrorBody, type ApiResult } from "@/lib/api";
import { applyPatches, trackWrite } from "@/lib/optimistic";
import { afterWrites, qk, useApiQuery, type AsyncState } from "@/lib/query";
import { refuseIfOffline } from "@/lib/connection";
import { useSession } from "@/lib/session";
import { useToast } from "@/components/ui/toast";
import { beginWrite, queryCacheOf } from "./optimistic-data";
import { refusedToast, type UndoResult } from "./undo";
import { useUndoToast } from "./undo-toast";
import { atHandle, followTarget, followToastTitle, profileFirstName } from "./community";
import { blockPatches, followPatches, followerRemovedPatches, mutePatches, requestAnsweredPatches, unblockPatches } from "./community-people";

/**
 * Profiles and following in the app (cookpool-community CM-5): the reads and
 * writes behind HandleSetup, a profile, people search, the You tab's counts
 * and requests, and blocked people, over CM-2's routes.
 *
 * Follow, unfollow, mute, block and unblock are SM-5's instant writes: the
 * screen changes first, the toast offers Undo, a refusal puts it back and
 * says why. Each refreshes every Community read once it lands.
 */

type QC = ReturnType<typeof useQueryClient>;

async function unwrap<T>(result: Promise<ApiResult<T>>): Promise<T> {
  const r = await result;
  if (!r.ok) throw r.error;
  return r.data;
}

/** A read whose 404 is an answer (no such handle, or a block between you): not retried. */
function useFoundQuery<T>(key: readonly unknown[], load: () => Promise<ApiResult<T>>, enabled: boolean): AsyncState<T> {
  const qc = useQueryClient();
  const q = useQuery<T, ApiErrorBody>({
    queryKey: key,
    queryFn: afterWrites(qc, key, () => unwrap(load())),
    enabled,
    retry: (count, error) => error.code !== "not_found" && error.code !== "forbidden" && count < 1,
  });
  return {
    data: q.data ?? null,
    loading: q.isLoading,
    error: q.error ? { code: q.error.code ?? "error", message: q.error.message ?? "Request failed" } : null,
    reload: () => void q.refetch(),
  };
}

/**
 * Read every Community read again. A follow keeps search and suggestions on
 * screen as they are (the server would drop whom you now follow from the
 * suggestions, taking the row — and its Following — away under your finger):
 * they are only marked stale, for the next visit.
 */
function refreshCommunity(qc: QC, opts: { keepLists?: boolean } = {}): void {
  const kept = (key: readonly unknown[]) => opts.keepLists === true && (key[1] === "search" || key[1] === "suggestions");
  void qc.invalidateQueries({ queryKey: qk.kitchenCommunity(), predicate: (q) => !kept(q.queryKey) });
  if (opts.keepLists) void qc.invalidateQueries({ queryKey: qk.kitchenCommunity(), predicate: (q) => kept(q.queryKey), refetchType: "none" });
}

/** A refusal's words: "Make your public profile first" when you have none (`no_profile`), else the server's. */
function refusalWhy(error: ApiErrorBody): string {
  if (error.reason === "no_profile") return "Make your public profile first";
  if (error.reason === "follow_limit") return "That's a lot of follows today. Try again tomorrow.";
  if (error.reason === "block_limit") return "That's a lot of blocks today. Try again tomorrow.";
  return error.message;
}

// ── Reads ─────────────────────────────────────────────────────────

/** Your public profile (`GET /v1/kitchen/me/profile`): null until HandleSetup saves one. */
export function useMyCommunityProfile(opts?: { enabled?: boolean }): AsyncState<MyProfileResponse> {
  const { client } = useSession();
  return useApiQuery(qk.kitchenMyProfile(), () => wrap(() => client.kitchen.myProfile()), opts);
}

/** Is this handle free (`GET /v1/kitchen/handles/{handle}`)? Your own counts as free to you. */
export function useHandleAvailability(handle: string, enabled: boolean): AsyncState<HandleAvailabilityResponse> {
  const { client } = useSession();
  return useApiQuery(qk.kitchenHandle(handle), () => wrap(() => client.kitchen.handleAvailable(handle)), { enabled: enabled && !!handle });
}

/** Someone's profile (`GET /v1/kitchen/profiles/{handle}`): 404 for no such handle, or a block either way. */
export function usePersonProfile(handle: string | null): AsyncState<PersonProfileResponse> {
  const { client } = useSession();
  return useFoundQuery(qk.kitchenPersonProfile(handle ?? ""), () => wrap(() => client.kitchen.profile(handle ?? "")), !!handle);
}

/** Their public recipes (`GET …/profiles/{handle}/recipes`), when `canSee`. The first page (30). */
export function useProfileRecipes(handle: string, enabled: boolean): AsyncState<ProfileRecipesResponse> {
  const { client } = useSession();
  return useFoundQuery(qk.kitchenProfileRecipes(handle), () => wrap(() => client.kitchen.profileRecipes(handle)), enabled && !!handle);
}

/** Their followers or whom they follow, when `canSee`. The first page (30). */
export function useProfilePeople(handle: string, list: "followers" | "following", enabled: boolean): AsyncState<PeoplePage> {
  const { client } = useSession();
  return useFoundQuery(
    qk.kitchenProfilePeople(handle, list),
    () => wrap(() => (list === "followers" ? client.kitchen.followers(handle) : client.kitchen.following(handle))),
    enabled && !!handle,
  );
}

/** The follow requests waiting on you (a private profile's). The first page (30). */
export function useFollowRequests(enabled: boolean): AsyncState<PeoplePage> {
  const { client } = useSession();
  return useApiQuery(qk.kitchenFollowRequests(), () => wrap(() => client.kitchen.followRequests()), { enabled });
}

/** Whom you blocked, newest first. */
export function useBlocks(): AsyncState<BlocksResponse> {
  const { client } = useSession();
  return useApiQuery(qk.kitchenBlocks(), () => wrap(() => client.kitchen.blocks()));
}

/** People search: the last results stay while the next are read. Nothing is asked for "". */
export function usePeopleSearch(q: string): AsyncState<PeopleSearchResponse> {
  const { client } = useSession();
  return useApiQuery(qk.kitchenPeopleSearch(q), () => wrap(() => client.kitchen.searchPeople(q)), { enabled: !!q, keepPrevious: true });
}

/** From your groups, from recipes, popular. */
export function usePeopleSuggestions(enabled: boolean = true): AsyncState<PeopleSuggestionsResponse> {
  const { client } = useSession();
  return useApiQuery(qk.kitchenPeopleSuggestions(), () => wrap(() => client.kitchen.peopleSuggestions()), { enabled });
}

// ── Your profile ──────────────────────────────────────────────────

/** Save HandleSetup (`PUT /v1/kitchen/me/profile`): the answer goes in place, then every Community read again. */
export function useSaveMyProfile() {
  const { client } = useSession();
  const qc = useQueryClient();
  return React.useCallback(
    async (body: SaveMyProfileRequest): Promise<ApiResult<MyProfileResponse>> => {
      const r = await trackWrite(qc, wrap(() => client.kitchen.saveMyProfile(body)));
      if (r.ok) {
        qc.setQueryData(qk.kitchenMyProfile(), r.data);
        refreshCommunity(qc);
      }
      return r;
    },
    [client, qc],
  );
}

// ── Following ─────────────────────────────────────────────────────

export interface FollowInput {
  handle: string;
  userId: string;
  name: string;
  privacy: ProfilePrivacy;
  /** Your follow of them now. */
  from: FollowState;
}

/**
 * Follow, ask to follow, unfollow or take a request back — whichever a tap
 * means from `from` (`followTarget`). At once with Undo, which sends the
 * other way (re-following a private profile asks again).
 */
export function useFollow() {
  const { client } = useSession();
  const qc = useQueryClient();
  const offer = useUndoToast();
  return React.useCallback(
    (input: FollowInput): Promise<ApiResult<FollowResponse>> => {
      const { handle, userId, from } = input;
      const to = followTarget(from, input.privacy);
      const first = profileFirstName(input);
      const send = (state: FollowState) =>
        wrap(() => (state === "none" ? client.kitchen.unfollow(handle) : client.kitchen.follow(handle)));
      const write = beginWrite(qc, followPatches(handle, userId, to));
      const sent = write.track(send(to));
      let undone = false;
      const toast = offer({
        title: followToastTitle(from, to, first),
        description: atHandle(handle),
        undo: async (): Promise<UndoResult> => {
          const r = await sent;
          if (!r.ok) return { ok: true };
          const u = await trackWrite(qc, send(from === "none" ? "none" : "accepted"));
          if (u.ok) applyPatches(queryCacheOf(qc), followPatches(handle, userId, u.data.state));
          refreshCommunity(qc, { keepLists: true });
          return u.ok ? { ok: true } : { ok: false, kind: "error", title: "Couldn't undo it", description: u.error.message };
        },
        restore: () => {
          undone = true;
          write.restore(followPatches(handle, userId, from));
        },
      });
      return sent.then((r) => {
        if (!r.ok) {
          write.rollback();
          toast.refuse(refusedToast(to === "none" ? `Couldn't unfollow ${first}` : `Couldn't follow ${first}`, refusalWhy(r.error)));
          return r;
        }
        // The server decides: a profile that turned private meanwhile answers "requested".
        if (!undone && r.data.state !== to) {
          applyPatches(queryCacheOf(qc), followPatches(handle, userId, r.data.state));
          toast.update({ title: followToastTitle(from, r.data.state, first) });
        }
        refreshCommunity(qc, { keepLists: true });
        return r;
      });
    },
    [client, qc, offer],
  );
}

/** Accept (with Undo: they stop following you) or decline (no Undo: they can ask again) a follow request. */
export function useAnswerRequest() {
  const { client } = useSession();
  const qc = useQueryClient();
  const offer = useUndoToast();
  const { toast } = useToast();
  return React.useCallback(
    (person: { userId: string; name: string; handle: string }, accept: boolean): void => {
      const first = profileFirstName(person);
      const write = beginWrite(qc, requestAnsweredPatches(person.userId));
      const sent = write.track(wrap(() => (accept ? client.kitchen.acceptFollow(person.userId) : client.kitchen.declineFollow(person.userId))));
      if (!accept) {
        void sent.then((r) => {
          if (!r.ok) {
            write.rollback();
            toast(refusedToast(`Couldn't decline ${first}`, r.error.message));
          } else toast({ kind: "success", title: `Declined ${first}`, description: "They can ask again" });
          refreshCommunity(qc);
        });
        return;
      }
      const handle = offer({
        title: `${first} follows you now`,
        description: atHandle(person.handle),
        undo: async (): Promise<UndoResult> => {
          const r = await sent;
          if (!r.ok) return { ok: true };
          const u = await trackWrite(qc, wrap(() => client.kitchen.removeFollower(person.userId)));
          refreshCommunity(qc);
          return u.ok ? { ok: true, description: `${first} no longer follows you` } : { ok: false, kind: "error", title: "Couldn't undo it", description: u.error.message };
        },
      });
      void sent.then((r) => {
        if (!r.ok) {
          write.rollback();
          handle.refuse(refusedToast(`Couldn't accept ${first}`, r.error.message));
        }
        refreshCommunity(qc);
      });
    },
    [client, qc, offer, toast],
  );
}

/** Remove a follower: off your list at once. No Undo — only they can follow you again. */
export function useRemoveFollower() {
  const { client } = useSession();
  const qc = useQueryClient();
  const { toast } = useToast();
  return React.useCallback(
    (person: { userId: string; name: string; handle: string }): void => {
      const first = profileFirstName(person);
      const write = beginWrite(qc, followerRemovedPatches(person.userId));
      void write.track(wrap(() => client.kitchen.removeFollower(person.userId))).then((r) => {
        if (!r.ok) {
          write.rollback();
          toast(refusedToast(`Couldn't remove ${first}`, r.error.message));
        } else toast({ kind: "success", title: `Removed ${first}`, description: "They aren't told, and can follow again" });
        refreshCommunity(qc);
      });
    },
    [client, qc, toast],
  );
}

// ── Mutes and blocks ──────────────────────────────────────────────

/** Mute or unmute their posts (your Following feed only), with Undo. */
export function useMute() {
  const { client } = useSession();
  const qc = useQueryClient();
  const offer = useUndoToast();
  return React.useCallback(
    (person: { userId: string; handle: string; name: string }, mute: boolean): void => {
      const first = profileFirstName(person);
      const send = (on: boolean) => wrap(() => (on ? client.kitchen.mute(person.userId) : client.kitchen.unmute(person.userId)));
      const write = beginWrite(qc, mutePatches(person.handle, mute));
      const sent = write.track(send(mute));
      const handle = offer({
        title: mute ? `Muted ${first}'s posts` : `Unmuted ${first}'s posts`,
        description: mute ? "They leave your Following feed. They aren't told." : atHandle(person.handle),
        undo: async (): Promise<UndoResult> => {
          const r = await sent;
          if (!r.ok) return { ok: true };
          const u = await trackWrite(qc, send(!mute));
          refreshCommunity(qc);
          return u.ok ? { ok: true } : { ok: false, kind: "error", title: "Couldn't undo it", description: u.error.message };
        },
        restore: () => write.restore(mutePatches(person.handle, !mute)),
      });
      void sent.then((r) => {
        if (!r.ok) {
          write.rollback();
          handle.refuse(refusedToast(`Couldn't change that`, r.error.message));
        }
        refreshCommunity(qc);
      });
    },
    [client, qc, offer],
  );
}

/**
 * Block (`POST …/me/blocks/{usr}`) or unblock someone, at once with Undo.
 * `onDone` hears whether the write stands (false: refused, or undone), so a
 * profile can show its blocked state. Unblocking doesn't bring follows back.
 */
export function useBlock() {
  const { client } = useSession();
  const qc = useQueryClient();
  const offer = useUndoToast();
  return React.useCallback(
    (person: { userId: string; handle: string | null; name: string | null }, block: boolean, onDone?: (stands: boolean) => void): void => {
      if (refuseIfOffline()) return;
      const who = person.handle ? atHandle(person.handle) : (person.name ?? "them");
      const send = (on: boolean) => wrap(() => (on ? client.kitchen.block(person.userId) : client.kitchen.unblock(person.userId)));
      const write = beginWrite(qc, block ? blockPatches(person.userId) : unblockPatches(person.userId));
      const sent = write.track(send(block));
      let undone = false;
      const handle = offer({
        title: block ? `Blocked ${who}` : `Unblocked ${who}`,
        description: block ? "They aren't told" : "Follows don't come back",
        undo: async (): Promise<UndoResult> => {
          const r = await sent;
          if (!r.ok) return { ok: true };
          const u = await trackWrite(qc, send(!block));
          refreshCommunity(qc);
          return u.ok ? { ok: true } : { ok: false, kind: "error", title: "Couldn't undo it", description: u.error.message };
        },
        restore: () => {
          undone = true;
          write.restore();
          onDone?.(false);
        },
      });
      void sent.then((r) => {
        if (!r.ok) {
          write.rollback();
          handle.refuse(refusedToast(block ? `Couldn't block ${who}` : `Couldn't unblock ${who}`, refusalWhy(r.error)));
          onDone?.(false);
        } else if (!undone) onDone?.(true);
        refreshCommunity(qc);
      });
    },
    [client, qc, offer],
  );
}
