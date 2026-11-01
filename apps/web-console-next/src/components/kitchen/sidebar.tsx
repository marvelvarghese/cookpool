"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { CookingPot, Plus, Settings } from "lucide-react";
import { cn } from "@/lib/cn";
import { initials } from "@/components/account/profile";
import { Skeleton } from "@/components/ui/skeleton";
import { useRecentGroupSlugs } from "@/lib/recent-groups";
import { KITCHEN_NAV_LINKS, isKitchenTabActive } from "./nav";
import { recentGroups } from "./groups";
import { kitchenIcon } from "./icons";
import { GroupAvatar, SoonBadge } from "./kit";
import { useGroups, useProfile } from "./data";

/** The cookpool wordmark: a pot in a green rounded square. */
export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <span aria-hidden className="grid h-9 w-9 place-items-center rounded-[11px] bg-primary text-primary-foreground">
        <CookingPot className="h-5 w-5" strokeWidth={2.2} />
      </span>
      <span className="text-xl font-extrabold tracking-tight">cookpool</span>
    </span>
  );
}

const ROW =
  "flex min-h-11 items-center gap-3 rounded-xl px-3 text-[15px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

/**
 * Cookpool's sidebar, from 900px (CP-5): the wordmark, "Cook a dish" and
 * "Add", the same destinations as the bottom tabs, the four most recent
 * groups and a link to all of them, and the signed-in person.
 */
export function KitchenSidebar({ onAdd, addOpen }: { onAdd: () => void; addOpen: boolean }) {
  const pathname = usePathname();
  const groups = useGroups();
  const recentSlugs = useRecentGroupSlugs();
  const recent = React.useMemo(
    () => recentGroups(groups.data ?? [], recentSlugs, 4),
    [groups.data, recentSlugs],
  );

  return (
    <aside
      aria-label="Cookpool"
      className="sticky top-0 hidden h-dvh w-64 shrink-0 flex-col border-r bg-card min-[900px]:flex"
    >
      <div className="px-5 pb-5 pt-6">
        <Link href="/home" aria-label="cookpool home" className="inline-flex rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <Wordmark />
        </Link>
      </div>

      <div className="space-y-2 px-4">
        {/* The dish maker arrives in CP4: shown, honestly not clickable yet. */}
        <button
          type="button"
          aria-disabled="true"
          className="flex h-12 w-full cursor-not-allowed items-center justify-center gap-2 rounded-2xl bg-cp-tomato px-4 text-[15px] font-bold text-white"
        >
          <CookingPot className="h-5 w-5" aria-hidden />
          Cook a dish
          <SoonBadge className="bg-white/20 text-white" />
        </button>
        <button
          type="button"
          onClick={onAdd}
          aria-haspopup="dialog"
          aria-expanded={addOpen}
          className="flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-input bg-card px-4 text-[15px] font-semibold transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Plus className="h-5 w-5" aria-hidden />
          Add
        </button>
      </div>

      <nav aria-label="Main" className="mt-5 px-3">
        <ul className="space-y-0.5">
          {KITCHEN_NAV_LINKS.map((link) => {
            const active = isKitchenTabActive(link.id, pathname);
            const Icon = kitchenIcon(link.icon);
            return (
              <li key={link.id}>
                <Link
                  href={link.href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    ROW,
                    active ? "bg-accent font-bold text-primary" : "font-medium text-foreground hover:bg-accent",
                  )}
                >
                  <Icon className="h-5 w-5" strokeWidth={active ? 2.4 : 1.9} aria-hidden />
                  {link.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <section aria-labelledby="sidebar-recent-groups" className="mt-6 min-h-0 flex-1 overflow-y-auto px-3">
        <h2 id="sidebar-recent-groups" className="px-3 pb-1 text-xs font-bold uppercase tracking-wider text-muted-foreground">
          Recent groups
        </h2>
        {groups.loading ? (
          <div className="space-y-2 px-3 py-1" aria-hidden>
            <Skeleton className="h-8 w-full rounded-lg" />
            <Skeleton className="h-8 w-4/5 rounded-lg" />
          </div>
        ) : recent.length === 0 ? (
          <p className="px-3 py-2 text-sm text-muted-foreground">No groups yet.</p>
        ) : (
          <ul className="space-y-0.5">
            {recent.map((g) => {
              const href = `/groups/${g.slug}`;
              const active = pathname === href;
              return (
                <li key={g.id}>
                  <Link
                    href={href}
                    aria-current={active ? "page" : undefined}
                    className={cn(ROW, "font-medium", active ? "bg-accent text-primary" : "hover:bg-accent")}
                  >
                    <GroupAvatar name={g.name} size="sm" className="h-7 w-7 rounded-lg text-[11px]" />
                    <span className="truncate">{g.name}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
        {groups.data && groups.data.length > 0 ? (
          <Link href="/groups" className={cn(ROW, "font-semibold text-primary hover:bg-accent")}>
            All {groups.data.length} {groups.data.length === 1 ? "group" : "groups"}
          </Link>
        ) : null}
      </section>

      <SidebarPerson />
    </aside>
  );
}

function SidebarPerson() {
  const profile = useProfile();
  const user = profile.data;
  const name = user?.displayName || user?.email?.split("@")[0] || "";
  return (
    <div className="flex items-center gap-3 border-t p-3">
      {user ? (
        <span aria-hidden className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-cp-herb-tint text-xs font-bold text-primary">
          {initials(user.displayName ?? null, user.email)}
        </span>
      ) : (
        <Skeleton className="h-9 w-9 rounded-full" />
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold">{name || " "}</p>
        {user?.email && user.email !== name ? (
          <p className="truncate text-xs text-muted-foreground">{user.email}</p>
        ) : null}
      </div>
      <Link
        href="/account"
        aria-label="Account settings"
        title="Account settings"
        className="grid h-11 w-11 shrink-0 place-items-center rounded-xl text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Settings className="h-5 w-5" aria-hidden />
      </Link>
    </div>
  );
}
