import { requireViewer } from "@/lib/auth";
import { AppHeader } from "@/components/app-header";
import { SiftMark } from "@/components/brand";
export const dynamic = "force-dynamic";
export default async function Library() {
  const viewer = await requireViewer();
  return <><AppHeader name={viewer.name} /><main id="main" className="page-width py-12 md:py-20">
    <p className="text-xs uppercase tracking-[.2em] text-muted-foreground">Your personal cookbook</p>
    <h1 className="mt-4 text-4xl font-medium tracking-tight md:text-5xl">Library</h1>
    <div className="mt-14 flex min-h-80 flex-col items-center justify-center rounded-3xl border border-dashed p-10 text-center"><SiftMark className="mb-6 size-12 text-muted-foreground" /><h2 className="text-2xl font-medium">A fresh page.</h2><p className="mt-3 max-w-sm leading-relaxed text-muted-foreground">Your cookbook is ready. This is where your favorite recipes will feel at home.</p></div>
  </main></>;
}
