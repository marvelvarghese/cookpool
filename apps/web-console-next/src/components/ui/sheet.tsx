"use client";

import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn } from "@/lib/cn";
import { useSheetDrag } from "./sheet-drag";

/**
 * Sheet — a slide-out panel built on Radix Dialog (no new dependency). Used for
 * the mobile navigation drawer and any side-anchored surface. Shares the
 * Dialog a11y model (focus trap, escape, scroll lock). A bottom sheet also
 * drags down to close (Cookpool PW-7, `useSheetDrag`), as ✕ closes it.
 */
export const Sheet = DialogPrimitive.Root;
export const SheetTrigger = DialogPrimitive.Trigger;
export const SheetClose = DialogPrimitive.Close;
export const SheetPortal = DialogPrimitive.Portal;

const SheetOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      // Solid scrim (no backdrop-blur) so the slide stays at 60fps on mobile.
      "fixed inset-0 z-50 bg-black/50 data-[state=open]:animate-fade-in data-[state=closed]:animate-fade-out",
      className,
    )}
    {...props}
  />
));
SheetOverlay.displayName = "SheetOverlay";

type Side = "left" | "right" | "top" | "bottom";

const sideClasses: Record<Side, string> = {
  left: "inset-y-0 left-0 h-full w-72 max-w-[85vw] border-r pl-safe",
  right: "inset-y-0 right-0 h-full w-72 max-w-[85vw] border-l pr-safe",
  top: "inset-x-0 top-0 w-full border-b pt-safe",
  bottom: "inset-x-0 bottom-0 w-full border-t pb-safe",
};

// Directional enter/exit so the panel slides in from (and back out to) its edge.
const sideAnim: Record<Side, string> = {
  left: "data-[state=open]:animate-slide-in-left data-[state=closed]:animate-slide-out-left",
  right: "data-[state=open]:animate-slide-in-right data-[state=closed]:animate-slide-out-right",
  top: "data-[state=open]:animate-slide-in-bottom data-[state=closed]:animate-slide-out-bottom",
  bottom: "data-[state=open]:animate-slide-in-bottom data-[state=closed]:animate-slide-out-bottom",
};

export const SheetContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & { side?: Side; /** Replaces the scrim colour class (the default is black/50). */ scrimClassName?: string; /** Drops the built-in ✕ for a sheet that draws its own in its title row. */ bareClose?: boolean }
>(({ className, children, side = "left", scrimClassName, bareClose, ...props }, ref) => {
  const drag = useSheetDrag(side === "bottom");
  const { content } = drag;
  const contentRef = React.useCallback(
    (node: HTMLDivElement | null) => {
      content(node);
      if (typeof ref === "function") ref(node);
      else if (ref) ref.current = node;
    },
    [content, ref],
  );
  return (
    <SheetPortal>
      <SheetOverlay ref={drag.overlay} className={scrimClassName} />
      <DialogPrimitive.Content
        ref={contentRef}
        className={cn(
          "fixed z-50 flex flex-col gap-4 bg-card text-card-foreground p-4 shadow-xl will-change-transform",
          sideClasses[side],
          sideAnim[side],
          className,
        )}
        {...props}
      >
        {children}
        <DialogPrimitive.Close
          ref={drag.close}
          aria-hidden={bareClose ? true : undefined}
          tabIndex={bareClose ? -1 : undefined}
          className={cn("absolute right-2 top-2 inline-flex h-9 w-9 items-center justify-center rounded-md opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring", bareClose && "hidden")}
        >
          <X className="h-5 w-5" />
          <span className="sr-only">Close</span>
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </SheetPortal>
  );
});
SheetContent.displayName = "SheetContent";

export function SheetHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex flex-col space-y-1.5", className)} {...props} />;
}

export const SheetTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn("text-sm font-semibold tracking-tight", className)}
    {...props}
  />
));
SheetTitle.displayName = "SheetTitle";

export const SheetDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn("text-xs text-muted-foreground", className)}
    {...props}
  />
));
SheetDescription.displayName = "SheetDescription";
