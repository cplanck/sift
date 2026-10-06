import Image from "next/image";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { SiftMark } from "@/components/brand";
import { Button } from "@/components/ui/button";
import { getViewer, isAuthConfigured } from "@/lib/auth";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";
export default async function Home() {
  if (await getViewer()) redirect("/library");
  const entry = isAuthConfigured() ? "/sign-in" : "/setup";
  return <div className="min-h-dvh bg-[#050b09] md:py-8">
    <main id="main" className="relative isolate mx-auto flex min-h-dvh w-full max-w-[68rem] overflow-hidden bg-[#050b09] text-[#f3f4f0] md:min-h-[min(820px,calc(100dvh-7rem))] md:rounded-[2rem] md:border md:border-white/10!">
      {/* Photo: Ahmadreza Rezaie, https://unsplash.com/photos/9x6QkgB722w (Unsplash License).
          It starts below the lockup on phones so the pan lands just above the buttons. */}
      <div className="absolute inset-x-0 bottom-0 top-[24%] -z-20 md:inset-y-0 md:left-[38%] md:top-0">
        <Image src="/brand/splash.webp" alt="Pan-roasted vegetables with peppers and lime on a dark wooden table" fill preload sizes="(max-width: 768px) 100vw, 680px" className="object-cover object-[center_70%] md:object-center" />
        <div className="absolute inset-0 bg-gradient-to-b from-[#050b09] via-transparent via-35% to-[#050b09]/95 md:bg-gradient-to-r md:from-[#050b09] md:via-[#050b09]/30 md:via-30% md:to-transparent" />
        <div className="absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-[#050b09] to-transparent" />
      </div>
      <div aria-hidden="true" className="absolute -left-24 -top-24 -z-10 size-96 rounded-full bg-[#1b5a40]/25 blur-3xl" />
      <div className="flex w-full flex-col items-center px-8 pb-[max(2rem,env(safe-area-inset-bottom))] pt-[max(4.5rem,calc(env(safe-area-inset-top)+3rem))] text-center md:max-w-[30rem] md:justify-center md:px-16 md:py-20">
        <SiftMark className="size-[4.5rem] md:size-20" />
        <h1 className="mt-4 text-[3.75rem] font-semibold leading-none tracking-[-0.05em] md:text-7xl">Sift</h1>
        <p className="mt-3 text-[0.95rem] lowercase tracking-[0.22em] text-white/75">agentic cooking</p>
        <div className="mt-auto grid w-full max-w-xs gap-3 pt-10 md:mt-12">
          <Button asChild className="h-12 rounded-xl bg-[#f3f4f0] text-[#0b1010] shadow-lg shadow-black/30 hover:bg-white"><Link href={entry === "/sign-in" ? "/sign-in?mode=sign-up" : entry}>Get started <ArrowRight /></Link></Button>
          <Button asChild variant="outline" className="h-12 rounded-xl border-white/10! bg-[#0d1a15]/80 text-white backdrop-blur hover:bg-[#13261e] hover:text-white dark:bg-[#0d1a15]/80 dark:hover:bg-[#13261e]"><Link href={entry}>Sign in</Link></Button>
        </div>
        <p className="mt-10 hidden text-[0.7rem] uppercase tracking-[0.35em] text-white/45 md:block">Plan · Cook · Remember · Share</p>
      </div>
    </main>
  </div>;
}
