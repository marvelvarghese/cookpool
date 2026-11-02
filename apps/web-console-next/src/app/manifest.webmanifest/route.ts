import { appConfig } from "@/lib/app-config";
import { buildManifest } from "@/lib/manifest";

// The web app manifest, built per request from the runtime config
// (saas-console-artifact CA2) instead of a static file in public/, so a console
// built from one tree names the product it is deployed as. The root layout's
// metadata links it at /manifest.webmanifest.
//
// The installed app is Cookpool (CP-5): it opens on Home, in the kitchen
// palette (warm-neutral background, herb-green theme), with the pot mark as its
// icon (CP-23: 192, 512 and a maskable 512, in public/icons). The admin
// console is still reachable inside it at /orgs and /account.
export const dynamic = "force-dynamic";

export function GET(): Response {
  const manifest = buildManifest(appConfig().productName);
  return new Response(JSON.stringify(manifest, null, 2), {
    headers: { "content-type": "application/manifest+json; charset=utf-8" },
  });
}
