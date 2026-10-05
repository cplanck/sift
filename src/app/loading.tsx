export default function Loading() {
  return <main id="main" className="page-width py-24" aria-busy="true" aria-label="Loading cookbook"><div className="h-10 w-52 animate-pulse rounded-xl bg-muted" /><div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">{[1, 2, 3].map((id) => <div key={id} className="aspect-[4/3] animate-pulse rounded-2xl bg-muted" />)}</div></main>;
}
