"use client";
import Image from "next/image";
import { useState } from "react";
import { SiftMark } from "./brand";
import { cn } from "@/lib/utils";
export function RecipeThumbnail({ className, photoId, alt = "" }: { className?: string; photoId?: string | null; alt?: string }) {
  const [failedPhoto, setFailedPhoto] = useState<string | null>(null);
  return <div className={cn("relative flex shrink-0 items-center justify-center overflow-hidden rounded-xl border border-border/50 bg-muted", className)} aria-hidden={alt ? undefined : true}>
    {photoId && failedPhoto !== photoId ? <Image src={`/api/photos/${photoId}`} alt={alt} fill unoptimized className="object-cover" onError={() => setFailedPhoto(photoId)} /> : <><SiftMark className="size-8 text-muted-foreground/50" />{alt && <span className="sr-only">{photoId ? "Photo unavailable" : "No photo yet"}</span>}</>}
  </div>;
}
