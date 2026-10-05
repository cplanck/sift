import type { MetadataRoute } from "next";
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/", name: "Sift — Your personal cookbook", short_name: "Sift",
    description: "The recipes you love, all together.", start_url: "/", scope: "/",
    display: "standalone", background_color: "#141513", theme_color: "#141513",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
