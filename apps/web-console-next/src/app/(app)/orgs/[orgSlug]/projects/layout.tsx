import { redirect } from "next/navigation";
import { SOLO_MODE, orgHomePath } from "@/lib/solo-mode";

// Solo suppresses projects at the edge, so every page under here could only
// show "Route not found: /v1/organizations/<id>/projects". A stale link or a
// bookmark lands on the org's Account surface instead.
export default function ProjectsLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: { orgSlug: string };
}) {
  if (SOLO_MODE) redirect(orgHomePath(params.orgSlug));
  return children;
}
