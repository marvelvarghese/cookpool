"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { KitchenItem, MyGroupBalance } from "@saas/contracts/kitchen";
import { cn } from "@/lib/cn";
import { isOffline } from "@/lib/connection";
import { useRecentGroupSlugs } from "@/lib/recent-groups";
import { cookSessions, useCookSession } from "@/lib/cook-session-store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { CLOSE_44, KCard, K_BUTTON } from "./kit";
import { MAIN_BUTTON, MainButtonLabel } from "./faces-ui";
import { useBack } from "./back-ui";
import { useProfile } from "./data";
import { useMemberNames, useMyBalances } from "./people-data";
import { useItemsByRef, useMembersOf } from "./pantry-data";
import { itemRefParam } from "./pantry";
import { useCookableItems } from "./dish-maker-data";
import { PantryPanel, SharePicker } from "./dish-maker-ui";
import { JUST_ME, MAX_DISH_INGREDIENTS, dishHref, dishTotals, shareChoice } from "./dish-maker";
import { fromBeforeTerm, recipeSuggestion, shownSuggestions } from "./from-before";
import { useRecipes } from "./from-before-data";
import { SuggestionList, useTypeahead } from "./from-before-ui";
import { useFinishSession, useRecipe, useRecipeMatch } from "./cook-session-data";
import {
  AddItemButton,
  DiscardPromptBody,
  SaveSwitch,
  SessionMeta,
  SessionRow,
  SessionTopBar,
  StepsCard,
  UntickedChoiceBox,
  WhoAteList,
  useNow,
} from "./cook-session-ui";
import {
  FINISH_OFFLINE_TEXT,
  SESSION_PARENT,
  SESSION_PATH,
  addBoughtLine,
  addItemLine,
  blankSession,
  discardPrompt,
  eatenHalf,
  elapsedText,
  factorParam,
  fillFromBefore,
  finishButtonText,
  finishEaters,
  finishPlan,
  includedLines,
  isEmptySession,
  openChoice,
  postLabel,
  postSub,
  postToOf,
  progressText,
  recipeParam,
  refreshTakes,
  saveSwitch,
  scaleChip,
  sessionCurrency,
  sessionDishLines,
  sessionFromRecipe,
  sessionLineView,
  setName,
  setPostTo,
  startingEaters,
  stepEater,
  stepLine,
  stepsTitle,
  takeRefsToRead,
  tickLine,
  toggleStep,
  untickedText,
  type CookSession,
  type FinishOutcome,
  type UntickedChoice,
} from "./cook-session";

/**
 * The cooking session's screen (cookpool-recipes RC-6, design §4.2, the
 * canvas's `LiveCook`) at `/cook/session`: blank, or from a recipe at a
 * factor (`?recipe=rcp_…&f=450`, RC-5's Start cooking). The draft lives on
 * the device (`lib/cook-session-store.ts`), one at a time: opening another
 * recipe while one is open asks "Finish or discard Chicken curry?" first.
 *
 * Every change is the pure draft's (`cook-session.ts`), written back at once,
 * so the session follows you across tabs and survives a reload. The items it
 * takes from are read fresh as you cook (the usable-items list, else each on
 * its own), for what they cost and what is left. Finish asks who ate and
 * posts through the existing writes (`useFinishSession`).
 */
export function CookSessionScreen() {
  const profile = useProfile();
  const params = useSearchParams();
  const recipeId = recipeParam(params?.get("recipe"));
  const f = factorParam(params?.get("f"));
  const meId = profile.data?.id ?? null;
  if (meId) return <SessionGate meId={meId} wanted={recipeId ? { recipeId, f } : null} />;
  if (profile.error) {
    return (
      <KCard className="flex flex-wrap items-center justify-between gap-3 p-5">
        <p className="text-sm text-muted-foreground">Couldn&apos;t load your account. {profile.error.message}</p>
        <Button variant="outline" className={K_BUTTON} onClick={profile.reload}>
          Try again
        </Button>
      </KCard>
    );
  }
  return <SessionSkeleton />;
}

