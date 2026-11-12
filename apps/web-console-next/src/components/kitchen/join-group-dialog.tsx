"use client";

import * as React from "react";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { extractJoinCode, joinPath } from "./join-code";
import { CLOSE_44, K_BUTTON, K_INPUT } from "./kit";
import { useKitchenRouter } from "./transition-ui";

/**
 * Join (CP-5): paste a join link or type its code, then continue to that
 * group's join page (`/join/<code>`), which shows the group before joining.
 */
export function JoinGroupDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const router = useKitchenRouter();
  const [value, setValue] = React.useState("");
  const [invalid, setInvalid] = React.useState(false);

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const code = extractJoinCode(value);
    if (!code) {
      setInvalid(true);
      return;
    }
    setValue("");
    setInvalid(false);
    onOpenChange(false);
    router.push(joinPath(code));
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          setValue("");
          setInvalid(false);
        }
        onOpenChange(next);
      }}
    >
      <DialogContent className={cn("rounded-[22px] sm:max-w-md", CLOSE_44)}>
        <DialogHeader>
          <DialogTitle className="text-xl font-medium">Join a group</DialogTitle>
          <DialogDescription>Paste the link someone sent you, or type its code.</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          <div className="space-y-2">
            <Label htmlFor="join-code-input">Link or code</Label>
            <Input
              id="join-code-input"
              value={value}
              onChange={(e) => {
                setValue(e.target.value);
                if (invalid) setInvalid(false);
              }}
              placeholder="KTCH-2345"
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              aria-invalid={invalid}
              aria-describedby={invalid ? "join-code-error" : "join-code-hint"}
              className={cn(K_INPUT, "font-mono tracking-wide")}
            />
            {invalid ? (
              <p id="join-code-error" className="text-sm font-medium text-destructive">
                That isn&apos;t a join link or code. A code is 8 letters and numbers, like KTCH-2345.
              </p>
            ) : (
              <p id="join-code-hint" className="text-xs text-muted-foreground">
                Dashes and spaces don&apos;t matter.
              </p>
            )}
          </div>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="ghost" className={K_BUTTON} onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" className={K_BUTTON} disabled={!value.trim()}>
              Continue
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
