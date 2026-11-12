"use client";

import * as React from "react";
import Link from "./link";
import type { AiRecipeCheck, AiRecipeDraft } from "@saas/contracts/kitchen";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { K_BUTTON } from "./kit";
import { BackControl, useBack } from "./back-ui";
import { AI_EDGE, AiChip } from "./receipt-scan-ui";
import { shrinkReceiptPhoto } from "./receipt-photo";
import { errorsFromDetails, noErrors, type RecipeFormErrors } from "./recipe-form";
import { RecipeFormScreen } from "./recipe-form-ui";
import { recipeHref } from "./recipes";
import { useSaveRecipe } from "./recipes-data";
import { useKitchenRouter } from "./transition-ui";
import { useReadRecipePhoto, useRecipePhotoShows } from "./recipe-photo-data";
import {
  PHOTO_UNUSABLE,
  RECIPE_PHOTO_HREF,
  RECIPE_PHOTO_LONG_SIDE,
  formFromDraft,
  photoCard,
  photoRequested,
  photoSavePlan,
  readingText,
  recipePhotoError,
  type DraftForm,
  type RecipePhotoError,
} from "./recipe-photo";

/**
 * Recipe from a photo (cookpool-ai AI-9, design §4, the canvas's AiImport),
 * in the new frame when AI is available, the server reads recipe photos and
 * this device's switch is on. It lives on New recipe (`/recipes/new`;
 * `?photo=1`, My recipes' "📷 From a photo", opens it at once): Pick → Reading
 * → the result (the card, Steps · Ingredients) → Open in editor (RC-5's form,
 * prefilled, each check marked) or Save recipe (the draft, to the create
 * route; then the new recipe). Nothing is saved before a tap, and the photo
 * is never stored.
 */

const ENTRY =
  "flex min-h-12 w-full items-center gap-2.5 rounded-[14px] px-3.5 text-[15px] font-extrabold transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

function EntryInside() {
  return (
    <>
      <span aria-hidden>📷</span>
      <span className="flex-1 text-left">From a photo</span>
      <AiChip />
    </>
  );
}

/** My recipes' entry: a link to New recipe's photo step; nothing unless it shows. */
export function RecipePhotoEntry() {
  const { shows } = useRecipePhotoShows();
  if (!shows) return null;
  return (
    <Link href={RECIPE_PHOTO_HREF} className={cn(ENTRY, AI_EDGE)}>
      <EntryInside />
    </Link>
  );
}

/**
 * New recipe, with the photo step when it shows: the form (with "From a
 * photo" on top), or the flow. Once the flow has started it stays even when
 * the read says AI is off, so the refusal is read.
 */
export function NewRecipe() {
  const { shows, loading } = useRecipePhotoShows();
  const [photo, setPhoto] = React.useState(false);
  // `?photo=1` (My recipes' entry), read once the page is on screen: a client navigation commits the address after the first render.
  React.useEffect(() => {
    if (photoRequested(window.location.search)) setPhoto(true);
  }, []);
  const [fromForm, setFromForm] = React.useState(false);
  const [held, setHeld] = React.useState(false);
  React.useEffect(() => {
    if (photo && shows) setHeld(true);
  }, [photo, shows]);
  const back = useBack();

  if (photo && loading && !held) return <Skeleton className="h-8 w-48" aria-hidden />;
  if (photo && (shows || held)) {
    return (
      <RecipePhotoFlow
        onBack={() => {
          if (fromForm) setPhoto(false);
          else back();
        }}
        onTypeIt={() => {
          setHeld(false);
          setPhoto(false);
        }}
      />
    );
  }
  const top = shows ? (
    <button
      type="button"
      className={cn(ENTRY, AI_EDGE)}
      onClick={() => {
        setFromForm(true);
        setPhoto(true);
      }}
    >
      <EntryInside />
    </button>
  ) : null;
  return <RecipeFormScreen recipe={null} top={top} />;
}

type Phase = "pick" | "reading" | "result" | "problem" | "editor";
type Read = { draft: AiRecipeDraft; checks: AiRecipeCheck[]; start: DraftForm };

function Header({ onBack }: { onBack: () => void }) {
  return (
    <header className="flex items-center gap-2">
      <BackControl onClick={onBack} />
      <AiChip />
      <h1 className="min-w-0 flex-1 truncate text-xl font-extrabold">Recipe from a photo</h1>
    </header>
  );
}

const SHIMMER = `
@keyframes cookpool-photo-shimmer{0%{background-position:-200px 0}100%{background-position:200px 0}}
.cookpool-photo-sk{background:linear-gradient(90deg,#ECEEE9 0,#F6F7F4 40px,#ECEEE9 80px);background-size:400px 100%;animation:cookpool-photo-shimmer 1.2s linear infinite}
@media (prefers-reduced-motion: reduce){.cookpool-photo-sk{animation:none}}`;

