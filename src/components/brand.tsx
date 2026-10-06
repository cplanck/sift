import Link from "next/link";
import { cn } from "@/lib/utils";

export function SiftMark({ className }: { className?: string }) {
  return <svg viewBox="0 0 32 32" className={cn("size-8", className)} fill="none" aria-hidden="true">
    <path d="M1.6 17.6Q16 25 30.4 17.6A14.4 13.6 0 0 1 1.6 17.6Z" fill="currentColor" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
    <circle cx="16" cy="4.6" r="3" fill="currentColor" />
    <circle cx="9.8" cy="12" r="2.85" fill="currentColor" />
    <circle cx="22.2" cy="12" r="2.85" fill="currentColor" />
  </svg>;
}

export function Brand({ href = "/" }: { href?: string }) {
  return <Link href={href} prefetch={href === "/library" ? true : undefined} aria-label="Sift home" className="inline-flex min-h-11 min-w-11 items-center gap-2.5 rounded-lg focus-visible:outline-2 focus-visible:outline-ring">
    <SiftMark /><span className="hidden sm:inline text-3xl font-semibold tracking-[-0.04em]">Sift</span>
  </Link>;
}
