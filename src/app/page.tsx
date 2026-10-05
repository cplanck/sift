import { ArrowUpRight } from "lucide-react";
import { Brand, SiftMark } from "@/components/brand";
import { ThemeToggle } from "@/components/providers";
import { Button } from "@/components/ui/button";
import { getViewer, isAuthConfigured } from "@/lib/auth";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";
export default async function Home() {
  if (await getViewer()) redirect("/library");
  return <div className="page-width">
    <header className="flex h-24 items-center justify-between border-b"><Brand /><ThemeToggle /></header>
    <main id="main" className="grid min-h-[75dvh] items-center gap-16 py-20 md:grid-cols-[1.4fr_1fr]">
      <div><p className="mb-6 text-xs font-medium uppercase tracking-[0.22em] text-muted-foreground">A place for the keepers</p>
        <h1 className="max-w-3xl text-5xl font-medium leading-[1.08] tracking-[-0.055em] md:text-7xl">Good food.<br />Worth remembering.</h1>
        <p className="mt-8 max-w-md text-lg leading-relaxed text-muted-foreground">The recipes you come back to. The little changes that make them yours. All together in your personal cookbook.</p>
        <Button asChild className="mt-10"><a href={isAuthConfigured() ? "/sign-in" : "/setup"}>Open your cookbook <ArrowUpRight /></a></Button>
      </div>
      <div className="flex aspect-square items-center justify-center rounded-full border border-border bg-muted/40"><SiftMark className="size-32 text-muted-foreground md:size-44" /></div>
    </main>
    <footer className="safe-bottom border-t pt-6 text-sm text-muted-foreground">A little less searching. A little more cooking.</footer>
  </div>;
}
