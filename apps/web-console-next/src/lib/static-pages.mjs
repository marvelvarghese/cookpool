// PAGES ARE FILES (Cookpool SM-2, cookpool-simpler design §1.2 item 1).
//
// These pages are prerendered by `next build`, and `scripts/pages-as-files.mjs`
// copies each one's HTML and RSC payload into `.open-next/assets`, so Workers
// Static Assets answers them without running the console Worker (whose cold
// start, a 16 MB OpenNext bundle, was most of the 1.4–2.6 s first byte).
//
// Two things make a prerendered App Router page work as a file:
//
// - A DYNAMIC SEGMENT HAS ONE FILE, prerendered for the placeholder `_`
//   (`/dishes/_`), which `_redirects` serves for every value. The page reads
//   the real value from the address (`usePathParam`), not `useParams()`,
//   which reports `_` there.
// - CLIENT NAVIGATIONS FETCH THE RSC PAYLOAD from the same path as the page
//   (`/home?_rsc=…`, header `RSC: 1`), which a static file cannot tell apart
//   from a page load. The inline script `rscFetchShim` (the root layout runs
//   it before Next's router) sends those requests for these pages to the
//   payload's own file (`/_rsc/home.rsc`) instead, so a client navigation
//   between them reaches no Worker either. Every other request passes
//   through untouched, and a payload that is not there (a dev server)
//   falls back to the original request.
//
// Plain JavaScript (with static-pages.d.mts beside it) so the build script
// and the app share this one table. Dependency-free.

/** The value a dynamic segment is prerendered for. */
export const PLACEHOLDER = "_";

/**
 * Cookpool's pages (the `(kitchen)` routes), sign-in, the OAuth return and the
 * entry page, by route: a `:name` segment is a dynamic one. The admin console
 * (`/orgs…`, `/account…`), `/onboarding` and `/demo` are not here: the Worker
 * keeps serving them.
 */
export const STATIC_PAGES = Object.freeze([
  "/",
  "/login",
  "/auth/callback",
  "/home",
  "/use",
  "/cook",
  "/cook/session",
  "/settle",
  "/you",
  "/you/settings",
  "/you/notifications",
  "/money",
  "/people",
  "/people/:subjectId",
  "/pantry",
  "/pantry/new",
  "/pantry/:itemRef",
  "/dishes/:dishRef",
  "/recipes/new",
  "/recipes/:recipeId",
  "/recipes/:recipeId/edit",
  "/explore",
  "/r/:code",
  "/groups",
  "/groups/:orgSlug",
  "/groups/:orgSlug/expense",
  "/groups/:orgSlug/settings",
  "/join/:code",
]);

const isParam = (segment) => segment.charAt(0) === ":";

/** `/home/` → `/home`; `/` stays. */
function normalize(pathname) {
  return pathname.length > 1 && pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
}

/** The route Next prerenders for a page: `/dishes/:dishRef` → `/dishes/_`. */
export function prerenderedRoute(pattern) {
  return pattern
    .split("/")
    .map((s) => (isParam(s) ? PLACEHOLDER : s))
    .join("/");
}

/** Where the page's HTML goes in the assets (`/home` → `/home.html`, `/` → `/index.html`). */
export function htmlFile(pattern) {
  const route = prerenderedRoute(pattern);
  return `${route === "/" ? "/index" : route}.html`;
}

/** Where the page's RSC payload goes in the assets (`/home` → `/_rsc/home.rsc`). */
export function rscFile(pattern) {
  const route = prerenderedRoute(pattern);
  return `/_rsc${route === "/" ? "/index" : route}.rsc`;
}

/**
 * The params a pathname gives a page pattern, as the address spells them
 * (still percent-encoded), or null when it is not that page.
 */
