import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // `@saas/sdk` and `@saas/kitchen-engine` are workspace-source packages:
  // their exports point at TypeScript with NodeNext-style `./*.js`
  // specifiers, so they go through SWC with a .js → .ts alias (as in
  // apps/web-console-next).
  transpilePackages: ["@saas/sdk", "@saas/kitchen-engine", "@saas/spliteco-ui"],
  webpack(config) {
    config.resolve = config.resolve || {};
    config.resolve.extensionAlias = {
      ...(config.resolve.extensionAlias || {}),
      ".js": [".ts", ".tsx", ".js"],
    };
    return config;
  },
  // Required by @opennextjs/cloudflare.
  output: "standalone",
  outputFileTracingRoot: path.join(__dirname, "../.."),
  typescript: { ignoreBuildErrors: false },
  eslint: { ignoreDuringBuilds: true },
  // `next dev` has no Worker in front of it: send the app's same-origin API
  // calls to a local API (tests/spliteco-worker/src/dev-server.ts by default).
  async rewrites() {
    if (process.env.NODE_ENV !== "development") return [];
    const api = process.env.SPLITECO_DEV_API ?? "http://localhost:8787";
    return [{ source: "/api/:path*", destination: `${api}/:path*` }];
  },
};

export default nextConfig;
