import type { Metadata, Viewport } from "next";
import "@fontsource-variable/plus-jakarta-sans";
import "./globals.css";
import { Providers } from "./providers";
import { THEME_SCRIPT } from "@/lib/theme";

export const metadata: Metadata = {
  title: "Spliteco",
  description: "Split every shared cost — groups, friends, six ways to split, itemized bills. The same account as Cookpool.",
  manifest: "/manifest.webmanifest",
  icons: { icon: [{ url: "/icon.svg", type: "image/svg+xml" }], apple: "/icon.svg" },
  appleWebApp: { capable: true, title: "Spliteco", statusBarStyle: "black-translucent" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#08111F",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        {/* The theme before first paint, so a light-theme person never sees a dark flash. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
