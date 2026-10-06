"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { ChefHat, Play, X } from "lucide-react";
import { api } from "@/lib/client-http";
import styles from "./resume-cooking.module.css";

type ActiveCook = { sessionId: string; recipeId: string; title: string; currentStep: number; totalSteps: number };
const dismissedKey = "sift.resume-cooking.dismissed";
function dismissed(): string[] {
  try { return JSON.parse(sessionStorage.getItem(dismissedKey) ?? "[]"); } catch { return []; }
}

/** A floating "Resume cooking" card on every page except the cook itself. */
export function ResumeCooking() {
  const pathname = usePathname();
  const [cook, setCook] = useState<ActiveCook | null>(null);
  useEffect(() => {
    // Refresh on every navigation so a finished cook disappears and a new one appears.
    let cancelled = false;
    api<{ cooks: ActiveCook[] }>("/api/cooking-sessions").then(({ cooks }) => {
      if (!cancelled) setCook(cooks.find((item) => !dismissed().includes(item.sessionId)) ?? null);
    }).catch(() => { if (!cancelled) setCook(null); });
    return () => { cancelled = true; };
  }, [pathname]);
  if (!cook || pathname === `/recipes/${cook.recipeId}`) return null;
  const href = `/recipes/${cook.recipeId}?cook=${cook.sessionId}`;
  return <aside aria-label="Cooking in progress" className={styles.card}>
    <span aria-hidden="true" className={styles.icon}><ChefHat className="size-[18px]" /></span>
    <Link href={href} className={styles.body}>
      <span className="block truncate text-sm font-medium">{cook.title}</span>
      <span className="block text-xs text-muted-foreground">Cooking · Step {Math.min(cook.currentStep + 1, cook.totalSteps)} of {cook.totalSteps}</span>
    </Link>
    <Link href={href} className={styles.resume}><Play className="size-3.5 fill-current" />Resume</Link>
    <button type="button" aria-label="Hide for now" title="Hide for now" className={styles.close} onClick={() => {
      try { sessionStorage.setItem(dismissedKey, JSON.stringify([...dismissed(), cook.sessionId])); } catch { /* Hides until the next page either way. */ }
      setCook(null);
    }}><X className="size-4" /></button>
  </aside>;
}