function Thumb({ url, className }: { url: string | null; className?: string }) {
  return url ? (
    <img src={url} alt="" className={cn("shrink-0 rounded-[10px] object-cover", className)} />
  ) : (
    <span aria-hidden className={cn("block shrink-0 rounded-[10px] bg-[repeating-linear-gradient(#F3EAD9_0_9px,#E5D9C2_9px_10px)]", className)} />
  );
}

export function RecipePhotoFlow({ onBack, onTypeIt }: { onBack: () => void; onTypeIt: () => void }) {
  const read = useReadRecipePhoto();
  const save = useSaveRecipe();
  const router = useKitchenRouter();
  const [phase, setPhase] = React.useState<Phase>("pick");
  const [photoUrl, setPhotoUrl] = React.useState<string | null>(null);
  const [problem, setProblem] = React.useState<string | null>(null);
  const [error, setError] = React.useState<RecipePhotoError | null>(null);
  const [result, setResult] = React.useState<Read | null>(null);
  const [tab, setTab] = React.useState<"steps" | "lines">("steps");
  const [editor, setEditor] = React.useState<{ n: number; errors: RecipeFormErrors | null; focus: string | null }>({ n: 0, errors: null, focus: null });
  const [saving, setSaving] = React.useState(false);
  const [saveError, setSaveError] = React.useState<string | null>(null);
  const [elapsed, setElapsed] = React.useState(0);
  const abort = React.useRef<AbortController | null>(null);
  const urlRef = React.useRef<string | null>(null);
  const seq = React.useRef(0);

  const setPhoto = React.useCallback((url: string | null) => {
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    urlRef.current = url;
    setPhotoUrl(url);
  }, []);
  React.useEffect(
    () => () => {
      abort.current?.abort();
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    },
    [],
  );
  React.useEffect(() => {
    if (phase !== "reading") return;
    const t0 = Date.now();
    setElapsed(0);
    const t = window.setInterval(() => setElapsed(Date.now() - t0), 500);
    return () => window.clearInterval(t);
  }, [phase]);

  const take = (file: File) => {
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    setProblem(null);
    setError(null);
    setResult(null);
    setSaveError(null);
    setPhoto(null);
    setPhase("reading");
    void (async () => {
      let image: string;
      try {
        const shrunk = await shrinkReceiptPhoto(file, RECIPE_PHOTO_LONG_SIDE);
        if (controller.signal.aborted) return;
        setPhoto(URL.createObjectURL(shrunk.blob));
        image = shrunk.base64;
      } catch {
        if (controller.signal.aborted) return;
        setProblem(PHOTO_UNUSABLE);
        setPhase("pick");
        return;
      }
      const r = await read(image, controller.signal);
      if (controller.signal.aborted) return;
      if (!r.ok) {
        setError(recipePhotoError(r.error, r.status));
        setPhase("problem");
        return;
      }
      const start = formFromDraft(r.data.draft, r.data.checks, () => `ai_${(seq.current += 1)}`);
      setResult({ draft: r.data.draft, checks: r.data.checks, start });
      setTab("steps");
      setPhase("result");
    })();
  };

  const cancel = () => {
    abort.current?.abort();
    setPhoto(null);
    setPhase("pick");
  };

  const openEditor = (errors: RecipeFormErrors | null = null, focus: string | null = null) => {
    setEditor((e) => ({ n: e.n + 1, errors, focus }));
    setPhase("editor");
  };

  const saveRecipe = async () => {
    if (!result) return;
    const plan = photoSavePlan(result.draft, result.start.form);
    if (plan.kind === "editor") {
      openEditor(plan.errors);
      return;
    }
    setSaving(true);
    setSaveError(null);
    const r = await save({ recipeId: null, body: plan.body });
    setSaving(false);
    if (r.ok) {
      router.replace(recipeHref(r.data.recipe.id));
      return;
    }
    if (r.error.reason === "offline") return;
    if (r.status === 422) {
      const sent = { lineKeys: result.start.lineKeys, stepIndexes: result.draft.steps.map((_, i) => i), toolIndexes: result.draft.tools.map((_, i) => i) };
      openEditor(errorsFromDetails(r.error.details, sent, r.error.message));
      return;
    }
    setSaveError(r.error.message || "Couldn't save · try again");
  };

  if (phase === "editor" && result) {
    return (
      <RecipeFormScreen
        key={editor.n}
        recipe={null}
        start={{
          form: result.start.form,
          marks: result.start.marks,
          errors: editor.errors ?? (saveError ? { ...noErrors(), other: saveError } : null),
          kind: result.draft.kind,
          focus: editor.focus,
          onBack: () => setPhase("result"),
        }}
      />
    );
  }

  const toPick = () => {
    abort.current?.abort();
    setPhoto(null);
    setPhase("pick");
  };
  const headerBack = phase === "pick" ? onBack : phase === "reading" ? cancel : toPick;

  return (
    <div className="flex w-full max-w-xl flex-col gap-3 pb-40">
      <style>{SHIMMER}</style>
      <Header onBack={headerBack} />
      {phase === "pick" ? <Pick problem={problem} onPhoto={take} /> : null}
      {phase === "reading" ? (
        <div className="flex flex-col gap-2.5" aria-busy="true">
          <div className={cn("flex gap-3 rounded-[20px] p-3", AI_EDGE)}>
            <Thumb url={photoUrl} className="h-[84px] w-16" />
            <span className="flex flex-1 flex-col justify-center gap-2">
              <span className="text-[15px] font-extrabold">Reading the page…</span>
              <span role="status" className="text-[13px] font-bold text-[#165C3A]">
                {readingText(elapsed)}
              </span>
            </span>
          </div>
          <span className="cookpool-photo-sk block h-16 rounded-lg" aria-hidden />
          <span className="cookpool-photo-sk block h-16 rounded-lg" aria-hidden />
          <span className="cookpool-photo-sk block h-16 rounded-lg" aria-hidden />
          <Button type="button" variant="outline" className={cn(K_BUTTON, "self-center")} onClick={cancel}>
            Cancel
          </Button>
        </div>
      ) : null}
      {phase === "problem" && error ? (
        <div className="flex flex-col gap-3">
          <Thumb url={photoUrl} className="h-[120px] w-[92px] opacity-60" />
          <p role="alert" className="rounded-2xl bg-[#FDF1D6] px-4 py-3 text-[15px] font-extrabold text-[#5C3D00]">
            {error.title}
          </p>
          <div className="grid grid-cols-2 gap-2">
            {error.kind === "failed" ? (
              <Button type="button" className={K_BUTTON} onClick={toPick}>
                Try another photo
              </Button>
            ) : null}
            <Button type="button" variant="outline" className={cn(K_BUTTON, error.kind !== "failed" && "col-span-2")} onClick={onTypeIt}>
              Type it in
            </Button>
          </div>
        </div>
      ) : null}
      {phase === "result" && result ? (
        <Result
          read={result}
          photoUrl={photoUrl}
          tab={tab}
          onTab={setTab}
          saving={saving}
          saveError={saveError}
          onEdit={(focus) => openEditor(null, focus)}
          onSave={() => void saveRecipe()}
        />
      ) : null}
    </div>
  );
}

