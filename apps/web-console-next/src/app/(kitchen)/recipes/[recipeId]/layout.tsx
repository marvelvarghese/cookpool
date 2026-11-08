import { PLACEHOLDER } from "@/lib/static-pages.mjs";
import { ParamShell } from "@/components/kitchen/param-shell";

// A static shell (Cookpool SM-2): prerendered once, for `_`, and served as a
// file for every recipe and its edit page (src/lib/static-pages.mjs). The
// pages read the real value from the address.
export function generateStaticParams(): { recipeId: string }[] {
  return [{ recipeId: PLACEHOLDER }];
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <ParamShell pattern="/recipes/:recipeId" name="recipeId">
      {children}
    </ParamShell>
  );
}
