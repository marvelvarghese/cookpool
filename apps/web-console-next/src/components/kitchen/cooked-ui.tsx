"use client";

import * as React from "react";
import Link from "./link";
import { Check, ChevronRight, Megaphone, ReceiptText } from "lucide-react";
import type { KitchenDish, MyGroupBalance } from "@saas/contracts/kitchen";
import { cn } from "@/lib/cn";
import { useRecentGroupSlugs } from "@/lib/recent-groups";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { CLOSE_44, KCard, K_BUTTON } from "./kit";
import { MAIN_BUTTON, MainButtonLabel } from "./faces-ui";
import { useMemberNames, useMyBalances } from "./people-data";
import { useMembersOf } from "./pantry-data";
import { SharePicker } from "./dish-maker-ui";
import { shareChoice } from "./dish-maker";
import { mainAmountMilli, mainLineOf } from "./recipes";
import { useRecipe } from "./recipes-data";
import { postHref } from "./community";
import { SESSION_SHEET } from "./cook-finish-sheet";
import { WhoAteList } from "./cook-session-ui";
import { useCookedSeed, useSplitDish } from "./cooked-data";
import {
  COOKED_TITLE,
  NEXT_HEADING,
  cookedActions,
  cookedDoneLabel,
  cookedView,
  splitButton,
  splitEaters,
  splitGroups,
  splitLeftText,
  splitStartingHalves,
  suggestSplitGroup,
  type CookedAction,
} from "./cooked";

/**
 * Cooked! (cookpool-community CM-9, the canvas's `CookDone`): where both
 * cook-session paths end in the new frame — the dish page at `?cooked=1`.
 * ✓, "Cooked!", "Chicken curry · 450 g · 48 min", the tiles, the group-items
 * note, then WHAT NEXT: Post to Community and Split with a group, each with
 * its done state, and "Not now · done" / "Done".
 */

const FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export function CookedScreen({
  dish,
  postId,
  groupName,
  groupNames,
  onPost,
  onSplit,
  onDone,
}: {
  dish: KitchenDish;
  postId: string | null;
  groupName: string | null;
  groupNames: ReadonlyMap<string, string>;
  onPost: () => void;
  onSplit: () => void;
  onDone: () => void;
}) {
  const seed = useCookedSeed(dish.id);
  const recipe = useRecipe(dish.recipeId ?? null);
  const r = recipe.data?.recipe ?? null;
  const main = r && dish.recipeFactorMilli ? mainLineOf(r) : null;
  const view = cookedView(dish, {
    main: main && dish.recipeFactorMilli ? { qtyMilli: mainAmountMilli(main, dish.recipeFactorMilli), unit: main.unit } : null,
    seed,
    groupNames,
  });
  const actions = cookedActions({ postId, orgId: dish.orgId, groupName });

  return (
    <div className="flex min-h-[calc(100dvh-env(safe-area-inset-top)-8rem)] flex-col gap-3.5 pb-2 min-[900px]:mx-auto min-[900px]:max-w-xl">
      <span aria-hidden className="mt-2 grid h-[72px] w-[72px] place-items-center self-center rounded-full bg-cp-herb-tint text-primary">
        <Check className="h-9 w-9" strokeWidth={2.6} />
      </span>
      <div className="flex flex-col gap-1 text-center">
        <h1 className="text-[28px] font-extrabold tracking-[-0.02em]">{COOKED_TITLE}</h1>
        <p className="break-words text-base font-bold text-[#3F4842] tabular-nums">{view.subtitle}</p>
      </div>
      <dl className={cn("grid gap-1.5", view.tiles.length === 3 ? "grid-cols-3" : "grid-cols-2")}>
        {view.tiles.map((t) => (
          <div key={t.label} className="flex flex-col-reverse items-center rounded-[14px] border bg-card p-2">
            <dt className="text-[11px] font-bold text-muted-foreground">{t.label}</dt>
            <dd className="text-[17px] font-extrabold tabular-nums">{t.value}</dd>
          </div>
        ))}
      </dl>
      {view.note ? <p className="text-center text-[13px] font-semibold text-muted-foreground">{view.note}</p> : null}

      <h2 className="mt-1.5 text-xs font-extrabold uppercase tracking-[0.06em] text-[#3F4842]">{NEXT_HEADING}</h2>
      <NextActionList actions={actions} postId={postId} dishId={dish.id} onPost={onPost} onSplit={onSplit} />

      {/* The one main button, held above the tab bar: leave Cooked! for the dish. */}
      <div data-toast-above="" className="sticky bottom-[calc(env(safe-area-inset-bottom)+5.75rem)] z-30 mt-auto pt-1 min-[900px]:bottom-6">
        <Button type="button" variant="outline" onClick={onDone} className={cn(K_BUTTON, "min-h-[60px] w-full rounded-[18px] border-[#C9CFC6] bg-card text-[17px] font-extrabold")}>
          {cookedDoneLabel(actions)}
        </Button>
      </div>
    </div>
  );
}

