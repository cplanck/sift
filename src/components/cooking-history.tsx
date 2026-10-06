"use client";
import Link from "next/link";
import { ChevronRight, CookingPot, StickyNote } from "lucide-react";
import type { CookingHistoryItem } from "@/domain/cooking";
import styles from "./cooking-history.module.css";

export function CookingHistory({ history }: { history: CookingHistoryItem[] }) {
  if (!history.length) return <section className={styles.empty} aria-label="Cooking history">
    <span className={styles.icon}><CookingPot size={28} strokeWidth={1.3} aria-hidden="true" /></span>
    <h2 className={styles.heading}>You’ve never made<br />this before.</h2>
    <p className={styles.description}>Your first cook starts the story. Start cooking to keep the date, your tweaks, and notes for next time.</p>
  </section>;
  return <section className="mb-6"><h2 className="mb-3 text-sm font-medium">Your past cooks</h2>
    <ul className="space-y-2">{history.map((cook) => <li key={cook.id}>
      <Link href={`/recipes/${cook.recipeId}?cook=${cook.id}`} className={styles.cookCard}>
        <span className={styles.cookInfo}>
          <span className="text-sm font-medium">{new Date(cook.finishedAt ?? cook.startedAt).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" })}</span>
          <span className={styles.cookMeta}>
            <span>{cook.status === "abandoned" ? "Ended early" : "Completed"}</span>
            {(cook.summary || cook.notes.length > 0) && <span className={styles.notesLabel}><StickyNote size={12} aria-hidden="true" />Notes</span>}
          </span>
        </span>
        <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      </Link>
    </li>)}</ul>
  </section>;
}