const BIG = "flex min-h-14 items-center justify-center gap-2 rounded-2xl text-base font-extrabold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

function Pick({ problem, onPhoto }: { problem: string | null; onPhoto: (file: File) => void }) {
  const camera = React.useRef<HTMLInputElement>(null);
  const photos = React.useRef<HTMLInputElement>(null);
  const [over, setOver] = React.useState(false);
  const take = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (file) onPhoto(file);
  };
  return (
    <div className="flex flex-col gap-2.5">
      <button
        type="button"
        onClick={() => photos.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          const file = Array.from(e.dataTransfer.files).find((f) => f.type.startsWith("image/"));
          if (file) onPhoto(file);
        }}
        className={cn(
          "flex h-[300px] flex-col items-center justify-center gap-2.5 rounded-3xl border-2 border-dashed bg-card p-5 text-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          over ? "border-[#1F7A4D] bg-[#E4F2EA]" : "border-[#C9CFC6]",
        )}
      >
        <span aria-hidden className="text-[44px]">📖</span>
        <span className="text-lg font-extrabold">A cookbook page, a handwritten card, a screenshot</span>
        <span className="text-[13px] font-semibold text-muted-foreground">One recipe per photo</span>
      </button>
      {problem ? (
        <p role="alert" className="rounded-xl bg-[#FDF1D6] px-3 py-2 text-center text-sm font-bold text-[#5C3D00]">
          {problem}
        </p>
      ) : null}
      <div className="grid grid-cols-2 gap-2">
        <button type="button" onClick={() => camera.current?.click()} className={cn(BIG, "bg-[#17201B] text-white hover:bg-[#2A332E]")}>
          <span aria-hidden>📷</span> Take a photo
        </button>
        <button type="button" onClick={() => photos.current?.click()} className={cn(BIG, "border border-[#C9CFC6] bg-card hover:bg-accent")}>
          From photos
        </button>
      </div>
      <input ref={camera} type="file" accept="image/*" capture="environment" className="sr-only" tabIndex={-1} aria-hidden onChange={take} />
      <input ref={photos} type="file" accept="image/*" className="sr-only" tabIndex={-1} aria-hidden onChange={take} />
    </div>
  );
}

