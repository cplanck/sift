export default function LoadingArtifact() {
  return <main id="main" className="page-width max-w-4xl py-12" aria-busy="true"><p role="status" className="text-sm text-muted-foreground">Opening your list or plan…</p><div aria-hidden="true" className="mt-8 space-y-5 motion-safe:animate-pulse"><div className="h-10 w-2/3 rounded-xl bg-muted" /><div className="h-32 rounded-2xl bg-muted" /><div className="h-32 rounded-2xl bg-muted" /></div></main>;
}
