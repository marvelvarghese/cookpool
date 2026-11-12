"use client";

import * as React from "react";
import { Pencil, Plus } from "lucide-react";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { K_BUTTON, K_BUTTON_QUIET } from "./kit";
import { ITEM_NOTE_MAX, NOTE_PLACEHOLDER, noteChange, noteCount, noteHint, noteTooLong } from "./item-note";

/**
 * Item notes on screen (Cookpool RC-3, the canvas's `ItemNote`), in the new
 * frame only — each caller asks `newFrame()`: the Note field under Bought's
 * details (and the item page's), the pantry row's third line, and the item
 * page's Note block with its one edit. A pencil glyph marks a note wherever
 * it shows; the hint says who sees it, and the count is a number.
 */

const LEGEND = "mb-2 block text-sm font-medium";

/** The pantry a note goes to, as the hint names it. */
export type NotePantry = { kind: "personal" } | { kind: "group"; name: string };

/**
 * "Note": at most 80 characters, "For Sunday's curry" until something is
 * typed; under it, who sees it ("Only you see it", "Everyone in Flat 4B sees
 * it") and how much of the 80 is used.
 */
export function NoteField({
  id,
  value,
  onChange,
  pantry,
  error,
  autoFocus = false,
  label = true,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  pantry: NotePantry;
  error?: string | undefined;
  autoFocus?: boolean;
  /** Show the "Note" label (the item page's block has its own heading). */
  label?: boolean;
}) {
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  return (
    <div className="space-y-2" data-field="note">
      {label ? (
        <label htmlFor={id} className={LEGEND}>
          Note
        </label>
      ) : null}
      <Textarea
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={NOTE_PLACEHOLDER}
        maxLength={ITEM_NOTE_MAX}
        rows={2}
        autoComplete="off"
        autoFocus={autoFocus}
        {...(label ? {} : { "aria-label": "Note" })}
        aria-invalid={!!error}
        aria-describedby={error ? `${errorId} ${hintId}` : hintId}
        className="min-h-[52px] resize-none rounded-xl px-3.5 py-3 text-base sm:text-[15px]"
      />
      {error ? (
        <p id={errorId} className="text-sm font-normal text-destructive">
          {error}
        </p>
      ) : null}
      <p id={hintId} className="flex items-baseline justify-between gap-3 text-[13px] font-normal text-muted-foreground">
        <span className="min-w-0">{noteHint(pantry)}</span>
        <span className="shrink-0 tabular-nums">{noteCount(value)}</span>
      </p>
    </div>
  );
}

/** The pantry row's third line: a small pencil and the note, one line, ellipsized. */
export function NoteLine({ note, className }: { note: string; className?: string }) {
  return (
    <span className={cn("mt-1 flex min-w-0 items-center gap-1.5 text-[13px] leading-snug text-muted-foreground", className)}>
      <Pencil className="h-3 w-3 shrink-0" aria-hidden />
      <span className="sr-only">Note: </span>
      <span className="min-w-0 truncate">{note}</span>
    </span>
  );
}

/**
 * The item page's Note: the note behind a pencil, and Change — or "Add a
 * note" when it has none. Change opens the field in place, with Save and
 * Cancel; saving an empty note removes it. Whoever may not change it (a
 * viewer, a member who did not buy it) sees the note and no buttons, and an
 * item without one shows them nothing.
 */
export function ItemNoteCard({
  note,
  pantry,
  canEdit,
  onSave,
  startEditing = false,
}: {
  note: string | null;
  pantry: NotePantry;
  canEdit: boolean;
  onSave: (note: string | null) => void;
  /** Open with the field showing (for tests; the page starts closed). */
  startEditing?: boolean;
}) {
  const [editing, setEditing] = React.useState(startEditing && canEdit);
  const [text, setText] = React.useState(note ?? "");
  if (note === null && !canEdit) return null;

  const open = () => {
    setText(note ?? "");
    setEditing(true);
  };
  const tooLong = noteTooLong(text);
  const save = () => {
    if (tooLong) return;
    const change = noteChange({ note }, text);
    setEditing(false);
    if (change) onSave(change.note);
  };
  const removing = note !== null && text.trim() === "";

  return (
    <section aria-labelledby="note-heading">
      <h2 id="note-heading" className="mb-0.5 text-[15px] font-medium">
        Note
      </h2>
      {editing ? (
        <div className="space-y-3 pb-3 pt-1">
          <NoteField
            id="item-note"
            value={text}
            onChange={setText}
            pantry={pantry}
            error={tooLong ? `Keep it to ${ITEM_NOTE_MAX} characters` : undefined}
            autoFocus
            label={false}
          />
          <div className="grid grid-cols-2 gap-2.5">
            <Button type="button" variant="ghost" className={K_BUTTON_QUIET} onClick={() => setEditing(false)}>
              Cancel
            </Button>
            <Button type="button" className={K_BUTTON} disabled={tooLong} onClick={save}>
              {removing ? "Remove" : "Save"}
            </Button>
          </div>
        </div>
      ) : note !== null ? (
        <div className="flex min-h-12 items-center gap-2.5">
          <Pencil className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
          <p className="min-w-0 flex-1 break-words py-2 text-sm font-normal text-muted-foreground">{note}</p>
          {canEdit ? (
            <button
              type="button"
              onClick={open}
              aria-label="Change the note"
              className="min-h-11 shrink-0 rounded-xl px-3 text-sm font-medium text-cp-accent-text hover:bg-cp-accent-tint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Change
            </button>
          ) : null}
        </div>
      ) : (
        <button
          type="button"
          onClick={open}
          className="flex min-h-[52px] w-full items-center gap-2 rounded-lg text-sm font-medium text-cp-accent-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Plus className="h-4 w-4" aria-hidden />
          Add a note
        </button>
      )}
    </section>
  );
}
