"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, Plus } from "lucide-react";
import type { DishSplitMode, KitchenItem, MyGroupBalance } from "@saas/contracts/kitchen";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useRecentGroupSlugs } from "@/lib/recent-groups";
import { useProfile } from "@/components/kitchen/data";
import { KCard, K_BUTTON } from "@/components/kitchen/kit";
import { MAX_MINOR, formatMinor } from "@/components/kitchen/money";
import { useMemberNames, useMyBalances, useMyRoles } from "@/components/kitchen/people-data";
import { useItemsByRef, useKitchenItem, useMembersOf } from "@/components/kitchen/pantry-data";
import { itemRefParam, parseItemRef, type ItemRef } from "@/components/kitchen/pantry";
import { useCookDish, useCookableItems } from "@/components/kitchen/dish-maker-data";
import {
  CostCard,
  EaterList,
  LineCard,
  LineTable,
  PantryPanel,
  ShareNoteCard,
  SharePicker,
  SplitModeCards,
  ValueStepper,
} from "@/components/kitchen/dish-maker-ui";
import {
  DEFAULT_PORTIONS,
  DISH_NAME_MAX,
  EXTRAS_STEP_MINOR,
  JUST_ME,
  MAX_DISH_INGREDIENTS,
  MAX_PORTIONS,
  addPantryLine,
  cookRequest,
  cookedText,
  ctaLabel,
  defaultShare,
  dishCurrency,
  dishHref,
  dishProblem,
  dishTotals,
  eaterView,
  lineMax,
  lineQty,
  lineStep,
  lineView,
  linesCurrency,
  pantriesText,
  portionsText,
  refreshLines,
  shareChoice,
  shareNote,
  sharesRequest,
  splitModes,
  startingHalves,
  stepDishAmount,
  withLeft,
  withQty,
  type DishForm,
  type DishLine,
  type NewItemDraft,
  type NewLine,
} from "@/components/kitchen/dish-maker";
import {
  fromBeforeTerm,
  mergeRecipeLines,
  missingDraft,
  missingFor,
  newLineFromMissing,
  recipeFill,
  recipeSuggestion,
  resolvePending,
  shownSuggestions,
  type MissingIngredient,
  type PendingIngredient,
} from "@/components/kitchen/from-before";
import { useRecipes } from "@/components/kitchen/from-before-data";
import { SuggestionList, useTypeahead } from "@/components/kitchen/from-before-ui";

const NO_GROUPS: readonly MyGroupBalance[] = [];

/**
 * Cook a dish (CP-15) — one dish from any mix of pantries and things just
 * bought. Phones: the dish's name, its ingredients (each with where it is
 * from, what it costs and whether it is yours or you owe its buyer, a stepper
 * and what is left), "Add from any pantry" (a search over every pantry you
 * cook from, and "Bought it just now?"), extras and portions, the dark cost
 * card (the total, each portion, what came from your own pantry, the extras,
 * and what you take on from each group), who to share it with — a group to
 * claim portions, a split you set now, or just you — and the note that says
 * what nets against what; the button stays above the tab bar. From 900px: two
 * panels, "Take from any pantry" and the dish as a table. Every number is the
 * engine's. `/cook?item=me:itm_…` (Cook with it) starts with that item in the
 * dish. Cooking opens the dish's page, with a ten-second Undo.
 *
 * Cook again (SM-9): as the dish's name is typed, dishes cooked before show
 * under it ("Egg fried rice · 3× · 5 portions · ₹156"). Picking one fills the
 * portions, the extras, who it is for and the ingredients, each from an item
 * usable now at last time's amount; one with nothing to take it from reads
 * "Not in a pantry · add it" and opens "Bought it just now?" for it.
 */
export default function CookPage() {
  const searchParams = useSearchParams();
  const linked = parseItemRef(searchParams?.get("item"));
  return <CookScreen key={linked ? itemRefParam(linked) : "new"} linked={linked} />;
}

function CookScreen({ linked }: { linked: ItemRef | null }) {
  const profile = useProfile();
  const meId = profile.data?.id ?? null;
  if (meId) return <DishMaker linked={linked} meId={meId} />;
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
  return (
    <div className="space-y-5" aria-hidden>
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-14 w-full rounded-2xl" />
      <Skeleton className="h-40 w-full rounded-[20px]" />
      <Skeleton className="h-48 w-full rounded-[22px]" />
    </div>
  );
}

