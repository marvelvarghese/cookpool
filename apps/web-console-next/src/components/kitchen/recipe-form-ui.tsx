"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, Plus, Trash2, X } from "lucide-react";
import { MAX_RECIPE_LINES, MAX_RECIPE_STEPS, type KitchenRecipe } from "@saas/contracts/kitchen";
import { cn } from "@/lib/cn";
import { usePathParam } from "@/lib/page-param";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { KCard, K_BUTTON, K_INPUT } from "./kit";
import { BackButton, useBack } from "./back-ui";
import { MAIN_BUTTON, MainButtonLabel } from "./faces-ui";
import { SuggestionList, useTypeahead } from "./from-before-ui";
import { halvesText, parseRecipeRef, recipeHref, canEditRecipe } from "./recipes";
import {
  addLine,
  addStep,
  chooseMain,
  errorsFromDetails,
  foodSuggestionViews,
  formFromRecipe,
  initialRecipeForm,
  lineLinkText,
  mainKeyOf,
  moveLine,
  noErrors,
  pickFood,
  recipeRequest,
  removeLine,
  removeStep,
  setLine,
  setStep,
  stepServes,
  typeLineName,
  unitOptions,
  type LineDraft,
  type RecipeForm,
  type RecipeFormErrors,
} from "./recipe-form";
import { useDeleteRecipe, useFoods, useRecipe, useSaveRecipe } from "./recipes-data";
import { RecipeNotFound } from "./recipe-views";

/**
 * Writing a recipe and editing yours (cookpool-recipes RC-5, design §3.1,
 * §3.5): `/recipes/new` and `/recipes/[id]/edit`, in the new frame only.
 * Its name, serves (½ steps) and minutes (optional); its ingredients — a
 * food from the list (or your own words), an amount and a unit or To taste,
 * one marked main with a radio (the first with a weight unless you choose),
 * each moved up or down or taken out; its steps, up to 20; then Save, which
 * opens the recipe. The server's 422 lands on the line it names. Editing
 * adds Delete, with Undo instead of a confirm.
 */
export function NewRecipeScreen() {
  return <RecipeFormScreen recipe={null} />;
}

export function EditRecipeScreen() {
  const recipeId = parseRecipeRef(usePathParam("/recipes/:recipeId", "recipeId"));
  const recipe = useRecipe(recipeId);
  if (!recipeId) return <RecipeNotFound />;
  if (recipe.loading) return <FormSkeleton />;
  if (recipe.error?.code === "not_found") return <RecipeNotFound />;
  if (recipe.error || !recipe.data) {
    return (
      <KCard className="flex flex-wrap items-center justify-between gap-3 p-5">
        <p className="text-sm text-muted-foreground">Couldn&apos;t load this recipe. {recipe.error?.message ?? ""}</p>
        <Button variant="outline" className={K_BUTTON} onClick={recipe.reload}>
          Try again
        </Button>
      </KCard>
    );
  }
  if (!canEditRecipe(recipe.data.recipe)) {
    return (
      <KCard className="flex flex-col gap-3 p-5">
        <h1 className="text-lg font-bold">Only its owner can change {recipe.data.recipe.name}</h1>
        <Button asChild variant="outline" className={cn(K_BUTTON, "self-start")}>
          <Link href={recipeHref(recipeId)}>Open it</Link>
        </Button>
      </KCard>
    );
  }
  return <RecipeFormScreen key={recipe.data.recipe.id} recipe={recipe.data.recipe} />;
}

const LEGEND = "mb-2 block text-sm font-extrabold";

function FieldError({ id, message }: { id: string; message: string | undefined }) {
  if (!message) return null;
  return (
    <p id={id} className="mt-1 text-sm font-medium text-destructive">
      {message}
    </p>
  );
}

