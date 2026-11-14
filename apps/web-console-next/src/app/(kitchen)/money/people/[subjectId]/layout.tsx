import { PLACEHOLDER } from "@/lib/static-pages.mjs";
import { ParamShell } from "@/components/kitchen/param-shell";

// A static shell (Cookpool SM-2): prerendered once, for `_`, and served as a
// file for every person (src/lib/static-pages.mjs). The page reads the real
// value from the address, and is keyed by it, so another person is a fresh page.
export function generateStaticParams(): { subjectId: string }[] {
  return [{ subjectId: PLACEHOLDER }];
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <ParamShell pattern="/money/people/:subjectId" name="subjectId">
      {children}
    </ParamShell>
  );
}
