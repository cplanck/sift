import { AppHeaderSkeleton, pageFrame } from "@/components/app-header";
import styles from "@/components/recipe-detail.module.css";

export default function LoadingRecipe() {
  return <div className={styles.screen}><AppHeaderSkeleton /><main id="main" className={`${pageFrame} ${styles.page}`} aria-busy="true" aria-label="Opening recipe">
    <div aria-hidden="true" className={`${styles.hero} motion-safe:animate-pulse`}>
      <div className={`${styles.photo} h-full rounded-2xl bg-muted`} />
      <div className="space-y-4 py-1"><div className="h-7 w-2/3 rounded-full bg-muted" /><div className="h-9 w-4/5 rounded-xl bg-muted" /><div className="h-4 w-full rounded bg-muted" /><div className="h-4 w-2/3 rounded bg-muted" /><div className="h-11 max-w-md rounded-full bg-muted" /></div>
    </div>
    <div aria-hidden="true" className="mt-4 min-h-12 shrink-0 border-b" />
    <div aria-hidden="true" className="mt-4 grid min-h-0 flex-1 grid-cols-2 gap-8 overflow-hidden motion-safe:animate-pulse">{[0, 1].map((column) => <div key={column} className="space-y-5">{Array.from({ length: 8 }, (_, index) => <div key={index} className="h-5 rounded bg-muted" style={{ width: `${55 + ((index * 17) % 40)}%` }} />)}</div>)}</div>
  </main></div>;
}