/** One session at a time: resume the one here, start one, or ask first. */
function SessionGate({ meId, wanted }: { meId: string; wanted: { recipeId: string; f: number } | null }) {
  const router = useRouter();
  const session = useCookSession(meId);
  // Finishing or discarding clears the draft on the way out: nothing new starts behind it.
  const [leaving, setLeaving] = React.useState(false);
  const choice = openChoice(session, wanted ? { recipeId: wanted.recipeId } : null);
  const blankStart = choice === "start" && wanted === null && !leaving;
  React.useEffect(() => {
    if (blankStart) cookSessions.write(meId, blankSession(new Date()));
  }, [blankStart, meId]);

  if (leaving) return <SessionSkeleton />;
  if (choice === "ask" && session) {
    return (
      <AskOneAtATime
        session={session}
        onResume={() => router.replace(SESSION_PATH)}
        onDiscard={() => cookSessions.clear(meId)}
      />
    );
  }
  if (choice === "start" && wanted) return <StartFromRecipe meId={meId} recipeId={wanted.recipeId} f={wanted.f} />;
  if (!session || choice === "start") return <SessionSkeleton />;
  return <LiveCook meId={meId} session={session} onLeave={() => setLeaving(true)} />;
}

/** From a recipe: read it and the match at `f`, then the draft is made from them, and the address drops its query. */
function StartFromRecipe({ meId, recipeId, f }: { meId: string; recipeId: string; f: number }) {
  const router = useRouter();
  const recipe = useRecipe(recipeId);
  const match = useRecipeMatch(recipeId, f);
  const made = React.useRef(false);
  React.useEffect(() => {
    if (made.current || !recipe.data || !match.data) return;
    made.current = true;
    cookSessions.write(meId, sessionFromRecipe(recipe.data.recipe, recipe.data.lastCook, match.data, new Date()));
    router.replace(SESSION_PATH);
  }, [meId, recipe.data, match.data, router]);
  const error = recipe.error ?? match.error;
  if (error) {
    return (
      <KCard className="space-y-3 p-5">
        <p className="text-[15px] font-bold">Couldn&apos;t start cooking that recipe.</p>
        <p className="text-sm text-muted-foreground">
          {error.code === "not_found" ? "It isn't one you can see any more." : error.message}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            className={K_BUTTON}
            onClick={() => {
              recipe.reload();
              match.reload();
            }}
          >
            Try again
          </Button>
          <Button variant="ghost" className={K_BUTTON} onClick={() => router.replace(SESSION_PARENT)}>
            Back to Cook
          </Button>
        </div>
      </KCard>
    );
  }
  return <SessionSkeleton />;
}

/** "Finish or discard Chicken curry?": Resume goes to it; Discard and start drops it for the recipe asked for. */
function AskOneAtATime({ session, onResume, onDiscard }: { session: CookSession; onResume: () => void; onDiscard: () => void }) {
  const prompt = discardPrompt(session);
  return (
    <>
      <SessionSkeleton />
      <Sheet open onOpenChange={(open) => (open ? undefined : onResume())}>
        <SheetContent side="bottom" aria-describedby={undefined} className={cn(SHEET, CLOSE_44)}>
          <div aria-hidden className="mx-auto mb-1 h-1.5 w-10 shrink-0 rounded-full bg-border" />
          <SheetTitle className="pr-12 text-[22px] font-extrabold leading-tight">{prompt.title}</SheetTitle>
          <DiscardPromptBody prompt={prompt} onResume={onResume} onDiscard={onDiscard} />
        </SheetContent>
      </Sheet>
    </>
  );
}

function SessionSkeleton() {
  return (
    <div className="space-y-4" aria-hidden>
      <Skeleton className="h-6 w-40" />
      <Skeleton className="h-8 w-56" />
      <Skeleton className="h-72 w-full rounded-[22px]" />
      <Skeleton className="h-14 w-full rounded-2xl" />
    </div>
  );
}

const SHEET = "mx-auto flex max-h-[92dvh] max-w-xl flex-col gap-3 rounded-t-[28px] border-x-0 bg-card px-5 pb-[calc(env(safe-area-inset-bottom)+1.25rem)] pt-2.5 shadow-2xl focus:outline-none";
const NO_GROUPS: readonly MyGroupBalance[] = [];

