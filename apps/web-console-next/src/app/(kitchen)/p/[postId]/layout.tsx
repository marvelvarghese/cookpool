import { PLACEHOLDER } from "@/lib/static-pages.mjs";
import { ParamShell } from "@/components/kitchen/param-shell";

// A static shell (Cookpool SM-2): prerendered once, for `_`, and served as a
// file for every post (src/lib/static-pages.mjs). The page reads the real
// value from the address.
export function generateStaticParams(): { postId: string }[] {
  return [{ postId: PLACEHOLDER }];
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <ParamShell pattern="/p/:postId" name="postId">
      {children}
    </ParamShell>
  );
}
