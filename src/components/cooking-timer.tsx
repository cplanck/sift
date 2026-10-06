"use client";

import { useSyncExternalStore } from "react";
import { Timer } from "lucide-react";
import { cookingElapsedTime } from "@/domain/cooking-elapsed";
import styles from "./cooking-timer.module.css";

function subscribeClock(listener: () => void) {
  const interval = window.setInterval(listener, 1000);
  window.addEventListener("focus", listener);
  document.addEventListener("visibilitychange", listener);
  return () => {
    window.clearInterval(interval);
    window.removeEventListener("focus", listener);
    document.removeEventListener("visibilitychange", listener);
  };
}
const clockSnapshot = () => Math.floor(Date.now() / 1000) * 1000;
const subscribeFinished = () => () => {};

export function CookingTimer({ startedAt, finishedAt, initialNow }: { startedAt: string; finishedAt: string | null; initialNow: number }) {
  const now = useSyncExternalStore(finishedAt ? subscribeFinished : subscribeClock, clockSnapshot, () => initialNow);
  const elapsed = cookingElapsedTime(startedAt, finishedAt, now);
  return <span className={styles.elapsed} title={finishedAt ? "Total cooking time" : "Time since you started cooking"}>
    <Timer size={14} aria-hidden="true" />
    <span>{finishedAt ? "Cooked for" : "Cooking"}</span>
    <span role="timer" aria-label="Elapsed cooking time" aria-live="off" className={styles.time}>{elapsed}</span>
  </span>;
}
