import { AppHeaderSkeleton, pageFrame } from "@/components/app-header";

export default function LoadingLibrary() {
  return <><AppHeaderSkeleton /><main id="main" className={`${pageFrame} pb-32 pt-3 sm:pt-5`} aria-busy="true" aria-label="Loading your recipes">
    <div aria-hidden="true" className="motion-safe:animate-pulse">
      <div className="flex min-h-[260px] flex-col justify-center gap-4 sm:min-h-[300px]"><div className="h-12 w-72 max-w-full rounded-lg bg-muted" /><div className="h-12 w-48 rounded-lg bg-muted" /></div>
      <div className="mb-9"><div className="mb-5 h-6 w-44 rounded bg-muted" /><div className="grid gap-4 sm:grid-cols-3">{[0, 1, 2].map((item) => <div key={item} className="h-36 rounded-2xl bg-muted" />)}</div></div>
      <div className="mb-5 h-6 w-36 rounded bg-muted" />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4 xl:grid-cols-6">{Array.from({ length: 6 }, (_, index) => <div key={index} className="overflow-hidden rounded-2xl border border-border/60"><div className="aspect-[4/3] bg-muted" /><div className="space-y-3 p-3 sm:p-4"><div className="h-4 w-3/4 rounded bg-muted" /><div className="h-3 w-1/3 rounded bg-muted" /></div></div>)}</div>
    </div>
  </main></>;
}
