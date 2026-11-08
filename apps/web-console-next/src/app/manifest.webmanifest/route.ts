import { appConfig, requestAppConfig } from "@/lib/app-config";
import { newFrame } from "@/lib/features";
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

//
// The shortcuts follow the frame (cookpool-recipes RC-2): the new frame's
// where the request's host names an environment and it is not prod (stage's
// custom domain or workers.dev host). Where the environment cannot be told
// from the request, the manifest stays today's, so prod's can never change by
// a host this route does not know.
export function GET(request?: Request): Response {
  const host = request ? new URL(request.url).host : null;
  const config = host ? requestAppConfig(host) : appConfig();
  const known = host !== null && config.deployEnv !== undefined;
  const manifest = buildManifest(config.productName, { newFrame: known && newFrame(config) });
  return new Response(JSON.stringify(manifest, null, 2), {
    headers: { "content-type": "application/manifest+json; charset=utf-8" },
  });
}
