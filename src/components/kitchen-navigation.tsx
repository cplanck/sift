import Link from "next/link";
import styles from "./kitchen-navigation.module.css";

export type KitchenMode = "home" | "shop" | "cook";
export function KitchenNavigation({ active = "home", cookHref }: { active?: KitchenMode; cookHref?: string }) {
  return <nav aria-label="Kitchen modes" className={styles.navigation}>
    {(["home", "shop", "cook"] as const).map((mode) => <Link key={mode} prefetch={mode === "home" ? true : undefined} href={mode === "home" ? "/library" : mode === "cook" && cookHref ? cookHref : `/library?mode=${mode}`} aria-current={active === mode ? "page" : undefined} className={styles.mode}>{mode[0].toUpperCase() + mode.slice(1)}</Link>)}
  </nav>;
}
