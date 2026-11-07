"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { CookingPot, Plus, Settings } from "lucide-react";
import { cn } from "@/lib/cn";
import { Skeleton } from "@/components/ui/skeleton";
import { useRecentGroupSlugs } from "@/lib/recent-groups";
import { KITCHEN_SIDEBAR_LINKS, isSidebarLinkActive } from "./nav";
import { recentGroups } from "./groups";
import { kitchenIcon } from "./icons";
import { GroupAvatar } from "./kit";
import { useGroups, useProfile } from "./data";
import { personInitials, shownName } from "./you";

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
 * Cookpool's sidebar, from 900px (CP-5): the wordmark, one green "Add" (the
 * tab bar's + Add: Used · Cooked · Bought · Paid a bill — SM-15 dropped the
 * separate "Cook a dish", the same thing twice), the same destinations as the bottom tabs,
 * the four most recent groups and a link to all of them, and the signed-in
 * person. "Me" and the person at the foot open You (SI-6); the gear beside
 * the person opens the admin console's account page, as before.
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

      <div className="px-4">
        {/* One way in, as the tab bar's + Add (SM-15): Used · Cooked · Bought · Paid a bill. */}
        <button
          type="button"
          onClick={onAdd}
          aria-haspopup="dialog"
          aria-expanded={addOpen}
          className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-primary px-4 text-[15px] font-bold text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          <Plus className="h-5 w-5" aria-hidden />
          Add
        </button>
      </div>

      <nav aria-label="Main" className="mt-5 px-3">
        <ul className="space-y-0.5">
          {KITCHEN_SIDEBAR_LINKS.map((link) => {
            const active = isSidebarLinkActive(link.id, pathname);
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
  const name = user ? shownName(user) : "";
  return (
    <div className="flex items-center gap-1 border-t p-3">
      <Link
        href="/you"
        aria-label={name ? `You: ${name}` : "You"}
        className="flex min-h-11 min-w-0 flex-1 items-center gap-3 rounded-xl px-1 py-1 transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {user ? (
          <span aria-hidden className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-cp-herb-tint text-xs font-bold text-primary">
            {personInitials(user)}
          </span>
        ) : (
          <Skeleton className="h-9 w-9 rounded-full" />
        )}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold">{name || " "}</span>
          {user?.email && user.email !== name ? (
            <span className="block truncate text-xs text-muted-foreground">{user.email}</span>
          ) : null}
        </span>
      </Link>
      <Link
        href="/account"
        aria-label="Admin console"
        title="Admin console"
        className="grid h-11 w-11 shrink-0 place-items-center rounded-xl text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Settings className="h-5 w-5" aria-hidden />
      </Link>
    </div>
  );
}
