"use client";

import Image from "next/image";
import { useState } from "react";
import { cn } from "@/lib/utils";

export function AccountAvatar({ name, className }: { name: string; className?: string }) {
  const [failed, setFailed] = useState(false);
  // Use an opaque, deterministic seed instead of sending the display name.
  let hash = 2166136261;
  for (const character of name.trim().toLowerCase()) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  const seed = (hash >>> 0).toString(16);
  return <span aria-hidden="true" className={cn("relative inline-flex size-8 shrink-0 overflow-hidden rounded-full bg-gradient-to-br from-emerald-200 to-teal-700 ring-1 ring-black/10 dark:ring-white/10", className)}>
    {!failed && <Image src={`https://avatar.vercel.sh/sift-${seed}?size=80`} alt="" fill unoptimized className="object-cover" onError={() => setFailed(true)} />}
  </span>;
}
