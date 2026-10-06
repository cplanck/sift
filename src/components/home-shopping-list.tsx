"use client";

import Link from "next/link";
import { ArrowRight, ShoppingBasket } from "lucide-react";
import type { ArtifactSummary } from "@/domain/artifact";
import { useShoppingLists } from "./use-shopping-lists";
import styles from "./library.module.css";

export function HomeShoppingList({ initial }: { initial: ArtifactSummary[] }) {
  const { active, loading } = useShoppingLists(initial);
  if (loading || !active) return null;
  return <Link href={`/artifacts/${active.id}`} className={styles.currentList} aria-label={`Open selected shopping list: ${active.title}`}>
    <ShoppingBasket className={styles.currentListIcon} size={20} strokeWidth={1.5} aria-hidden="true" />
    <span className={styles.currentListCopy}>
      <span className={styles.currentListTitle}>{active.title}</span>
    </span>
    <span className={styles.currentListAction}>Open list <ArrowRight size={15} aria-hidden="true" /></span>
  </Link>;
}
