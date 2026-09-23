import type { MetadataRoute } from "next";

// Colors repeat DESIGN.md --bg and --accent: the manifest cannot read CSS variables.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "superfer",
    short_name: "superfer",
    description: "Personal mail client",
    start_url: "/inbox",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#0A0E12",
    theme_color: "#0A0E12",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
      { src: "/icons/icon.svg", sizes: "any", type: "image/svg+xml" },
    ],
  };
}
