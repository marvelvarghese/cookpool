import type { Metadata, Viewport } from "next";
import "../styles/globals.css";
import { Providers } from "./providers";
import { DEFAULT_APP_CONFIG, consoleTitle } from "@/lib/app-config";
import { APPLE_TOUCH_ICON } from "@/lib/manifest";
import { rscFetchShim } from "@/lib/static-pages.mjs";
import { OfflineBanner } from "@/components/shell/offline-banner";
import { ServiceWorker } from "@/components/shell/service-worker";

// Static (Cookpool SM-2): the layout reads nothing from the request, so every
// page under it can be prerendered and served as a file. The product's
// identity is the compiled-in one, which the Worker's vars repeat
// (src/lib/app-config.ts); the environment is resolved in the browser.
export const metadata: Metadata = {
  title: consoleTitle(DEFAULT_APP_CONFIG),
  description: DEFAULT_APP_CONFIG.productDescription,
  manifest: "/manifest.webmanifest",
  // The pot mark (CP-23): the tab's icon, and the home-screen icon iOS uses.
  icons: { icon: [{ url: "/icons/icon.svg", type: "image/svg+xml" }], apple: APPLE_TOUCH_ICON },
  appleWebApp: {
    capable: true,
    title: DEFAULT_APP_CONFIG.productName,
    statusBarStyle: "black-translucent",
  },
};

// `viewport-fit=cover` enables `env(safe-area-inset-*)` on notched devices;
// theme-color tints the mobile browser chrome to match light/dark surfaces.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#09090b" },
  ],
};

// A production build's pages are files (src/lib/static-pages.mjs): its client
// navigations fetch their RSC payloads as files too. `next dev` has none.
const STATIC_RSC = process.env.NODE_ENV === "production";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-screen bg-background text-foreground antialiased">
        {/*
          esbuild's `keepNames` helper (`__name`) is referenced by the
          next-themes inline theme script in the @opennextjs/cloudflare build,
          but it isn't defined in the browser — so without this shim every page
          throws `ReferenceError: __name is not defined` and crashes before
          hydration. Define a no-op (returning the target) ahead of that script.
        */}
        <script
          dangerouslySetInnerHTML={{
            __html: "globalThis.__name=globalThis.__name||function(t){return t};",
          }}
        />
        {STATIC_RSC ? <script dangerouslySetInnerHTML={{ __html: rscFetchShim() }} /> : null}
        <Providers>
          {/*
            No signal, clean updates (Cookpool PW-4): the offline banner above
            every page, and the service worker (registered in production
            builds only) with its "New version · Reload" offer.
          */}
          <OfflineBanner />
          {children}
          <ServiceWorker />
        </Providers>
      </body>
    </html>
  );
}
