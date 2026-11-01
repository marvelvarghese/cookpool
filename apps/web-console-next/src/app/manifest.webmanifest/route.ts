import { appConfig } from "@/lib/app-config";

// The web app manifest, built per request from the runtime config
// (saas-console-artifact CA2) instead of a static file in public/, so a console
// built from one tree names the product it is deployed as. The root layout's
// metadata links it at /manifest.webmanifest.
//
// The installed app is Cookpool (CP-5): it opens on Home, in the kitchen
// palette (warm-neutral background, herb-green theme). The admin console is
// still reachable inside it at /orgs and /account.
export const dynamic = "force-dynamic";

/** "cookpool" → "Cookpool": the product name as an app's home-screen label. */
function appName(productName: string): string {
  return productName.charAt(0).toUpperCase() + productName.slice(1);
}

export function GET(): Response {
  const config = appConfig();
  const name = appName(config.productName);
  const manifest = {
    name,
    short_name: name,
    description: "Cook together, share a pantry, and split what it costs.",
    start_url: "/home",
    scope: "/",
    display: "standalone",
    background_color: "#F6F7F4",
    theme_color: "#1F7A4D",
    orientation: "portrait-primary",
  };
  return new Response(JSON.stringify(manifest, null, 2), {
    headers: { "content-type": "application/manifest+json; charset=utf-8" },
  });
}
