"use client";

import * as React from "react";
import NextLink from "next/link";
import { newFrame } from "@/lib/features";
import { shareSourceOf, transitions, type ShareScope } from "@/lib/transitions";
import { linkTransition } from "./transitions";
import { navigate, transitionsReady } from "./transition-ui";

/**
 * The kitchen's Link (cookpool-recipes RC-11): next/link, with its API and
 * its markup, whose plain clicks in the new frame navigate with the step's
 * page transition (transition-ui.tsx). Everything else is next/link's own:
 * a modifier or middle click, `target`, another origin, the same screen,
 * another frame, or a browser without the View Transitions API.
 *
 * `share` names what the link opens (`shareKey("recipe", id)`): the card's
 * parts marked `sharePart("title" | "tile")` — inside the link, or in the
 * `data-vt-card` around it — carry into the page's matching parts.
 */

export type KitchenLinkProps = React.ComponentPropsWithoutRef<typeof NextLink> & {
  /** What the link opens, when a card's title and tile travel with it. */
  share?: string | undefined;
};

const Link = React.forwardRef<HTMLAnchorElement, KitchenLinkProps>(function Link({ share, onClick, ...props }, ref) {
  return (
    <NextLink
      ref={ref}
      {...props}
      onClick={(event) => {
        onClick?.(event);
        const plan = linkTransition(event, props.href, {
          newFrame: newFrame(),
          ready: transitionsReady(),
          supported: transitions.supported(),
          location: window.location,
        });
        if (!plan) return;
        // Ours from here: next/link sees it handled and stays out.
        event.preventDefault();
        navigate(plan.href, {
          kind: plan.kind,
          replace: props.replace,
          scroll: props.scroll,
          // (An element's parts are HTML or SVG elements: each has a `style`.)
          share: share ? shareSourceOf(event.currentTarget as unknown as ShareScope, share) : null,
        });
      }}
    />
  );
});

export default Link;