function DishMaker({ linked, meId }: { linked: ItemRef | null; meId: string }) {
  const router = useRouter();
  const balances = useMyBalances();
  const groups = balances.data?.groups ?? NO_GROUPS;
  const { roles, loading: rolesLoading } = useMyRoles();
  const recentSlugs = useRecentGroupSlugs();
  const cookDish = useCookDish();

  const [name, setName] = React.useState("");
  const [lines, setLines] = React.useState<readonly DishLine[]>([]);
  const [extrasMinor, setExtras] = React.useState(0);
  const [portionsHalf, setPortionsHalf] = React.useState(DEFAULT_PORTIONS * 2);
  const [picked, setPicked] = React.useState<string | null>(null);
  const [mode, setMode] = React.useState<DishSplitMode>("claims");
  const [assigned, setAssigned] = React.useState<{ orgId: string; halves: Record<string, number> } | null>(null);
  const [panelOpen, setPanelOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [linkNote, setLinkNote] = React.useState<string | null>(null);
  const [showProblem, setShowProblem] = React.useState(false);
  const idemKey = React.useRef(crypto.randomUUID());
  const seq = React.useRef(0);
  const nameRef = React.useRef<HTMLInputElement>(null);
  const ingredientsRef = React.useRef<HTMLHeadingElement>(null);
  const addRef = React.useRef<HTMLButtonElement>(null);
  const nameFieldRef = React.useRef<HTMLDivElement>(null);
  // Cook again: what the last pick put in (a new pick replaces it), what it
  // still reads, and what is in no pantry now.
  const recipeKeys = React.useRef<ReadonlySet<string>>(new Set());
  const [pending, setPending] = React.useState<readonly PendingIngredient[]>([]);
  const [missing, setMissing] = React.useState<readonly MissingIngredient[]>([]);
  const [buy, setBuy] = React.useState<{ draft: NewItemDraft; seq: number } | null>(null);

  // Cook with it: the item goes in once it is read (and known to be yours to use).
  const linkedItem = useKitchenItem(linked);
  const linkedDone = React.useRef(false);
  React.useEffect(() => {
    if (!linked || linkedDone.current) return;
    if (linkedItem.error) {
      linkedDone.current = true;
      setLinkNote("That item isn't in a pantry you cook from any more. Pick what goes in below.");
      return;
    }
    const item = linkedItem.data;
    if (!item || (linked.kind === "group" && rolesLoading)) return;
    linkedDone.current = true;
    if (item.state !== "active" || item.qtyLeftMilli <= 0) {
      setLinkNote(`Nothing is left of ${item.name}. Pick what goes in below.`);
    } else if (linked.kind === "group" && roles.get(linked.orgId) === "viewer") {
      setLinkNote(`You view ${item.pantry.kind === "group" ? item.pantry.name : "that group"}, so you don't cook from its pantry.`);
    } else {
      setLines((cur) => addPantryLine(cur, item));
    }
  }, [linked, linkedItem.data, linkedItem.error, roles, rolesLoading]);

  // What is in the dish, as read now: someone may have used some meanwhile.
  const cookable = useCookableItems();
  const usable = React.useMemo(
    () => new Map<string, KitchenItem>((cookable.data ?? []).map((i) => [i.id, i] as const)),
    [cookable.data],
  );
  React.useEffect(() => {
    if (!cookable.data) return;
    setLines((cur) => refreshLines(cur, usable));
  }, [cookable.data, usable]);

  // A picked dish's ingredient the usable-items list doesn't hold (it lists
  // 100) is read on its own, once the list has loaded, for its price.
  const listed = cookable.data !== null || cookable.error !== null;
  const toRead = React.useMemo(
    () => (listed ? pending.filter((p) => !usable.has(p.ref.itemId)).map((p) => p.ref) : []),
    [listed, pending, usable],
  );
  const read = useItemsByRef(toRead);
  React.useEffect(() => {
    if (pending.length === 0) return;
    const r = resolvePending(pending, { usable, read });
    if (r.pending.length === pending.length) return;
    const merged = mergeRecipeLines(lines, new Set(), r.lines);
    recipeKeys.current = new Set([...recipeKeys.current, ...merged.keys]);
    setLines(merged.lines);
    setPending(r.pending);
    if (r.missing.length > 0) setMissing((cur) => [...cur, ...r.missing]);
  }, [pending, usable, read, lines]);

  // Who it is for: the cook's pick, else the linked item's group or the group opened last.
  const pickedGroup = picked && picked !== JUST_ME ? (groups.find((g) => g.orgId === picked) ?? null) : null;
  const share =
    picked ??
    defaultShare(groups, { linkedOrgId: linked?.kind === "group" ? linked.orgId : null, recentSlugs, currency: linesCurrency(lines) });
  const shareGroup = share === JUST_ME ? null : (groups.find((g) => g.orgId === share) ?? null);
  const effectiveShare = shareGroup ? shareGroup.orgId : JUST_ME;
  const currency = dishCurrency(lines, shareGroup?.currency ?? null);
  // What a new ingredient must count in: the group you picked, else what is already in the dish.
  const addCurrency = pickedGroup?.currency ?? linesCurrency(lines);

  const assigning = shareGroup !== null && mode === "assign";
  const members = useMembersOf(shareGroup ? shareGroup.orgId : null);
  const names = useMemberNames(members.data);
  const roster = React.useMemo(() => (members.data ? members.data.map((m) => m.subjectId) : null), [members.data]);
  const halves =
    assigned && shareGroup && assigned.orgId === shareGroup.orgId ? assigned.halves : startingHalves(meId, portionsHalf);

  const totals = dishTotals({ lines, extrasMinor, portionsHalf, meId, currency });
  const eaters =
    assigning && roster ? eaterView({ roster, meId, halves, totalMinor: totals.totalMinor, portionsHalf, names }) : null;
  const form: DishForm = { name, lines, extrasMinor, portionsHalf, share: effectiveShare, mode };
  const problem = dishProblem({ form, currency, eaters });
  const waiting = balances.loading || (assigning && roster === null && !members.error);
  const blocked = assigning && members.error !== null;
  const label = ctaLabel({ share: effectiveShare, groupName: shareGroup?.name ?? null, mode, problem });
  const note = shareNote({ share: effectiveShare, groupName: shareGroup?.name ?? null, totals, meId, names });
  const views = lines.map((l) => lineView(l, { meId, names, currency }));
  const fromText = pantriesText(lines);
  const full = lines.length >= MAX_DISH_INGREDIENTS;
  const shown = shareChoice(effectiveShare, groups);
  const alert = error ?? (showProblem && problem?.message ? problem.message : null);

  const setQty = (key: string, qtyMilli: number, delta?: 1 | -1) => {
    const line = lines.find((l) => l.key === key);
    if (!line) return;
    setError(null);
    const max = lineMax(line);
    const next = delta ? stepDishAmount(lineQty(line), delta, lineStep(line), max) : Math.min(qtyMilli, max);
    if (next <= 0) {
      setLines((cur) => cur.filter((l) => l.key !== key));
      // A line taken out leaves nothing to focus: go back to the list's heading.
      window.requestAnimationFrame(() => ingredientsRef.current?.focus());
      return;
    }
    setLines((cur) => cur.map((l) => (l.key === key ? withQty(l, Math.min(next, lineMax(l))) : l)));
  };
  const addItem = (item: KitchenItem) => {
    setError(null);
    setShowProblem(false);
    setLines((cur) => addPantryLine(cur, item));
  };
  const addNew = (line: NewLine) => {
    setError(null);
    setShowProblem(false);
    // Bought for an ingredient that was in no pantry: last time's amount goes in.
    const was = missingFor(line, missing);
    if (was) setMissing((cur) => cur.filter((m) => m.key !== was.key));
    setLines((cur) => [...cur, was ? newLineFromMissing(line, was) : line]);
  };
  const stepEater = (subjectId: string, delta: 1 | -1) => {
    if (!shareGroup) return;
    setError(null);
    const next = Math.max(0, (halves[subjectId] ?? 0) + delta);
    setAssigned({ orgId: shareGroup.orgId, halves: { ...halves, [subjectId]: next } });
  };
  const openPanel = () => {
    setPanelOpen(true);
    window.requestAnimationFrame(() => document.getElementById("dish-pantry-search")?.focus());
  };

  // Cook again: dishes cooked before, as the name is typed (the most recent on an empty field).
  const typeahead = useTypeahead(name, "dish-name-suggestions");
  const recipes = useRecipes(typeahead.term, typeahead.open || typeahead.term === "");
  const freshRecipes = !recipes.isPlaceholderData && typeahead.term === fromBeforeTerm(name);
  const suggestions = typeahead.open ? shownSuggestions(recipes.data, name, freshRecipes) : [];
  const pickRecipe = (index: number) => {
    const recipe = suggestions[index];
    if (!recipe) return;
    const fill = recipeFill(recipe, { usable, groups });
    const merged = mergeRecipeLines(lines, recipeKeys.current, fill.lines);
    recipeKeys.current = merged.keys;
    setError(null);
    setShowProblem(false);
    setName(fill.name);
    setLines(merged.lines);
    setPending(fill.pending);
    setMissing(fill.missing);
    setPortionsHalf(fill.portionsHalf);
    setExtras(fill.extrasMinor);
    if (fill.share !== null) setPicked(fill.share);
    typeahead.close();
    // What it filled is next: the ingredients (on a phone, the keyboard goes down).
    window.requestAnimationFrame(() => ingredientsRef.current?.focus());
  };
  // "Not in a pantry · add it": "Bought it just now?" opens for that name.
  const buyMissing = (m: MissingIngredient) => {
    setBuy((cur) => ({ draft: missingDraft(m), seq: (cur?.seq ?? 0) + 1 }));
    setPanelOpen(true);
  };

  const submit = async () => {
    if (busy || waiting || blocked) return;
    if (problem) {
      setShowProblem(true);
      if (problem.field === "name") nameRef.current?.focus();
      else if (problem.field === "lines" && lines.length === 0) {
        if (window.matchMedia("(min-width: 900px)").matches) document.getElementById("dish-pantry-search")?.focus();
        else openPanel();
      }
      return;
    }
    setBusy(true);
    setError(null);
    const shares = assigning && roster ? sharesRequest(halves, roster, meId) : null;
    const groupName = shareGroup?.name ?? null;
    const r = await cookDish({
      request: cookRequest(form),
      shares,
      idempotencyKey: idemKey.current,
      lines,
      text: (dish) => cookedText({ name: dish.name, share: effectiveShare, groupName, mode, totalMinor: dish.totalMinor, currency: dish.currency }),
    });
    if (!r.ok) {
      setBusy(false);
      // A refusal is stored against its key at the edge: the next try needs a new one.
      if (r.answered) idemKey.current = crypto.randomUUID();
      const short = r.refusal.short;
      if (short) setLines((cur) => withLeft(cur, short.itemId, short.qtyLeftMilli));
      setError(r.refusal.message);
      return;
    }
    idemKey.current = crypto.randomUUID();
    router.push(dishHref(r.dish.id));
  };

  const back = () => {
    if (window.history.length > 1) router.back();
    else router.push("/home");
  };

  const ctaDisabled = waiting || blocked;
  const cta = (className: string) => (
    <Button
      type="button"
      className={cn(K_BUTTON, "bg-cp-tomato text-white hover:bg-cp-tomato/90", className)}
      disabled={ctaDisabled}
      loading={busy}
      onClick={() => void submit()}
    >
      {label}
    </Button>
  );
  const alertBox = (className: string) =>
    alert ? (
      <p role="alert" className={cn("rounded-xl bg-cp-expired-tint p-3 text-sm font-medium text-cp-expired", className)}>
        {alert}
      </p>
    ) : null;

  return (
    <div className="space-y-5 min-[900px]:grid min-[900px]:grid-cols-[minmax(0,17rem)_minmax(0,1fr)] min-[900px]:grid-rows-[auto_auto_1fr] min-[900px]:gap-x-6 min-[900px]:gap-y-5 min-[900px]:space-y-0 min-[1200px]:grid-cols-[minmax(0,340px)_minmax(0,1fr)]">
      <header className="min-[900px]:sticky min-[900px]:top-0 min-[900px]:z-20 min-[900px]:col-span-2 min-[900px]:-mx-1 min-[900px]:-mt-4 min-[900px]:bg-background min-[900px]:px-1 min-[900px]:py-3">
        <button
          type="button"
          onClick={back}
          className="-ml-2 inline-flex min-h-11 items-center gap-1.5 rounded-xl px-2 text-sm font-semibold text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden />
          Back
        </button>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-[26px] font-extrabold leading-tight tracking-tight">Cook a dish</h1>
            <p className="mt-1 text-sm text-muted-foreground">From any pantry. Whoever paid for what you take is paid back.</p>
          </div>
          {cta("hidden h-12 px-6 text-base font-extrabold min-[900px]:inline-flex")}
        </div>
        {alertBox("mt-3 hidden min-[900px]:block")}
      </header>

      {/* The dish: its name and what is in it. */}
      <div className="min-w-0 space-y-5 min-[900px]:col-start-2 min-[900px]:row-start-2">
        {linkNote ? <p className="rounded-xl bg-cp-soon-tint p-3 text-sm font-medium text-cp-soon">{linkNote}</p> : null}
        <div className="space-y-2">
          <div ref={nameFieldRef} className="space-y-2">
            <label htmlFor="dish-name" className="text-sm font-bold">
              Dish
            </label>
            <Input
              ref={nameRef}
              id="dish-name"
              value={name}
              {...typeahead.inputProps({
                count: suggestions.length,
                onPick: pickRecipe,
                onChange: (e) => {
                  setName(e.target.value);
                  setShowProblem(false);
                },
              })}
              maxLength={DISH_NAME_MAX + 20}
              placeholder="What are you making?"
              autoComplete="off"
              aria-invalid={showProblem && problem?.field === "name"}
              className="h-[52px] rounded-[14px] bg-card px-3.5 text-lg font-bold sm:h-[52px] sm:text-lg"
            />
          </div>
          <SuggestionList
            id="dish-name-suggestions"
            label="Cooked before"
            views={suggestions.map(recipeSuggestion)}
            active={typeahead.active}
            onPick={pickRecipe}
            onHighlight={typeahead.highlight}
            fieldRef={nameFieldRef}
          />
        </div>

        <section aria-labelledby="dish-ingredients" className="space-y-2.5">
          <div className="flex items-baseline justify-between gap-3">
            <h2 id="dish-ingredients" ref={ingredientsRef} tabIndex={-1} className="rounded text-[17px] font-extrabold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              Ingredients
            </h2>
            {fromText ? <span className="text-[13px] text-muted-foreground">{fromText}</span> : null}
          </div>
          {lines.length === 0 && missing.length === 0 && pending.length === 0 ? (
            <KCard className="p-4 text-sm text-muted-foreground">
              Nothing in it yet. Take things from your own pantry or any group&apos;s you cook in — or add something you just bought.
              <span className="hidden min-[900px]:inline"> Pick from the list on the left.</span>
            </KCard>
          ) : lines.length === 0 ? null : (
            <>
              {/* Cards on a phone and while the dish's column is narrow; the table from 1200px. */}
              <ul aria-label="In the dish" className="space-y-2 min-[1200px]:hidden">
                {views.map((v) => (
                  <LineCard key={v.key} view={v} currency={currency} onChange={(q, d) => setQty(v.key, q, d)} />
                ))}
              </ul>
              <div className="hidden rounded-[22px] border bg-card min-[1200px]:block">
                <LineTable
                  views={views}
                  currency={currency}
                  heading={
                    <>
                      In the dish{fromText ? <span className="font-semibold text-muted-foreground"> · {fromText}</span> : null}
                    </>
                  }
                  onChange={setQty}
                />
              </div>
            </>
          )}
          {pending.length > 0 || missing.length > 0 ? (
            <ul aria-label="Not in the dish yet" className="space-y-2">
              {pending.map((p) => (
                <li key={p.key} className="flex min-h-11 items-center gap-3 rounded-[18px] border bg-card px-3.5 py-2.5">
                  <span className="min-w-0 flex-1 truncate text-[15px] font-bold">{p.ingredient.name}</span>
                  <Skeleton className="h-4 w-16" aria-hidden />
                </li>
              ))}
              {missing.map((m) => (
                <li key={m.key}>
                  <button
                    type="button"
                    onClick={() => buyMissing(m)}
                    className="flex min-h-11 w-full items-center gap-3 rounded-[18px] border border-dashed border-[#A9B2A6] bg-card px-3.5 py-2.5 text-left transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[15px] font-bold text-muted-foreground">{m.name}</span>
                      <span className="block text-xs font-bold text-cp-tomato">Not in a pantry · add it</span>
                    </span>
                    <Plus className="h-5 w-5 shrink-0 text-cp-tomato" aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          {panelOpen ? null : (
            <button
              ref={addRef}
              type="button"
              aria-expanded={false}
              aria-controls="dish-pantry"
              onClick={openPanel}
              className="flex min-h-[50px] w-full items-center justify-center gap-2 rounded-[14px] border border-dashed border-[#A9B2A6] text-[15px] font-bold transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring min-[900px]:hidden"
            >
              <Plus className="h-5 w-5" aria-hidden />
              Add from any pantry
            </button>
          )}
        </section>
      </div>

      {/* Take from any pantry: under the list on a phone (when opened), the left panel from 900px. */}
      <div
        id="dish-pantry"
        className={cn(
          "min-w-0 min-[900px]:sticky min-[900px]:top-32 min-[900px]:col-start-1 min-[900px]:row-span-2 min-[900px]:row-start-2 min-[900px]:block min-[900px]:self-start",
          panelOpen ? "block" : "hidden",
        )}
      >
        <PantryPanel
          idPrefix="dish-pantry"
          dishLines={lines}
          currency={addCurrency}
          dishCurrency={currency}
          full={full}
          meId={meId}
          names={names}
          onAdd={addItem}
          onAddNew={addNew}
          buy={buy}
          newKey={() => `new:${(seq.current += 1)}`}
          onClose={() => {
            setPanelOpen(false);
            window.requestAnimationFrame(() => addRef.current?.focus());
          }}
        />
      </div>

      {/* Extras, portions, the cost card, who it is for and who ate. */}
      <div className="min-w-0 space-y-5 min-[900px]:col-start-2 min-[900px]:row-start-3">
        <div className="grid grid-cols-2 gap-2.5 min-[900px]:max-[1099px]:grid-cols-1">
          <ValueStepper
            label="Extras"
            hint="(gas, spices)"
            value={formatMinor(extrasMinor, currency)}
            lessLabel={`${formatMinor(EXTRAS_STEP_MINOR, currency)} less in extras`}
            moreLabel={`${formatMinor(EXTRAS_STEP_MINOR, currency)} more in extras`}
            canLess={extrasMinor > 0}
            canMore={extrasMinor + EXTRAS_STEP_MINOR <= MAX_MINOR}
            onLess={() => setExtras((x) => Math.max(0, x - EXTRAS_STEP_MINOR))}
            onMore={() => setExtras((x) => x + EXTRAS_STEP_MINOR)}
          />
          <ValueStepper
            label="Portions"
            value={portionsText(portionsHalf)}
            lessLabel="One portion fewer"
            moreLabel="One portion more"
            canLess={portionsHalf > 2}
            canMore={portionsHalf < MAX_PORTIONS * 2}
            onLess={() => setPortionsHalf((p) => Math.max(2, p - 2))}
            onMore={() => setPortionsHalf((p) => Math.min(MAX_PORTIONS * 2, p + 2))}
          />
        </div>

        <CostCard totals={totals} meId={meId} names={names} />

        <SharePicker
          groups={groups}
          value={effectiveShare}
          choice={shown}
          currency={linesCurrency(lines)}
          loading={balances.loading}
          onChange={(key) => {
            setError(null);
            setPicked(key);
          }}
        />
        {balances.error ? (
          <p className="text-[13px] text-muted-foreground">
            Couldn&apos;t load your groups, so only &ldquo;Just me&rdquo; is offered.{" "}
            <button type="button" onClick={balances.reload} className="font-semibold text-primary underline-offset-2 hover:underline">
              Try again
            </button>
          </p>
        ) : null}

        {shareGroup ? (
          <SplitModeCards
            modes={splitModes(shareGroup.name)}
            value={mode}
            onChange={(m) => {
              setError(null);
              setMode(m);
            }}
          />
        ) : null}

        {assigning ? (
          members.error ? (
            <KCard className="flex flex-wrap items-center justify-between gap-3 p-4">
              <p className="text-sm text-muted-foreground">Couldn&apos;t load who&apos;s in {shareGroup?.name}. {members.error.message}</p>
              <Button variant="outline" className={K_BUTTON} onClick={members.reload}>
                Try again
              </Button>
            </KCard>
          ) : (
            <EaterList
              view={eaters ?? { rows: [], claimedHalf: 0, unclaimedHalf: 0, unclaimedMinor: 0, over: false }}
              currency={currency}
              loading={eaters === null}
              onStep={stepEater}
            />
          )
        ) : null}

        {note ? <ShareNoteCard note={note} /> : null}

        {alertBox("min-[900px]:hidden")}
      </div>

      {/* Phones: the button stays above the tab bar, however long the dish. */}
      <div className="sticky bottom-[calc(env(safe-area-inset-bottom)+5.75rem)] z-30 min-[900px]:hidden">
        {cta("h-[54px] w-full rounded-2xl text-base font-extrabold shadow-[0_8px_24px_rgba(23,32,27,0.18)]")}
      </div>
    </div>
  );
}