function Result({
  read,
  photoUrl,
  tab,
  onTab,
  saving,
  saveError,
  onEdit,
  onSave,
}: {
  read: Read;
  photoUrl: string | null;
  tab: "steps" | "lines";
  onTab: (t: "steps" | "lines") => void;
  saving: boolean;
  saveError: string | null;
  onEdit: (focus: string | null) => void;
  onSave: () => void;
}) {
  const card = photoCard(read.draft, read.checks, read.start);
  const tabs = [
    { key: "steps" as const, label: card.stepsTab },
    { key: "lines" as const, label: card.linesTab },
  ];
  return (
    <>
      <div className={cn("flex items-center gap-3 rounded-[20px] p-3", AI_EDGE)}>
        <Thumb url={photoUrl} className="h-[68px] w-[52px]" />
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="text-lg font-extrabold">{card.title}</span>
          <span className="text-[13px] font-bold text-[#3F4842]">{card.meta}</span>
          {card.general.map((g) => (
            <span key={g} className="text-xs font-extrabold text-[#8A5A00]">
              ⚠ {g}
            </span>
          ))}
        </span>
      </div>
      <div role="tablist" className="grid grid-cols-2 gap-1 rounded-[14px] bg-[#ECEEE9] p-1">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            onClick={() => onTab(t.key)}
            className={cn("min-h-11 rounded-[11px] text-sm font-extrabold", tab === t.key ? "bg-card text-foreground" : "text-muted-foreground")}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tab === "steps" ? (
        <ol className="flex flex-col gap-2">
          {card.steps.map((s, i) => (
            <li
              key={s.n}
              className={cn("flex gap-2.5 rounded-2xl bg-card px-3 py-2.5", s.check ? "border-[1.5px] border-[#E8C77A]" : "border border-[#E3E6E0]")}
            >
              <span className="grid h-[26px] w-[26px] shrink-0 place-items-center rounded-full bg-[#17201B] text-xs font-extrabold text-white">{s.n}</span>
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="text-[15px] font-bold">{s.text}</span>
                {s.meta ? <span className="text-xs font-extrabold text-[#B4471F]">{s.meta}</span> : null}
                {s.check ? (
                  <span className="text-xs font-extrabold text-[#8A5A00]">
                    ⚠ {s.check} ·{" "}
                    <button type="button" className="min-h-6 underline" onClick={() => onEdit(`${read.start.stepIds[i]}-step`)}>
                      Change
                    </button>
                  </span>
                ) : null}
              </span>
            </li>
          ))}
          {card.steps.length === 0 ? <li className="text-sm font-semibold text-muted-foreground">No steps on the page</li> : null}
        </ol>
      ) : (
        <ul className="overflow-hidden rounded-[18px] border border-[#E3E6E0] bg-card">
          {card.lines.map((l) => (
            <li key={l.key} className="flex min-h-12 items-center gap-2.5 border-b border-[#ECEEE9] px-3.5 py-1.5 last:border-b-0">
              <span aria-hidden className={cn("h-2.5 w-2.5 shrink-0 rounded-full", l.check ? "bg-[#D97706]" : "bg-[#1F7A4D]")} />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="text-[15px] font-bold">{l.name}</span>
                {l.check ? (
                  <span className="text-xs font-extrabold text-[#8A5A00]">
                    ⚠ {l.check} ·{" "}
                    <button type="button" className="min-h-6 underline" onClick={() => onEdit(`${l.key}-name`)}>
                      Change
                    </button>
                  </span>
                ) : null}
              </span>
              <span className="text-sm font-extrabold tabular-nums">{l.amount}</span>
            </li>
          ))}
        </ul>
      )}
      <div
        data-toast-above=""
        className="fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+5.75rem)] z-30 flex flex-col gap-2 bg-gradient-to-t from-background from-75% to-transparent px-4 pb-3 pt-3 min-[900px]:static min-[900px]:bg-none min-[900px]:px-0"
      >
        <p className={cn("text-center text-xs font-bold", read.checks.length > 0 ? "text-[#8A5A00]" : "text-muted-foreground")}>{card.footer}</p>
        {saveError ? (
          <p role="alert" className="text-center text-sm font-bold text-cp-expired">
            {saveError}
          </p>
        ) : null}
        <div className="mx-auto grid w-full max-w-xl grid-cols-[1fr_2fr] gap-2">
          <Button type="button" variant="outline" className="min-h-14 rounded-[18px] text-[15px] font-extrabold" onClick={() => onEdit(null)}>
            Open in editor
          </Button>
          <Button type="button" className="min-h-14 rounded-[18px] text-base font-extrabold" loading={saving} onClick={onSave}>
            Save recipe
          </Button>
        </div>
      </div>
    </>
  );
}