function RecipeFormScreen({ recipe }: { recipe: KitchenRecipe | null }) {
  const router = useRouter();
  const back = useBack();
  const save = useSaveRecipe();
  const remove = useDeleteRecipe();
  const seq = React.useRef(0);
  const newKey = React.useCallback(() => `line_${(seq.current += 1)}`, []);
  const [form, setFormState] = React.useState<RecipeForm>(() => (recipe ? formFromRecipe(recipe, newKey) : initialRecipeForm(newKey)));
  const [tried, setTried] = React.useState(false);
  const [serverErrors, setServerErrors] = React.useState<RecipeFormErrors | null>(null);
  const [busy, setBusy] = React.useState(false);
  const formRef = React.useRef<HTMLFormElement>(null);

  const setForm = React.useCallback((f: (cur: RecipeForm) => RecipeForm) => {
    setServerErrors(null);
    setFormState(f);
  }, []);

  const request = recipeRequest(form);
  const errors = serverErrors ?? (tried ? request.errors : noErrors());
  const mainKey = mainKeyOf(form);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setTried(true);
    if (!request.body) {
      focusFirstError(formRef.current);
      return;
    }
    setBusy(true);
    const r = await save({ recipeId: recipe?.id ?? null, body: request.body });
    setBusy(false);
    if (r.ok) {
      if (recipe) back();
      else router.replace(recipeHref(r.data.recipe.id));
      return;
    }
    if (r.error.reason === "offline") return;
    setServerErrors(r.status === 422 ? errorsFromDetails(r.error.details, request, r.error.message) : { ...noErrors(), other: r.error.message });
    window.requestAnimationFrame(() => focusFirstError(formRef.current));
  };

  return (
    <div className="flex w-full max-w-xl flex-col gap-4">
      <header className="flex items-center gap-1">
        <BackButton />
        <h1 className="text-[26px] font-extrabold leading-tight tracking-tight">{recipe ? "Edit recipe" : "New recipe"}</h1>
      </header>

      <form ref={formRef} onSubmit={submit} noValidate className="flex flex-col gap-6">
        <div data-field="name">
          <Label htmlFor="recipe-name" className={LEGEND}>
            Name
          </Label>
          <Input
            id="recipe-name"
            value={form.name}
            maxLength={120}
            autoComplete="off"
            placeholder="Chicken curry"
            onChange={(e) => {
              const name = e.target.value;
              setForm((f) => ({ ...f, name }));
            }}
            aria-invalid={!!errors.name}
            aria-describedby={errors.name ? "recipe-name-error" : undefined}
            className={cn(K_INPUT, "h-12 sm:h-12")}
          />
          <FieldError id="recipe-name-error" message={errors.name} />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div data-field="servesHalf">
            <span id="recipe-serves-label" className={LEGEND}>
              Serves
            </span>
            <div role="group" aria-labelledby="recipe-serves-label" className="flex items-center gap-2">
              <button type="button" aria-label="Serves fewer" disabled={form.servesHalf <= 1} onClick={() => setForm((f) => stepServes(f, -1))} className={STEP_BUTTON}>
                −
              </button>
              <span aria-live="polite" className="min-w-10 text-center text-lg font-extrabold tabular-nums">
                {halvesText(form.servesHalf)}
              </span>
              <button type="button" aria-label="Serves more" onClick={() => setForm((f) => stepServes(f, 1))} className={STEP_BUTTON}>
                +
              </button>
            </div>
            <FieldError id="recipe-serves-error" message={errors.servesHalf} />
          </div>
          <div data-field="minutes">
            <Label htmlFor="recipe-minutes" className={LEGEND}>
              Minutes <span className="font-semibold text-muted-foreground">· optional</span>
            </Label>
            <Input
              id="recipe-minutes"
              inputMode="numeric"
              value={form.minutes}
              placeholder="45"
              autoComplete="off"
              onChange={(e) => {
                const minutes = e.target.value;
                setForm((f) => ({ ...f, minutes }));
              }}
              aria-invalid={!!errors.minutes}
              aria-describedby={errors.minutes ? "recipe-minutes-error" : undefined}
              className={cn(K_INPUT, "h-11 tabular-nums")}
            />
            <FieldError id="recipe-minutes-error" message={errors.minutes} />
          </div>
        </div>

        <section aria-labelledby="recipe-lines-h" className="flex flex-col gap-2.5" data-field="lines">
          <div className="flex items-baseline justify-between gap-3">
            <h2 id="recipe-lines-h" className="text-lg font-extrabold tracking-tight">
              Ingredients
            </h2>
            <span className="text-[13px] font-bold text-muted-foreground">Main scales the rest</span>
          </div>
          <ol className="flex flex-col gap-2.5">
            {form.lines.map((line, i) => (
              <li key={line.key}>
                <LineEditor
                  line={line}
                  index={i}
                  count={form.lines.length}
                  isMain={line.key === mainKey}
                  errors={errors.line[line.key]}
                  onName={(name) => setForm((f) => typeLineName(f, line.key, name))}
                  onPick={(food) => setForm((f) => pickFood(f, line.key, food))}
                  onChange={(patch) => setForm((f) => setLine(f, line.key, patch))}
                  onMain={() => setForm((f) => chooseMain(f, line.key))}
                  onMove={(d) => setForm((f) => moveLine(f, line.key, d))}
                  onRemove={() => setForm((f) => removeLine(f, line.key, newKey))}
                />
              </li>
            ))}
          </ol>
          <FieldError id="recipe-lines-error" message={errors.lines} />
          {form.lines.length < MAX_RECIPE_LINES ? (
            <Button
              type="button"
              variant="outline"
              className={cn(K_BUTTON, "h-12 gap-2 self-start rounded-[14px] border-[#C9CFC6] bg-card font-extrabold")}
              onClick={() => {
                const key = newKey();
                setForm((f) => addLine(f, key));
                window.requestAnimationFrame(() => document.getElementById(`${key}-name`)?.focus());
              }}
            >
              <Plus className="h-[18px] w-[18px]" strokeWidth={2.2} aria-hidden />
              Add an ingredient
            </Button>
          ) : null}
        </section>

        <StepsEditor
          steps={form.steps}
          errors={errors.step}
          error={errors.steps}
          onAdd={() => {
            const index = form.steps.length;
            setForm(addStep);
            window.requestAnimationFrame(() => document.getElementById(`recipe-step-${index}`)?.focus());
          }}
          onChange={(i, text) => setForm((f) => setStep(f, i, text))}
          onRemove={(i) => setForm((f) => removeStep(f, i))}
        />

        {errors.other ? (
          <p role="alert" className="rounded-xl bg-cp-expired-tint p-3 text-sm font-medium text-cp-expired">
            {errors.other}
          </p>
        ) : null}

        <div data-toast-above="" className="sticky bottom-[calc(env(safe-area-inset-bottom)+5.75rem)] z-30 min-[900px]:static min-[900px]:max-w-sm">
          <Button type="submit" className={cn(MAIN_BUTTON, "shadow-[0_8px_24px_rgba(23,32,27,0.18)] min-[900px]:shadow-none")} loading={busy}>
            <MainButtonLabel title={recipe ? "Save changes" : "Save recipe"} who={form.name.trim() || null} />
          </Button>
        </div>

        {recipe ? (
          <button
            type="button"
            onClick={() => {
              if (remove(recipe)) router.replace("/cook");
            }}
            className="flex min-h-11 items-center gap-2 self-start rounded-xl px-2 text-[15px] font-extrabold text-cp-expired hover:bg-cp-expired-tint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Trash2 className="h-[18px] w-[18px]" aria-hidden />
            Delete recipe
          </button>
        ) : null}
      </form>
    </div>
  );
}

