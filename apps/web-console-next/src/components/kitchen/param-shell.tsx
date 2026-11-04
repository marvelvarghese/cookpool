"use client";

import * as React from "react";
import { usePathParam } from "@/lib/page-param";

/**
 * The client half of a dynamic kitchen segment's layout (Cookpool SM-2). One
 * prerendered file serves every value of the segment, so Next sees the same
 * segment (`_`) for `/dishes/a` and `/dishes/b` and would keep the page
 * mounted between them; keying it by the value from the address remounts it,
 * as a page per value did before.
 */
export function ParamShell({ pattern, name, children }: { pattern: string; name: string; children: React.ReactNode }) {
  const value = usePathParam(pattern, name);
  return <React.Fragment key={value}>{children}</React.Fragment>;
}
