import { useParams, usePathname } from "next/navigation";
import { pathParam } from "./static-pages.mjs";

/**
 * The value of a dynamic segment of the page being shown (Cookpool SM-2), as
 * the address spells it. The kitchen's dynamic pages are files prerendered
 * once, for the placeholder `_` (src/lib/static-pages.mjs), so `useParams()`
 * says `_` there: the value is read from the address instead. A page the
 * Worker rendered gives the same answer either way.
 */
export function usePathParam(pattern: string, name: string): string {
  const pathname = usePathname();
  const params = useParams<Record<string, string | string[]>>();
  const fromPath = pathParam(pattern, name, pathname);
  if (fromPath !== undefined) return fromPath;
  const value = params?.[name];
  return typeof value === "string" ? value : "";
}
