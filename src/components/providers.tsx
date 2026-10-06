"use client";

import { ThemeProvider, useTheme } from "next-themes";
import { useEffect, useState } from "react";
import { Moon, Sun, Monitor, WifiOff } from "lucide-react";
import { Button } from "@/components/ui/button";

export function Providers({ children }: { children: React.ReactNode }) {
  return <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>{children}<BrowserStatus /></ThemeProvider>;
}

export function ThemeToggle({ showLabel = false }: { showLabel?: boolean }) {
  const { theme, setTheme } = useTheme();
  return <Button variant="ghost" size={showLabel ? "default" : "icon"} className={showLabel ? "w-full justify-start" : undefined} aria-label="Change color theme" onClick={() => setTheme(theme === "system" ? "dark" : theme === "dark" ? "light" : "system")}>
    <Monitor className="theme-system" /><Moon className="theme-dark" /><Sun className="theme-light" />
    {showLabel && <span>Color theme</span>}
  </Button>;
}

function BrowserStatus() {
  const [offline, setOffline] = useState(false);
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null);
  useEffect(() => {
    const update = () => setOffline(!navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    if (process.env.NODE_ENV === "production" && "serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js", { updateViaCache: "none" }).then((registration) => {
        if (registration.waiting) setWaiting(registration.waiting);
        registration.addEventListener("updatefound", () => {
          const worker = registration.installing;
          worker?.addEventListener("statechange", () => {
            if (worker.state === "installed" && navigator.serviceWorker.controller) setWaiting(worker);
          });
        });
      }).catch(() => { /* The web application remains usable if installation is unavailable. */ });
    }
    return () => { window.removeEventListener("online", update); window.removeEventListener("offline", update); };
  }, []);
  return <>
    {offline && <div role="status" className="fixed inset-x-0 top-0 z-50 flex flex-wrap justify-center gap-2 bg-foreground p-2 text-sm text-background"><WifiOff size={16} /> You’re offline. Changes won’t save. <a href="/offline.html" className="underline underline-offset-2">Open saved recipes</a></div>}
    {waiting && <div role="status" className="fixed bottom-6 left-1/2 z-50 flex -translate-x-1/2 items-center gap-4 rounded-2xl border bg-background p-4 shadow-lg">
      <span className="text-sm">An update is ready.</span><Button size="sm" onClick={() => {
        navigator.serviceWorker.addEventListener("controllerchange", () => window.location.reload(), { once: true });
        waiting.postMessage({ type: "ACTIVATE_UPDATE" });
      }}>Reload</Button>
    </div>}
  </>;
}
