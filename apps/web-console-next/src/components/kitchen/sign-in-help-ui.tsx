"use client";

import * as React from "react";
import Link from "next/link";
import { ChevronDown, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/cn";
import { HELP_SAFETY, HELP_SUBTITLE, HELP_TITLE, PRIVACY_LINES, PRIVACY_TITLE, type HelpItem } from "./sign-in-screens";
import { PRIVACY_SECTION_ID } from "./sign-in";
import { BackBar } from "./sign-in-screens-ui";

/**
 * Can't sign in? (Cookpool PK-3, `AuthHelp`): four problems that open in
 * place, one at a time, each with its tips and one way forward, the safety
 * note, and Privacy and terms (RV-18, `#privacy`). Nothing on it depends on
 * whether an address has an account. The cards have no border; the open one
 * is on the tint.
 */

const CTA =
  "flex min-h-[50px] items-center justify-center rounded-[14px] px-4 text-[15px] font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2";
const CTA_PRIMARY = "bg-primary text-primary-foreground hover:bg-primary/90";
const CTA_QUIET = "bg-cp-accent-tint text-cp-accent-text hover:bg-cp-accent-tint/80";

export function HelpScreen({
  items,
  backHref,
  signInHref,
  writeHref,
  onGoogle,
  googleBusy,
  privacyWriteHref = null,
}: {
  items: HelpItem[];
  backHref: string;
  signInHref: string;
  writeHref: string;
  onGoogle: () => void;
  googleBusy: boolean;
  /** "Write to us" under Privacy and terms, when the console has a contact address. */
  privacyWriteHref?: string | null;
}) {
  const [open, setOpen] = React.useState<HelpItem["id"] | null>(null);
  return (
    <section aria-labelledby="help-title" className="flex flex-col gap-3.5">
      <BackBar href={backHref} />
      <div className="flex flex-col gap-2">
        <h1 id="help-title" className="text-[28px] font-medium leading-[1.15] tracking-[-0.025em] min-[900px]:text-[30px]">
          {HELP_TITLE}
        </h1>
        <p className="text-[15px] leading-normal text-muted-foreground">{HELP_SUBTITLE}</p>
      </div>

      <div className="flex flex-col gap-2">
        {items.map((it) => {
          const on = open === it.id;
          const panelId = `help-${it.id}`;
          const cls = cn(CTA, it.primary ? CTA_PRIMARY : CTA_QUIET);
          return (
            <div
              key={it.id}
              className="overflow-hidden rounded-[18px] bg-card shadow-cp-card"
            >
              <button
                type="button"
                aria-expanded={on}
                aria-controls={panelId}
                onClick={() => setOpen(on ? null : it.id)}
                className="flex min-h-14 w-full items-center gap-3 px-3.5 text-left text-base font-medium text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
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
                      <li key={tip} className="flex gap-2.5 text-sm leading-[1.45] text-muted-foreground">
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

      <div className="flex items-start gap-3 rounded-cp-card bg-card shadow-cp-card p-3.5">
        <ShieldCheck aria-hidden strokeWidth={2} className="h-[22px] w-[22px] shrink-0 text-primary" />
        <span className="text-[13px] leading-normal text-muted-foreground">{HELP_SAFETY}</span>
      </div>

      <section id={PRIVACY_SECTION_ID} aria-labelledby="privacy-title" className="flex scroll-mt-4 flex-col gap-2 pt-2">
        <h2 id="privacy-title" className="text-[17px] font-medium leading-snug">
          {PRIVACY_TITLE}
        </h2>
        <div className="flex flex-col gap-2 rounded-cp-card bg-card p-3.5 text-sm font-normal leading-[1.45] text-muted-foreground shadow-cp-card">
          {PRIVACY_LINES.map((line) => (
            <p key={line}>{line}</p>
          ))}
          {privacyWriteHref ? (
            <a href={privacyWriteHref} className="self-start rounded font-medium text-cp-accent-text underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              Write to us with any question
            </a>
          ) : null}
        </div>
      </section>
    </section>
  );
}
