import Link from "next/link";
import { cn } from "@/lib/utils";

export function SiftMark({ className }: { className?: string }) {
  return <svg viewBox="0 0 32 32" className={cn("size-8", className)} fill="none" aria-hidden="true">
    <path d="M5 7h22L18 19h-4L5 7Z" fill="currentColor" />
    <circle cx="12" cy="24" r="1.6" fill="currentColor" />
    <circle cx="20" cy="24" r="1.6" fill="currentColor" />
    <circle cx="16" cy="29" r="1.6" fill="currentColor" />
  </svg>;
}

export function Brand() {
  return <Link href="/" aria-label="Sift home" className="inline-flex items-center gap-2.5 rounded-lg focus-visible:outline-2 focus-visible:outline-ring">
    <SiftMark /><span className="text-3xl font-semibold tracking-[-0.07em]">sift</span>
  </Link>;
}
