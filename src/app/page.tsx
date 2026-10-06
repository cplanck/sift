import Image from "next/image";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Brand, SiftMark } from "@/components/brand";
import { ThemeToggle } from "@/components/providers";
import { Button } from "@/components/ui/button";
import { getViewer, isAuthConfigured } from "@/lib/auth";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";
export default async function Home() {
  if (await getViewer()) redirect("/library");
  const entry = isAuthConfigured() ? "/sign-in" : "/setup";
  return <div className="page-width">
    <header className="flex h-20 items-center justify-between"><Brand /><ThemeToggle /></header>
    <main id="main" className="relative isolate mb-8 flex min-h-[min(760px,82dvh)] overflow-hidden rounded-3xl border border-white/10 bg-[#09100d] text-[#f3f4f0]">
      <Image src="/stock/bread.webp" alt="Freshly baked sourdough on a rustic table" fill preload sizes="(max-width: 1120px) 100vw, 1088px" className="object-cover object-center opacity-65 md:object-right" />
      <div className="absolute inset-0 bg-gradient-to-t from-[#09100d] via-[#09100d]/65 to-[#09100d]/20 md:bg-gradient-to-r md:from-[#09100d] md:via-[#09100d]/75 md:to-transparent" />
      <div className="relative flex w-full flex-col items-center justify-center px-7 py-14 text-center md:max-w-xl md:items-start md:px-16 md:py-20 md:text-left">
        <SiftMark className="mb-6 size-16 md:size-20" />
        <p className="mb-6 text-3xl font-semibold tracking-tight">Sift</p>
        <h1 className="text-5xl font-medium leading-[1.12] tracking-[-.045em] sm:text-6xl">Good food<br />lives here.</h1>
        <p className="mt-6 max-w-xs text-sm leading-7 text-white/70">Your recipes, your little changes, your next favorite meal. A personal cookbook you can talk to.</p>
        <div className="mt-9 grid w-full max-w-xs gap-3">
          <Button asChild className="h-12 rounded-xl bg-[#f3f4f0] text-[#0b1010] hover:bg-white"><Link href={entry === "/sign-in" ? "/sign-in?mode=sign-up" : entry}>Get started <ArrowRight /></Link></Button>
          <Button asChild variant="outline" className="h-12 rounded-xl border-white/25 bg-white/5 text-white hover:bg-white/10 hover:text-white dark:bg-white/5 dark:hover:bg-white/10"><Link href={entry}>Sign in</Link></Button>
        </div>
      </div>
    </main>
    <footer className="safe-bottom flex flex-wrap justify-between gap-3 pb-8 text-xs text-muted-foreground"><span>A little less searching. A little more cooking.</span><span className="tracking-widest">Plan · Cook · Remember · Share</span></footer>
  </div>;
}
