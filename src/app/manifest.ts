import type { MetadataRoute } from "next";
import { appIconUrl } from "@/lib/app-icons";
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/", name: "Sift", short_name: "Sift",
    description: "The recipes you love, all together.", start_url: "/", scope: "/",
    display: "standalone", background_color: "#0b1010", theme_color: "#0b1010",
    icons: [
      { src: appIconUrl("icon-192.png"), sizes: "192x192", type: "image/png", purpose: "any" },
      { src: appIconUrl("icon-512.png"), sizes: "512x512", type: "image/png", purpose: "any" },
      { src: appIconUrl("maskable-512.png"), sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
