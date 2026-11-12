import type { MetadataRoute } from "next";

export const dynamic = "force-static";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Spliteco",
    short_name: "Spliteco",
    description: "Split every shared cost with the people you share it with.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#08111F",
    theme_color: "#08111F",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" }],
  };
}