/** The session itself. */
function LiveCook({ meId, session, onLeave }: { meId: string; session: CookSession; onLeave: () => void }) {
  const router = useRouter();
  const minimize = useBack();
  const now = useNow(1000);
  const balances = useMyBalances();
  const groups = balances.data?.groups ?? NO_GROUPS;
  const recentSlugs = useRecentGroupSlugs();
  const names = useMemberNames();
  const save = React.useCallback((change: (s: CookSession) => CookSession) => cookSessions.update(meId, change), [meId]);

  const [openKey, setOpenKey] = React.useState<string | null>(null);
  const [stepsOpen, setStepsOpen] = React.useState(false);
  const [addOpen, setAddOpen] = React.useState(false);
  const [finishOpen, setFinishOpen] = React.useState(false);
  const [alert, setAlert] = React.useState<string | null>(null);
  const [flagged, setFlagged] = React.useState<string | null>(null);
  const [discarding, setDiscarding] = React.useState(false);
  const addRef = React.useRef<HTMLButtonElement>(null);
  const nameFieldRef = React.useRef<HTMLDivElement>(null);

  // A blank session opened a while ago and never touched starts its clock now.
  React.useEffect(() => {
    if (isEmptySession(session)) save((s) => (isEmptySession(s) ? { ...s, startedAt: new Date().toISOString() } : s));
    // Once, as the screen opens.
  }, []);

  // The items it takes from, as read now: the usable-items list, else each one on its own.
  const cookable = useCookableItems();
  const listed = React.useMemo(() => new Map<string, KitchenItem>((cookable.data ?? []).map((i) => [i.id, i] as const)), [cookable.data]);
  const listedIds = React.useMemo(() => new Set(listed.keys()), [listed]);
  const listReady = cookable.data !== null || cookable.error !== null;
  const toRead = listReady ? takeRefsToRead(session, listedIds) : [];
  const toReadKey = toRead.map(itemRefParam).join(",");
  const refs = React.useMemo(() => toRead, [toReadKey]);
  const read = useItemsByRef(refs);
  const readKey = [...read.entries()].map(([id, item]) => `${id}:${item ? `${item.version}:${item.qtyLeftMilli}` : "x"}`).join(",");
  // What the draft holds of each item: a line picked or added since needs its item too.
  const takesKey = session.lines
    .flatMap((l) => l.takes.map((t) => `${t.itemId}:${t.gone ? "x" : t.item ? `${t.item.version}:${t.item.qtyLeftMilli}` : "?"}`))
    .join(",");
  React.useEffect(() => {
    const fresh = new Map<string, KitchenItem | null>(listed);
    for (const [id, item] of read) if (!fresh.has(id)) fresh.set(id, item);
    if (fresh.size > 0) save((s) => refreshTakes(s, fresh));
    // `read` is a new map each render; the keys say when it, or the draft's items, changed.
  }, [listed, readKey, takesKey, save]);

  const postTo = postToOf(session, groups, recentSlugs);
  const group = postTo === JUST_ME ? null : (groups.find((g) => g.orgId === postTo) ?? null);
  const views = session.lines.map((l) => sessionLineView(l, { meId, names }));
  const chip = scaleChip(session);
  const blank = session.recipeId === null;
  const full = session.lines.length >= MAX_DISH_INGREDIENTS;
  const dishLines = sessionDishLines(session.lines);

  // Blank: the first field is the name, with dishes cooked before under it (cook again).
  const typeahead = useTypeahead(session.name, "session-name-suggestions");
  const before = useRecipes(typeahead.term, blank && (typeahead.open || typeahead.term === ""));
  const freshBefore = !before.isPlaceholderData && typeahead.term === fromBeforeTerm(session.name);
  const suggestions = blank && typeahead.open ? shownSuggestions(before.data, session.name, freshBefore) : [];
  const pickBefore = (index: number) => {
    const picked = suggestions[index];
    if (!picked) return;
    save((s) => fillFromBefore(s, picked, { groups }));
    typeahead.close();
  };

  const point = (key: string | null) => {
    setFlagged(key);
    if (!key) return;
    window.requestAnimationFrame(() =>
      document.getElementById(`session-line-${key.replace(/[^A-Za-z0-9_-]/g, "-")}`)?.scrollIntoView({ block: "center", behavior: "smooth" }),
    );
  };
  const openFinish = () => {
    setFlagged(null);
    // Finish needs signal (design §4.1): offline it says so, and the session stays.
    if (isOffline()) {
      setAlert(FINISH_OFFLINE_TEXT);
      return;
    }
    setAlert(null);
    setFinishOpen(true);
  };
  const finished = (out: FinishOutcome) => {
    if (out.ok) {
      onLeave();
      cookSessions.clear(meId);
      router.push(dishHref(out.dish.id));
      return;
    }
    if (out.kind === "offline") {
      setFinishOpen(false);
      setAlert(out.message);
      return;
    }
    setFinishOpen(false);
    setAlert(out.message);
    point(out.lineKey);
  };
  const discard = () => {
    onLeave();
    cookSessions.clear(meId);
    router.replace(SESSION_PARENT);
  };

  return (
    // As tall as the screen, so Finish sits at the bottom (in thumb reach) however short the list.
    <div className="flex min-h-[calc(100dvh-env(safe-area-inset-top)-8rem)] flex-col gap-3.5 pb-2 min-[900px]:min-h-[calc(100dvh-6rem)]">
      <SessionTopBar elapsed={elapsedText(session.startedAt, now)} onMinimize={minimize} />

      <div className="space-y-2">
        {blank ? (
          <div className="space-y-2">
            <div ref={nameFieldRef}>
              <label htmlFor="session-name" className="sr-only">
                What are you making?
              </label>
              <Input
                id="session-name"
                value={session.name}
                {...typeahead.inputProps({
                  count: suggestions.length,
                  onPick: pickBefore,
                  onChange: (e) => {
                    const name = e.target.value;
                    save((s) => setName(s, name));
                  },
                })}
                maxLength={140}
                placeholder="What are you making?"
                autoComplete="off"
                className="h-[52px] rounded-[14px] bg-card px-3.5 text-[22px] font-extrabold tracking-tight sm:h-[52px] sm:text-[22px]"
              />
            </div>
            <SuggestionList
              id="session-name-suggestions"
              label="Cooked before"
              views={suggestions.map(recipeSuggestion)}
              active={typeahead.active}
              onPick={pickBefore}
              onHighlight={typeahead.highlight}
              fieldRef={nameFieldRef}
            />
          </div>
        ) : (
          <h1 className="text-[26px] font-extrabold leading-tight tracking-tight">{session.name}</h1>
        )}
        <SessionMeta chip={chip} progress={session.lines.length > 0 ? progressText(session) : null} />
      </div>

      {views.length > 0 ? (
        <section aria-label="Ingredients" className="overflow-hidden rounded-[22px] border bg-card">
          <ul>
            {views.map((v, i) => (
              <SessionRow
                key={v.key}
                view={v}
                open={openKey === v.key}
                flagged={flagged === v.key}
                last={i === views.length - 1}
                onTick={() => {
                  setFlagged(null);
                  save((s) => tickLine(s, v.key));
                }}
                onToggle={() => setOpenKey((k) => (k === v.key ? null : v.key))}
                onStep={(d) => {
                  setFlagged(null);
                  save((s) => stepLine(s, v.key, d));
                }}
              />
            ))}
          </ul>
        </section>
      ) : blank ? (
        <p className="px-1 text-sm text-muted-foreground">Name it, pick something you cooked before, or add what goes in.</p>
      ) : null}

      <AddItemButton ref={addRef} expanded={addOpen} onClick={() => setAddOpen(true)} />

      {session.steps.length > 0 ? (
        <StepsCard
          title={stepsTitle(session)}
          steps={session.steps}
          open={stepsOpen}
          onOpen={() => setStepsOpen((o) => !o)}
          onToggle={(i) => save((s) => toggleStep(s, i))}
        />
      ) : null}

      <div className="flex justify-center">
        {discarding ? (
          <div className="flex w-full flex-wrap items-center justify-between gap-2 rounded-2xl border bg-card p-3">
            <span className="text-sm font-semibold">Discard this session? Nothing is posted.</span>
            <span className="flex gap-2">
              <Button variant="outline" className={K_BUTTON} onClick={() => setDiscarding(false)}>
                Keep cooking
              </Button>
              <Button variant="outline" className={cn(K_BUTTON, "text-cp-expired")} onClick={discard}>
                Discard
              </Button>
            </span>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setDiscarding(true)}
            className="min-h-11 rounded-xl px-3 text-sm font-semibold text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Discard session
          </button>
        )}
      </div>

      {/* The one main button, in thumb reach above the tab bar: Finish, with the cost so far. */}
      <div
        data-toast-above=""
        className="sticky bottom-[calc(env(safe-area-inset-bottom)+5.75rem)] z-30 mt-auto space-y-2 pt-1 min-[900px]:bottom-6"
      >
        {alert ? (
          <p role="alert" className="rounded-xl bg-cp-expired-tint p-3 text-sm font-medium text-cp-expired">
            {alert}
          </p>
        ) : null}
        <Button type="button" className={cn(MAIN_BUTTON, "shadow-[0_8px_24px_rgba(23,32,27,0.18)]")} onClick={openFinish}>
          <MainButtonLabel title="Finish" who={finishButtonText(session, group?.name ?? null, group?.currency ?? null)} />
        </Button>
      </div>

      <Sheet open={addOpen} onOpenChange={(open) => {
        setAddOpen(open);
        if (!open) window.requestAnimationFrame(() => addRef.current?.focus());
      }}>
        <SheetContent side="bottom" aria-describedby={undefined} className={cn(PICKER_SHEET, CLOSE_44)}>
          <div aria-hidden className="mx-auto mb-2 h-1.5 w-10 shrink-0 rounded-full bg-border" />
          <SheetTitle className="flex min-h-11 shrink-0 items-center pr-12 text-[22px] font-extrabold">Add an item</SheetTitle>
          <PantryPanel
            variant="sheet"
            idPrefix="session-pantry"
            dishLines={dishLines}
            currency={group?.currency ?? (dishLines.length > 0 ? sessionCurrency(session) : null)}
            dishCurrency={sessionCurrency(session, group?.currency ?? null)}
            full={full}
            meId={meId}
            names={names}
            onAdd={(item) => save((s) => addItemLine(s, item))}
            onAddNew={(line) => save((s) => addBoughtLine(s, line))}
            newKey={() => `new:${session.seq}`}
          />
          <Button type="button" className={cn(K_BUTTON, "mb-[env(safe-area-inset-bottom)] h-12 w-full shrink-0 text-base font-extrabold")} onClick={() => setAddOpen(false)}>
            Done
          </Button>
        </SheetContent>
      </Sheet>

      {finishOpen ? (
        <FinishSheet
          session={session}
          meId={meId}
          groups={groups}
          groupsLoading={balances.loading}
          postTo={postTo}
          onPostTo={(to) => save((s) => setPostTo(s, to))}
          onClose={() => setFinishOpen(false)}
          onPoint={point}
          onDone={finished}
        />
      ) : null}
    </div>
  );
}