export function matchPage(pattern, pathname) {
  const want = pattern.split("/");
  const got = normalize(pathname).split("/");
  if (want.length !== got.length) return null;
  const params = {};
  for (let i = 0; i < want.length; i++) {
    const w = want[i];
    const g = got[i];
    if (isParam(w)) {
      if (!g) return null;
      params[w.slice(1)] = g;
    } else if (w !== g) {
      return null;
    }
  }
  return params;
}

/**
 * One param's value in a pathname, as the address spells it (still
 * percent-encoded, as `useParams()` gives it): `pathParam("/dishes/:dishRef",
 * "dishRef", "/dishes/dsh_1")` → `dsh_1`. The pattern may cover just the start
 * of the pathname (a layout's segment). Undefined when it does not match.
 */
export function pathParam(pattern, name, pathname) {
  if (!pathname) return undefined;
  const want = pattern.split("/").length;
  const got = pathname.split("/");
  if (got.length < want) return undefined;
  return matchPage(pattern, got.slice(0, want).join("/"))?.[name];
}

/** The page a pathname is, a page without params winning (`/pantry/new` is not an item). */
export function staticPageFor(pathname, pages = STATIC_PAGES) {
  const exact = pages.find((p) => !p.split("/").some(isParam) && matchPage(p, pathname));
  return exact ?? pages.find((p) => matchPage(p, pathname)) ?? null;
}

/**
 * Workers Static Assets `_redirects`: every value of a dynamic segment serves
 * the page prerendered for `_` (a 200 proxy, so the address stays). A page
 * without params that a dynamic rule would also catch (`/pantry/new`) is
 * pinned to itself first: static rules win, then the first matching one.
 */
export function redirectRules(pages = STATIC_PAGES) {
  const dynamic = pages.filter((p) => p.split("/").some(isParam));
  const pinned = pages.filter((p) => !dynamic.includes(p) && dynamic.some((d) => matchPage(d, p)));
  const deepestFirst = [...dynamic].sort((a, b) => b.split("/").length - a.split("/").length);
  return [...pinned.map((p) => `${p} ${p} 200`), ...deepestFirst.map((p) => `${p} ${prerenderedRoute(p)} 200`)];
}

/**
 * The inline script that sends Next's RSC requests for these pages to their
 * payload files (see the header). ES5, no globals but `window`, `URL` and
 * `Response`; installs once.
 */
export function rscFetchShim(pages = STATIC_PAGES) {
  const table = pages.map((p) => [p, rscFile(p)]);
  return `(function(t){var w=window,f=w.fetch;if(typeof f!=="function"||w.__staticPagesRsc)return;w.__staticPagesRsc=1;
function m(p,s){var a=p.split("/"),b=s.split("/");if(a.length!==b.length)return false;for(var i=0;i<a.length;i++){if(a[i].charAt(0)===":"){if(!b[i])return false}else if(a[i]!==b[i])return false}return true}
function file(s){if(s.length>1&&s.charAt(s.length-1)==="/")s=s.slice(0,-1);var i,d=null;for(i=0;i<t.length;i++){if(t[i][0].indexOf(":")<0){if(t[i][0]===s)return t[i][1]}else if(d===null&&m(t[i][0],s))d=t[i][1]}return d}
w.fetch=function(input,init){var args=arguments;try{var h=init&&init.headers;if(h&&(h.RSC==="1"||h.rsc==="1")&&(!init.method||init.method==="GET")){var u=new URL(typeof input==="string"?input:input.href||input.url,w.location.href);var to=u.origin===w.location.origin&&u.searchParams.has("_rsc")?file(u.pathname):null;if(to){var r=new URL(to,u);r.search=u.search;return f.call(w,r.href,init).then(function(res){if(!res.ok)return f.apply(w,args);var out=new Response(res.body,{status:200,headers:{"content-type":"text/x-component"}});Object.defineProperty(out,"url",{value:u.href});return out})}}}catch(e){}return f.apply(w,args)}})(${JSON.stringify(table)});`;
}