/** Put the focus on the first field that says what is wrong. */
function focusFirstError(form: HTMLFormElement | null) {
  const el = form?.querySelector<HTMLElement>('[aria-invalid="true"]');
  el?.focus();
}

const STEP_BUTTON =
  "grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-[#C9CFC6] bg-card text-xl font-bold transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-40";

const ICON_BUTTON =
  "grid h-11 w-11 shrink-0 place-items-center rounded-xl text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-30";

/**
 * One ingredient: its words (the food list under them as they are typed),
 * amount and unit or To taste, the main radio, up, down and remove.
 */
function LineEditor({
  line,
  index,
  count,
  isMain,
  errors,
  onName,
  onPick,
  onChange,
  onMain,
  onMove,
  onRemove,
}: {
  line: LineDraft;
  index: number;
  count: number;
  isMain: boolean;
  errors: RecipeFormErrors["line"][string] | undefined;
  onName: (name: string) => void;
  onPick: (food: { key: string; name: string; dimension: "mass" | "volume" | "count" }) => void;
  onChange: (patch: Partial<Pick<LineDraft, "quantity" | "unit" | "toTaste">>) => void;
  onMain: () => void;
  onMove: (direction: -1 | 1) => void;
  onRemove: () => void;
}) {
  const id = line.key;
  const listId = `${id}-foods`;
  const typeahead = useTypeahead(line.name, listId);
  const foods = useFoods(typeahead.open && !line.foodKey ? typeahead.term : "");
  const found = typeahead.open && !line.foodKey ? (foods.data ?? []) : [];
  const views = foodSuggestionViews(found);
  const fieldRef = React.useRef<HTMLDivElement>(null);
  const link = lineLinkText(line);
  const pick = (i: number) => {
    const food = found[i];
    if (!food) return;
    onPick(food);
    typeahead.close();
  };
  const position = `Ingredient ${index + 1}`;

  return (
    <div className="flex flex-col gap-2.5 rounded-[18px] border bg-card p-3" role="group" aria-label={line.name.trim() || position}>
      <div ref={fieldRef}>
        <Label htmlFor={`${id}-name`} className="sr-only">
          {position}
        </Label>
        <Input
          id={`${id}-name`}
          value={line.name}
          maxLength={120}
          autoComplete="off"
          placeholder={index === 0 ? "Chicken" : "Onions"}
          aria-invalid={!!errors?.name}
          aria-describedby={errors?.name ? `${id}-name-error` : link ? `${id}-link` : undefined}
          className={cn(K_INPUT, "font-semibold")}
          {...typeahead.inputProps({
            count: views.length,
            onPick: pick,
            onChange: (e) => onName(e.target.value),
          })}
        />
        <FieldError id={`${id}-name-error`} message={errors?.name} />
        {link && !errors?.name ? (
          <p id={`${id}-link`} className={cn("mt-1 px-1 text-xs font-bold", link.linked ? "text-[#165C3A]" : "text-muted-foreground")}>
            {link.text}
          </p>
        ) : null}
        <SuggestionList
          id={listId}
          label="From the food list"
          views={views}
          active={typeahead.active}
          onPick={pick}
          onHighlight={typeahead.highlight}
          fieldRef={fieldRef}
          className="mt-2"
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {line.toTaste ? (
          <span className="flex min-h-11 flex-1 items-center px-1 text-[15px] font-bold text-muted-foreground">To taste</span>
        ) : (
          <>
            <Label htmlFor={`${id}-qty`} className="sr-only">
              How much
            </Label>
            <Input
              id={`${id}-qty`}
              inputMode="decimal"
              value={line.quantity}
              placeholder="450"
              autoComplete="off"
              onChange={(e) => onChange({ quantity: e.target.value })}
              aria-invalid={!!errors?.quantity}
              aria-describedby={errors?.quantity ? `${id}-qty-error` : undefined}
              className={cn(K_INPUT, "w-24 tabular-nums")}
            />
            <Label htmlFor={`${id}-unit`} className="sr-only">
              Unit
            </Label>
            <select
              id={`${id}-unit`}
              value={line.unit}
              onChange={(e) => onChange({ unit: e.target.value })}
              aria-invalid={!!errors?.unit}
              className="h-11 min-w-20 rounded-xl border border-input bg-background px-3 text-[15px] font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {unitOptions(line).map((u) => (
                <option key={u} value={u}>
                  {u}
                </option>
              ))}
            </select>
          </>
        )}
        <label className="ml-auto flex min-h-11 items-center gap-2 text-sm font-bold">
          <Switch checked={line.toTaste} onCheckedChange={(toTaste) => onChange({ toTaste })} aria-label={`${line.name.trim() || position}: to taste`} />
          <span aria-hidden>To taste</span>
        </label>
      </div>
      <FieldError id={`${id}-qty-error`} message={errors?.quantity ?? errors?.unit} />

      <div className="flex items-center gap-1 border-t border-[#ECEEE9] pt-1.5">
        <label className={cn("flex min-h-11 flex-1 items-center gap-2 text-sm font-extrabold", line.toTaste ? "cursor-not-allowed text-muted-foreground" : "cursor-pointer")}>
          <input
            type="radio"
            name="recipe-main"
            value={line.key}
            checked={isMain}
            disabled={line.toTaste}
            onChange={onMain}
            className="h-5 w-5 accent-[#1F7A4D]"
          />
          Main
        </label>
        <FieldError id={`${id}-main-error`} message={errors?.main} />
        <button type="button" aria-label={`Move ${line.name.trim() || position} up`} disabled={index === 0} onClick={() => onMove(-1)} className={ICON_BUTTON}>
          <ArrowUp className="h-5 w-5" aria-hidden />
        </button>
        <button type="button" aria-label={`Move ${line.name.trim() || position} down`} disabled={index === count - 1} onClick={() => onMove(1)} className={ICON_BUTTON}>
          <ArrowDown className="h-5 w-5" aria-hidden />
        </button>
        <button type="button" aria-label={`Remove ${line.name.trim() || position}`} onClick={onRemove} className={ICON_BUTTON}>
          <Trash2 className="h-5 w-5" aria-hidden />
        </button>
      </div>
    </div>
  );
}