const PICKER_SHEET = cn(
  "mx-auto h-[88dvh] max-w-xl gap-0 overflow-hidden rounded-t-[28px] border-x-0 bg-background px-4 pb-3 pt-2.5 shadow-2xl focus:outline-none",
);

/**
 * Finish (design §4.2): the unticked lines (Took them all / Leave them out),
 * who ate (the post-to group's faces, you at 1), where it posts, the save
 * switch, and Post with the total and each person's share.
 */
function FinishSheet({
  session,
  meId,
  groups,
  groupsLoading,
  postTo,
  onPostTo,
  onClose,
  onPoint,
  onDone,
}: {
  session: CookSession;
  meId: string;
  groups: readonly MyGroupBalance[];
  groupsLoading: boolean;
  postTo: string;
  onPostTo: (postTo: string) => void;
  onClose: () => void;
  onPoint: (lineKey: string | null) => void;
  onDone: (out: FinishOutcome) => void;
}) {
  const finish = useFinishSession();
  const [unticked, setUnticked] = React.useState<UntickedChoice>("all");
  const [halves, setHalves] = React.useState<Record<string, number>>(() => startingEaters(meId));
  const [saveOn, setSaveOn] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [problem, setProblem] = React.useState<string | null>(null);

  const shared = postTo !== JUST_ME;
  const group = shared ? (groups.find((g) => g.orgId === postTo) ?? null) : null;
  const members = useMembersOf(shared ? postTo : null);
  const names = useMemberNames(members.data);
  const roster = React.useMemo(() => (members.data ? members.data.map((m) => m.subjectId) : null), [members.data]);
  // Only the group's own people count (the pick may have changed under them).
  const eaten = React.useMemo(() => {
    if (!roster) return halves;
    const keep = new Set([meId, ...roster]);
    return Object.fromEntries(Object.entries(halves).filter(([id]) => keep.has(id)));
  }, [halves, roster, meId]);

  const lines = includedLines(session, unticked);
  const dishLines = sessionDishLines(lines);
  const currency = sessionCurrency(session, group?.currency ?? null);
  const portionsHalf = shared ? Math.max(1, eatenHalf(eaten)) : 2;
  const totals = dishTotals({ lines: dishLines, extrasMinor: 0, portionsHalf, meId, currency });
  const eaters = shared && roster ? finishEaters({ roster, meId, halves: eaten, totalMinor: totals.totalMinor, names }) : null;
  const notTicked = untickedText(session);
  const sw = saveSwitch(session);
  const choice = shareChoice(postTo, groups);
  const waiting = shared && roster === null && !members.error;

  const post = async () => {
    if (busy || waiting) return;
    setProblem(null);
    const planned = finishPlan(session, { unticked, postTo, halves: eaten, roster, meId, save: saveOn && sw !== null }, { groups });
    if (!planned.ok) {
      setProblem(planned.problem.message);
      if (planned.problem.lineKey) {
        onClose();
        onPoint(planned.problem.lineKey);
      }
      return;
    }
    setBusy(true);
    const out = await finish(planned.plan, group?.name ?? null);
    setBusy(false);
    if (!out.ok && out.kind === "offline") {
      setProblem(out.message);
      return;
    }
    onDone(out);
  };

  return (
    <Sheet open onOpenChange={(open) => (open ? undefined : onClose())}>
      <SheetContent side="bottom" aria-describedby={undefined} className={cn(SHEET, CLOSE_44)}>
        <div aria-hidden className="mx-auto mb-1 h-1.5 w-10 shrink-0 rounded-full bg-border" />
        <SheetTitle className="pr-12 text-[22px] font-extrabold">{shared ? "Who ate?" : "Finish"}</SheetTitle>
        <div className="-mx-5 min-h-0 flex-1 space-y-4 overflow-y-auto px-5 pb-1">
          {notTicked ? <UntickedChoiceBox text={notTicked} value={unticked} onChange={setUnticked} /> : null}

          {shared ? (
            members.error ? (
              <KCard className="flex flex-wrap items-center justify-between gap-3 p-4">
                <p className="text-sm text-muted-foreground">Couldn&apos;t load who&apos;s in {group?.name ?? "the group"}. {members.error.message}</p>
                <Button variant="outline" className={K_BUTTON} onClick={members.reload}>
                  Try again
                </Button>
              </KCard>
            ) : (
              <WhoAteList
                rows={eaters?.rows ?? []}
                meId={meId}
                names={names}
                currency={currency}
                loading={eaters === null}
                onStep={(id, d) => setHalves((h) => stepEater(h, id, d))}
              />
            )
          ) : null}

          <SharePicker
            title="Post to"
            groups={groups}
            value={postTo}
            choice={choice}
            currency={dishLines.length > 0 ? sessionCurrency(session) : null}
            loading={groupsLoading}
            onChange={(to) => {
              setProblem(null);
              onPostTo(to);
            }}
          />

          {sw ? <SaveSwitch label={sw.label} on={saveOn} onChange={setSaveOn} /> : null}

          {problem ? (
            <p role="alert" className="rounded-xl bg-cp-expired-tint p-3 text-sm font-medium text-cp-expired">
              {problem}
            </p>
          ) : null}
        </div>
        <Button
          type="button"
          className={cn(MAIN_BUTTON, "shrink-0 bg-[#B4471F] text-white hover:bg-[#9C3C19]")}
          loading={busy}
          disabled={waiting || (shared && members.error !== null)}
          onClick={() => void post()}
        >
          <MainButtonLabel title={postLabel(postTo, group?.name ?? null)} who={postSub(totals)} />
        </Button>
      </SheetContent>
    </Sheet>
  );
}
