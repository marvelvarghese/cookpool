import { appConfig } from "@/lib/app-config";

// The web app manifest, built per request from the runtime config
// (saas-console-artifact CA2) instead of a static file in public/, so a console
// built from one tree names the product it is deployed as. The root layout's
// metadata links it at /manifest.webmanifest.
export const dynamic = "force-dynamic";

export function GET(): Response {
  const config = appConfig();
  const manifest = {
    name: `${config.productName} Console`,
    short_name: config.productName,
    description: "Control plane for your projects, environments, and entitlements.",
    start_url: "/orgs",
    scope: "/",
    display: "standalone",
    background_color: "#09090b",
    theme_color: "#09090b",
    orientation: "portrait-primary",
  };
  return new Response(JSON.stringify(manifest, null, 2), {
    headers: { "content-type": "application/manifest+json; charset=utf-8" },
  });
}
