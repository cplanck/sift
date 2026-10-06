import Link from "next/link";
import { cn } from "@/lib/utils";

export function SiftMark({ className }: { className?: string }) {
  return <svg viewBox="0 0 32 32" className={cn("size-8", className)} fill="none" aria-hidden="true">
    <path d="M2 16h28a14 14 0 0 1-28 0Z" fill="currentColor" />
    <circle cx="16" cy="4" r="2.2" fill="currentColor" />
    <circle cx="11" cy="10.5" r="2.2" fill="currentColor" />
    <circle cx="21" cy="10.5" r="2.2" fill="currentColor" />
  </svg>;
}

export function Brand() {
  return <Link href="/" aria-label="Sift home" className="inline-flex items-center gap-2.5 rounded-lg focus-visible:outline-2 focus-visible:outline-ring">
    <SiftMark /><span className="text-3xl font-semibold tracking-[-0.04em]">Sift</span>
  </Link>;
}