/** Steps: short texts, numbered, up to 20; each comes out with its ×. */
function StepsEditor({
  steps,
  errors,
  error,
  onAdd,
  onChange,
  onRemove,
}: {
  steps: readonly string[];
  errors: Record<number, string>;
  error: string | undefined;
  onAdd: () => void;
  onChange: (index: number, text: string) => void;
  onRemove: (index: number) => void;
}) {
  return (
    <section aria-labelledby="recipe-steps-h" className="flex flex-col gap-2.5" data-field="steps">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="recipe-steps-h" className="text-lg font-extrabold tracking-tight">
          Steps{steps.length > 0 ? ` · ${steps.length}` : ""}
        </h2>
        <span className="text-[13px] font-bold tabular-nums text-muted-foreground">
          {steps.length} of {MAX_RECIPE_STEPS}
        </span>
      </div>
      {steps.length > 0 ? (
        <ol className="flex flex-col gap-2">
          {steps.map((text, i) => (
            <li key={i} className="flex items-start gap-2">
              <span aria-hidden className="mt-2.5 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-foreground text-xs font-extrabold text-background">
                {i + 1}
              </span>
              <div className="min-w-0 flex-1">
                <Label htmlFor={`recipe-step-${i}`} className="sr-only">
                  Step {i + 1}
                </Label>
                <textarea
                  id={`recipe-step-${i}`}
                  value={text}
                  rows={2}
                  maxLength={200}
                  placeholder={i === 0 ? "Brown the onions in the oil, about 8 min." : ""}
                  onChange={(e) => onChange(i, e.target.value)}
                  aria-invalid={!!errors[i]}
                  aria-describedby={errors[i] ? `recipe-step-${i}-error` : undefined}
                  className="min-h-11 w-full resize-none rounded-xl border border-input bg-background px-3 py-2.5 text-base leading-snug focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:text-[15px]"
                />
                <FieldError id={`recipe-step-${i}-error`} message={errors[i]} />
              </div>
              <button type="button" aria-label={`Remove step ${i + 1}`} onClick={() => onRemove(i)} className={ICON_BUTTON}>
                <X className="h-5 w-5" aria-hidden />
              </button>
            </li>
          ))}
        </ol>
      ) : null}
      <FieldError id="recipe-steps-error" message={error} />
      {steps.length < MAX_RECIPE_STEPS ? (
        <Button type="button" variant="outline" className={cn(K_BUTTON, "h-12 gap-2 self-start rounded-[14px] border-[#C9CFC6] bg-card font-extrabold")} onClick={onAdd}>
          <Plus className="h-[18px] w-[18px]" strokeWidth={2.2} aria-hidden />
          Add a step
        </Button>
      ) : null}
    </section>
  );
}

function FormSkeleton() {
  return (
    <div className="flex max-w-xl flex-col gap-4" aria-hidden>
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-12 w-full rounded-xl" />
      <Skeleton className="h-11 w-full rounded-xl" />
      <Skeleton className="h-40 w-full rounded-[18px]" />
      <Skeleton className="h-40 w-full rounded-[18px]" />
    </div>
  );
}