/**
 * The two next steps as cards: one not done opens its sheet; one done reads
 * "Posted ✓" / "Flat 4B ✓" and opens the post, or the dish's Who had some.
 */
export function NextActionList({
  actions,
  postId,
  dishId,
  onPost,
  onSplit,
  splitDoneHref,
}: {
  actions: readonly CookedAction[];
  postId: string | null;
  dishId: string;
  onPost: () => void;
  onSplit: () => void;
  /** Where a done Split goes (the dish page); none on the dish page itself. */
  splitDoneHref?: string;
}) {
  return (
    <ul className="flex flex-col gap-2.5">
      {actions.map((a) => {
        const body = <ActionCardBody action={a} />;
        const cls = cn(
          "flex min-h-[76px] w-full items-center gap-3 rounded-[20px] px-3.5 py-3 text-left transition-colors",
          FOCUS,
          a.done ? "border-[1.5px] border-[#B9DCC8] bg-[#F2F8F4]" : "border border-[#D5DAD2] bg-card hover:bg-accent",
        );
        let el: React.ReactNode;
        if (a.done && a.id === "post" && postId) {
          el = (
            <Link href={postHref(postId)} className={cls}>
              {body}
            </Link>
          );
        } else if (a.done && a.id === "split") {
          el = splitDoneHref ? (
            <Link href={splitDoneHref} className={cls}>
              {body}
            </Link>
          ) : (
            <div className={cls}>{body}</div>
          );
        } else {
          el = (
            <button type="button" onClick={a.id === "post" ? onPost : onSplit} className={cls} data-dish={dishId}>
              {body}
            </button>
          );
        }
        return <li key={a.id}>{el}</li>;
      })}
    </ul>
  );
}

function ActionCardBody({ action }: { action: CookedAction }) {
  const Icon = action.id === "post" ? Megaphone : ReceiptText;
  return (
    <>
      <span aria-hidden className={cn("grid h-11 w-11 shrink-0 place-items-center rounded-[14px]", action.id === "post" ? "bg-[#FCE9DF] text-[#B4471F]" : "bg-[#E6EEF8] text-[#1D4ED8]")}>
        <Icon className="h-[22px] w-[22px]" strokeWidth={2.1} />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="text-[17px] font-extrabold">{action.title}</span>
        <span className="text-[13px] font-semibold text-muted-foreground">{action.sub}</span>
      </span>
      {action.done ? (
        <span className="shrink-0 text-[15px] font-extrabold text-[#165C3A]">{action.doneText}</span>
      ) : (
        <ChevronRight className="h-5 w-5 shrink-0 text-[#9AA39D]" aria-hidden />
      )}
    </>
  );
}

const NO_GROUPS: readonly MyGroupBalance[] = [];

/**
 * Split with a group: Who ate for this dish. The group (the one whose items
 * it used most, else the one suggested, else the one opened last; groups in
 * another currency can't be picked), the group's people with ½ steppers over
 * the dish's servings (you at one), what is left for claims, and "Split with
 * Flat 4B". Splitting is `splitDish`, then the shares; the dish page then
 * shows it as any open group dish.
 */
