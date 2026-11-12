"use client";

import * as React from "react";
import Link from "next/link";
import { ChevronDown, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/cn";
import { HELP_SAFETY, HELP_SUBTITLE, HELP_TITLE, type HelpItem } from "./sign-in-screens";
import { BackBar } from "./sign-in-screens-ui";

/**
 * Can't sign in? (Cookpool PK-3, `AuthHelp`): four problems that open in
 * place, one at a time, each with its tips and one way forward, and the
 * safety note. Nothing on it depends on whether an address has an account.
 */

const CTA =
  "flex min-h-[50px] items-center justify-center rounded-[14px] px-4 text-[15px] font-extrabold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2";
const CTA_PRIMARY = "bg-primary text-primary-foreground hover:bg-[#165C3A]";
const CTA_QUIET = "border border-input bg-card text-foreground hover:bg-accent";

export function HelpScreen({
  items,
  backHref,
  signInHref,
  writeHref,
  onGoogle,
  googleBusy,
}: {
  items: HelpItem[];
  backHref: string;
  signInHref: string;
  writeHref: string;
  onGoogle: () => void;
  googleBusy: boolean;
}) {
  const [open, setOpen] = React.useState<HelpItem["id"] | null>(null);
  return (
    <section aria-labelledby="help-title" className="flex flex-col gap-3.5">
      <BackBar href={backHref} />
      <div className="flex flex-col gap-2">
        <h1 id="help-title" className="text-[28px] font-extrabold leading-[1.15] tracking-[-0.025em] min-[900px]:text-[30px]">
          {HELP_TITLE}
        </h1>
        <p className="text-[15px] leading-normal text-[#3F4842]">{HELP_SUBTITLE}</p>
      </div>

      <div className="flex flex-col gap-2">
        {items.map((it) => {
          const on = open === it.id;
          const panelId = `help-${it.id}`;
          const cls = cn(CTA, it.primary ? CTA_PRIMARY : CTA_QUIET);
          return (
            <div
              key={it.id}
              className={cn("overflow-hidden rounded-[18px] bg-card", on ? "border-[1.5px] border-primary" : "border")}
            >
              <button
                type="button"
                aria-expanded={on}
                aria-controls={panelId}
                onClick={() => setOpen(on ? null : it.id)}
                className="flex min-h-14 w-full items-center gap-3 px-3.5 text-left text-base font-extrabold text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
              >
                <span className="flex-1">{it.question}</span>
                <ChevronDown
                  aria-hidden
                  strokeWidth={2}
                  className={cn("h-[18px] w-[18px] shrink-0 transition-transform", on && "rotate-180")}
                />
              </button>
              {on ? (
                <div id={panelId} className="flex flex-col gap-2.5 px-3.5 pb-3.5">
                  <ul className="flex flex-col gap-2.5">
                    {it.tips.map((tip) => (
                      <li key={tip} className="flex gap-2.5 text-sm leading-[1.45] text-[#3F4842]">
                        <span aria-hidden className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                        <span>{tip}</span>
                      </li>
                    ))}
                  </ul>
                  {it.action === "google" ? (
                    <button type="button" onClick={onGoogle} disabled={googleBusy} className={cn(cls, "disabled:opacity-70")}>
                      {it.cta}
                    </button>
                  ) : it.action === "write" ? (
                    <a href={writeHref} className={cls}>
                      {it.cta}
                    </a>
                  ) : (
                    <Link href={signInHref} className={cls}>
                      {it.cta}
                    </Link>
                  )}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>

      <div className="flex items-start gap-3 rounded-[18px] border bg-card p-3.5">
        <ShieldCheck aria-hidden strokeWidth={2} className="h-[22px] w-[22px] shrink-0 text-primary" />
        <span className="text-[13px] leading-normal text-[#3F4842]">{HELP_SAFETY}</span>
      </div>
    </section>
  );
}
