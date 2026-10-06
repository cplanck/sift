"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { Utensils, House, ShoppingCart } from "lucide-react";
import { api } from "@/lib/client-http";
import { SiftMark } from "./brand";
import { SheetTrigger } from "./ui/sheet";
import styles from "./mobile-navigation.module.css";

/** The mobile counterpart to the header navigation and desktop Sift launcher. */
export function MobileNavigation({ hidden, voiceActive }: { hidden: boolean; voiceActive: boolean }) {
  const pathname = usePathname(), params = useSearchParams();
  const sessionId = params.get("cook");
  const [lastCook, setLastCook] = useState<string | null>(null);
  const [cooks, setCooks] = useState<{ sessionId: string; recipeId: string }[]>([]);
  useEffect(() => {
    const controller = new AbortController();
    const refresh = () => {
      api<{ cooks: typeof cooks }>("/api/cooking-sessions", { signal: controller.signal }).then(({ cooks: saved }) => {
        if (controller.signal.aborted) return;
        if (saved.some((cook) => cook.sessionId === sessionId)) setLastCook(sessionId);
        setCooks(saved);
      }).catch(() => { /* Keep the last known active cook if temporarily offline. */ });
    };
    refresh();
    window.addEventListener("focus", refresh);
    return () => { controller.abort(); window.removeEventListener("focus", refresh); };
  }, [pathname, sessionId]);
  const mode = pathname.startsWith("/artifacts/") ? "shop"
    : pathname.startsWith("/recipes/") && pathname !== "/recipes/new" ? "cook"
    : pathname === "/library" ? params.get("mode") ?? "home" : "home";
  const activeCook = cooks.find((cook) => cook.sessionId === sessionId)
    ?? cooks.find((cook) => cook.sessionId === lastCook) ?? cooks[0];
  const cookHref = activeCook ? `/recipes/${activeCook.recipeId}?cook=${activeCook.sessionId}` : "/library?mode=cook";
  return <nav aria-label="Kitchen modes" className={styles.bar} hidden={hidden}>
    {[
      { mode: "home", label: "Home", href: "/library", icon: House },
      { mode: "shop", label: "Shop", href: "/library?mode=shop", icon: ShoppingCart },
      { mode: "cook", label: "Cook", href: cookHref, icon: Utensils },
    ].map(({ mode: item, label, href, icon: Icon }) => <Link key={item} href={href} prefetch={item === "home" ? true : undefined} aria-label={label} title={label} aria-current={mode === item ? "page" : undefined} className={styles.item}><Icon aria-hidden="true" /></Link>)}
    <SheetTrigger asChild><button id="mobile-sift-trigger" type="button" aria-label="Open Sift" title={voiceActive ? "Sift · Voice active" : "Sift"} aria-controls="sift-chat" className={`${styles.item} ${styles.agent}`}><span className={styles.orb}><SiftMark className="size-7" />{voiceActive && <span className={styles.live} />}</span></button></SheetTrigger>
  </nav>;
}
