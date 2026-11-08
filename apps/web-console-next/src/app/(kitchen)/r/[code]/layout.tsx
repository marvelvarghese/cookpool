import { PLACEHOLDER } from "@/lib/static-pages.mjs";
import { ParamShell } from "@/components/kitchen/param-shell";

// A static shell (Cookpool SM-2): prerendered once, for `_`, and served as a
// file for every recipe link (src/lib/static-pages.mjs). The page reads the
// real code from the address.
export function generateStaticParams(): { code: string }[] {
  return [{ code: PLACEHOLDER }];
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <ParamShell pattern="/r/:code" name="code">
      {children}
    </ParamShell>
  );
}
