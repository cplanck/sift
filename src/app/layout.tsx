import type { Metadata, Viewport } from "next";
import { Providers } from "@/components/providers";
import { appIconUrl } from "@/lib/app-icons";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Sift", template: "%s · Sift" },
  description: "Keep the recipes you love. Make them your own. Your personal cookbook, with a little help from Sift.",
  applicationName: "Sift",
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "Sift" },
  icons: { icon: [{ url: appIconUrl("favicon.svg"), type: "image/svg+xml" }, { url: appIconUrl("icon-32.png"), sizes: "32x32", type: "image/png" }], apple: [{ url: appIconUrl("apple-touch-icon.png"), sizes: "180x180", type: "image/png" }] },
};
export const viewport: Viewport = {
  width: "device-width", initialScale: 1, viewportFit: "cover",
  themeColor: [{ media: "(prefers-color-scheme: dark)", color: "#0b1010" }, { media: "(prefers-color-scheme: light)", color: "#fbfaf8" }],
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en" suppressHydrationWarning><head>
    {/* Recovery must run even when the Next.js bootstrap is itself stale. */}
    {/* eslint-disable-next-line @next/next/no-sync-scripts */}
    {process.env.NODE_ENV === "development" && <script src="/dev-reset.js" />}
  </head><body className="min-h-dvh antialiased">
    <a href="#main" className="sr-only rounded-xl bg-foreground p-3 text-background focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50">Skip to content</a>
    <Providers>{children}</Providers>
  </body></html>;
}