export function SplitSheet({
  dish,
  meId,
  hint,
  onClose,
  onSplit,
}: {
  dish: KitchenDish;
  meId: string;
  /** A group asked for (Home's reminder). */
  hint: string | null;
  onClose: () => void;
  onSplit: (dish: KitchenDish) => void;
}) {
  const balances = useMyBalances();
  const all = balances.data?.groups ?? NO_GROUPS;
  const recentSlugs = useRecentGroupSlugs();
  const usable = splitGroups(all, dish.currency);
  const suggested = suggestSplitGroup(dish, all, { hint, recentSlugs });
  const [picked, setPicked] = React.useState<string | null>(null);
  const orgId = picked ?? suggested;
  const group = orgId ? (usable.find((g) => g.orgId === orgId) ?? null) : null;
  const members = useMembersOf(group?.orgId ?? null);
  const names = useMemberNames(members.data);
  const roster = React.useMemo(() => (members.data ? members.data.map((m) => m.subjectId) : null), [members.data]);
  const [halves, setHalves] = React.useState<Record<string, number>>(() => splitStartingHalves(meId, dish.portionsHalf));
  const eaten = React.useMemo(() => {
    if (!roster) return halves;
    const keep = new Set([meId, ...roster]);
    return Object.fromEntries(Object.entries(halves).filter(([id]) => keep.has(id)));
  }, [halves, roster, meId]);
  const view = roster ? splitEaters({ dish, roster, meId, halves: eaten, names }) : null;
  const left = view ? splitLeftText(view, group?.name ?? null) : null;
  const button = splitButton(group?.name ?? null, dish);
  const split = useSplitDish();
  const [busy, setBusy] = React.useState(false);
  const [problem, setProblem] = React.useState<string | null>(null);
  const waiting = group !== null && roster === null && !members.error;

  const go = async () => {
    if (!group || !roster || busy) return;
    setProblem(null);
    setBusy(true);
    const out = await split(dish, { orgId: group.orgId, groupName: group.name, halves: eaten, roster, meId });
    setBusy(false);
    if (!out.ok) {
      setProblem(out.message);
      return;
    }
    onSplit(out.dish);
  };

  return (
    <Sheet open onOpenChange={(open) => (open ? undefined : onClose())}>
      <SheetContent side="bottom" aria-describedby={undefined} className={cn(SESSION_SHEET, CLOSE_44)}>
        <div aria-hidden className="mx-auto mb-1 h-1.5 w-10 shrink-0 rounded-full bg-border" />
        <SheetTitle className="pr-12 text-[22px] font-extrabold">Who ate?</SheetTitle>
        <div className="-mx-5 min-h-0 flex-1 space-y-4 overflow-y-auto px-5 pb-1">
          {!balances.loading && usable.length === 0 ? (
            <KCard className="space-y-2 p-4">
              <p className="text-[15px] font-bold">No group to split it with</p>
              <p className="text-sm text-muted-foreground">You need a group you cook in that counts in {dish.currency}.</p>
              <Button asChild variant="outline" className={K_BUTTON}>
                <Link href="/groups">Your groups</Link>
              </Button>
            </KCard>
          ) : (
            <>
              <SharePicker
                title="Split with"
                groups={usable}
                value={orgId ?? ""}
                choice={shareChoice(orgId ?? "", usable)}
                currency={dish.currency}
                loading={balances.loading}
                groupsOnly
                onChange={(to) => {
                  setProblem(null);
                  setPicked(to);
                }}
              />
              {members.error ? (
                <KCard className="flex flex-wrap items-center justify-between gap-3 p-4">
                  <p className="text-sm text-muted-foreground">Couldn&apos;t load who&apos;s in {group?.name ?? "the group"}. {members.error.message}</p>
                  <Button variant="outline" className={K_BUTTON} onClick={members.reload}>
                    Try again
                  </Button>
                </KCard>
              ) : group ? (
                <WhoAteList
                  rows={view?.rows.map((r) => ({ ...r, lessLabel: `Half a portion less for ${r.label}`, moreLabel: `Half a portion more for ${r.label}` })) ?? []}
                  meId={meId}
                  names={names}
                  currency={dish.currency}
                  loading={view === null}
                  onStep={(id, d) => setHalves((h) => ({ ...h, [id]: Math.max(0, (h[id] ?? 0) + d) }))}
                />
              ) : null}
              {left ? <p className="px-1 text-sm font-semibold text-muted-foreground tabular-nums">{left}</p> : null}
            </>
          )}
          {problem ? (
            <p role="alert" className="rounded-xl bg-cp-expired-tint p-3 text-sm font-medium text-cp-expired">
              {problem}
            </p>
          ) : null}
        </div>
        <Button
          type="button"
          className={cn(MAIN_BUTTON, "shrink-0")}
          loading={busy}
          disabled={!group || waiting || members.error !== null || view === null || view.over}
          onClick={() => void go()}
        >
          <MainButtonLabel title={button.title} who={button.sub} />
        </Button>
      </SheetContent>
    </Sheet>
  );
}
