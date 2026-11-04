import { PLACEHOLDER } from "@/lib/static-pages.mjs";
import { ParamShell } from "@/components/kitchen/param-shell";

// A static shell (Cookpool SM-2): prerendered once, for `_`, and served as a
// file for every group and its expense page (src/lib/static-pages.mjs). The
// pages read the real value from the address.
export function generateStaticParams(): { orgSlug: string }[] {
  return [{ orgSlug: PLACEHOLDER }];
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <ParamShell pattern="/groups/:orgSlug" name="orgSlug">
      {children}
    </ParamShell>
  );
}
