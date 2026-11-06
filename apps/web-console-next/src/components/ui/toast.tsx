"use client";

import * as React from "react";
import * as ToastPrimitive from "@radix-ui/react-toast";
import { X } from "lucide-react";
import { cn } from "@/lib/cn";
import { OFFLINE_WRITE_TEXT, isOfflineRefusal } from "@/lib/connection";

type ToastKind = "default" | "success" | "warning" | "error";

interface ToastItem {
  id: number;
  kind: ToastKind;
  title: string;
  description?: string | undefined;
  /**
   * One button beside the message (Cookpool's "Undo", CP-8). Pressing it runs
   * `onClick` and closes the toast.
   */
  action?: { label: string; onClick: () => void } | undefined;
  /** How long it stays, in ms (default 4500; Infinity until closed). */
  duration?: number | undefined;
  /**
   * The person closed it (its ✕, a swipe, its action) or it timed out; not
   * called for `dismiss` (Cookpool PW-4: an offer that comes back later).
   */
  onClose?: (() => void) | undefined;
}

export type ToastInput = Omit<ToastItem, "id">;

interface ToastCtx {
  /** Show a toast; the id it returns can change or close it. */
  toast: (t: ToastInput) => number;
  /**
   * Change a toast in place (Cookpool SM-5: an optimistic write's toast shows
   * at once, then takes the server's words, or its refusal). A new
   * `duration` restarts its timer. Unknown ids (already closed) are ignored.
   */
  update: (id: number, patch: Partial<ToastInput>) => void;
  /** Close a toast now. */
  dismiss: (id: number) => void;
}

const Ctx = React.createContext<ToastCtx | null>(null);

export function useToast(): ToastCtx {
  const c = React.useContext(Ctx);
  if (!c) throw new Error("useToast must be used inside ToastProvider");
  return c;
}

/**
 * A write held back offline (Cookpool PW-4) says so in one line, once: any
 * toast that only repeats it — the screen's own refusal, whose second line
 * is the same words — becomes that one line, or goes if it is already shown.
 */
const OFFLINE_TOAST: Omit<ToastItem, "id"> = { kind: "warning", title: OFFLINE_WRITE_TEXT, duration: 4000 };

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = React.useState<ToastItem[]>([]);
  const offlineId = React.useRef<number | null>(null);
  const toast = React.useCallback((t: ToastInput) => {
    if (isOfflineRefusal(t)) {
      if (offlineId.current !== null) return offlineId.current;
      const id = Date.now() + Math.random();
      offlineId.current = id;
      setItems((cur) => [...cur, { ...OFFLINE_TOAST, id }]);
      return id;
    }
    const id = Date.now() + Math.random();
    setItems((cur) => [...cur, { ...t, id }]);
    return id;
  }, []);
  const update = React.useCallback((id: number, patch: Partial<ToastInput>) => {
    if (isOfflineRefusal(patch)) {
      if (offlineId.current !== null && offlineId.current !== id) {
        setItems((cur) => cur.filter((x) => x.id !== id));
        return;
      }
      offlineId.current = id;
      setItems((cur) => cur.map((x) => (x.id === id ? { ...OFFLINE_TOAST, id } : x)));
      return;
    }
    setItems((cur) => cur.map((x) => (x.id === id ? { ...x, ...patch, id } : x)));
  }, []);
  const dismiss = React.useCallback((id: number) => {
    if (offlineId.current === id) offlineId.current = null;
    setItems((cur) => cur.filter((x) => x.id !== id));
  }, []);
  const value = React.useMemo(() => ({ toast, update, dismiss }), [toast, update, dismiss]);
  return (
    <Ctx.Provider value={value}>
      <ToastPrimitive.Provider swipeDirection="right">
        {children}
        {items.map((t) => (
          <ToastPrimitive.Root
            key={t.id}
            duration={t.duration ?? 4500}
            onOpenChange={(open) => {
              if (open) return;
              if (offlineId.current === t.id) offlineId.current = null;
              setItems((cur) => cur.filter((x) => x.id !== t.id));
              t.onClose?.();
            }}
            className={cn(
              "group pointer-events-auto relative flex w-full items-center gap-3 overflow-hidden rounded-lg border p-4 pr-8 shadow-lg",
              "data-[state=open]:animate-fade-in bg-popover text-popover-foreground",
              t.kind === "success" && "border-success/30",
              t.kind === "warning" && "border-warning/30",
              t.kind === "error" && "border-destructive/30",
            )}
          >
            <div className="grid min-w-0 flex-1 gap-1">
              <ToastPrimitive.Title className="text-sm font-semibold">{t.title}</ToastPrimitive.Title>
              {t.description && (
                <ToastPrimitive.Description className="text-xs text-muted-foreground">
                  {t.description}
                </ToastPrimitive.Description>
              )}
            </div>
            {t.action ? (
              <ToastPrimitive.Action
                altText={t.action.label}
                onClick={t.action.onClick}
                className="inline-flex min-h-11 shrink-0 items-center rounded-lg px-3 text-sm font-semibold text-primary transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {t.action.label}
              </ToastPrimitive.Action>
            ) : null}
            <ToastPrimitive.Close className="absolute right-2 top-2 rounded-md p-1 text-muted-foreground transition-colors hover:text-foreground">
              <X className="h-3.5 w-3.5" />
            </ToastPrimitive.Close>
          </ToastPrimitive.Root>
        ))}
        <ToastPrimitive.Viewport className="toast-viewport fixed bottom-0 right-0 z-[100] flex max-h-dvh w-full flex-col-reverse gap-2 p-4 sm:bottom-4 sm:right-4 sm:max-w-sm" />
      </ToastPrimitive.Provider>
    </Ctx.Provider>
  );
}
