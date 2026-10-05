import type { Metadata, Viewport } from "next";
import { Providers } from "@/components/providers";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Sift — Your personal cookbook", template: "%s · Sift" },
  description: "Keep the recipes you love. Make them your own. Your personal cookbook, with a little help from Sift.",
  applicationName: "Sift",
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "Sift" },
  icons: { icon: [{ url: "/icons/favicon.svg", type: "image/svg+xml" }, { url: "/icons/icon-192.png", sizes: "192x192" }], apple: "/icons/apple-touch-icon.png" },
};
export const viewport: Viewport = {
  width: "device-width", initialScale: 1, viewportFit: "cover",
  themeColor: [{ media: "(prefers-color-scheme: dark)", color: "#141513" }, { media: "(prefers-color-scheme: light)", color: "#faf9f6" }],
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en" suppressHydrationWarning><body className="min-h-dvh antialiased">
    <a href="#main" className="fixed left-4 top-4 z-50 -translate-y-24 rounded-xl bg-foreground p-3 text-background focus:translate-y-0">Skip to content</a>
    <Providers>{children}</Providers>
  </body></html>;
}
