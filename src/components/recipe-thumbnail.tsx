"use client";
import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ArrowUpRight } from "lucide-react";
import { fallbackStockPhoto, stockPhotoSchema, unsplashReferralUrl, type StockPhoto } from "@/domain/stock-photo";
import { api } from "@/lib/client-http";
import { SiftMark } from "./brand";
import { cn } from "@/lib/utils";

const photoRequests = new Map<string, Promise<StockPhoto | null>>();
function resolveStockPhoto(recipeId: string, key: string) {
  let request = photoRequests.get(key);
  if (!request) {
    request = api<{ photo: unknown }>(`/api/recipes/${recipeId}/stock-photo`).then(({ photo }) => {
      const result = stockPhotoSchema.safeParse(photo); return result.success ? result.data : null;
    }).catch(() => { photoRequests.delete(key); return null; });
    if (photoRequests.size >= 200) photoRequests.delete(photoRequests.keys().next().value!);
    photoRequests.set(key, request);
  }
  return request;
}

type Props = {
  className?: string; photoId?: string | null; alt?: string;
  recipeId?: string; title?: string; tags?: readonly string[]; stockPhoto?: StockPhoto | null;
  coverSelection?: "auto" | "selected" | "none";
  coverImage?: { origin: string; widths: number[] } | null;
  // Attribution presentation is opt-in during prototyping; provider metadata is retained.
  imageHref?: string; credit?: "compact" | "full" | "list"; eager?: boolean; sizes?: string;
};

export function RecipeThumbnail({ className, photoId, alt = "", recipeId, title, tags, stockPhoto, coverSelection, coverImage, imageHref, credit, eager = false, sizes = "400px" }: Props) {
  const [failedSources, setFailedSources] = useState<ReadonlySet<string>>(new Set());
  const [resolved, setResolved] = useState<{ key: string; photo: StockPhoto } | null>(null);
  const container = useRef<HTMLDivElement>(null), requestKey = recipeId ?? "";
  const fallback = title ? fallbackStockPhoto(title, tags) : null;
  const stock = stockPhoto ?? (resolved?.key === requestKey ? resolved.photo : fallback);
  const uploadedSrc = photoId && coverSelection !== "none" ? `/api/photos/${photoId}` : null;
  const usingStock = !uploadedSrc || failedSources.has(uploadedSrc);
  const photo = coverSelection !== "none" && usingStock && stock && !failedSources.has(stock.src) ? stock : null;
  const src = usingStock ? photo?.src : uploadedSrc;
  const stackedCredit = photo?.provider === "Unsplash" && credit !== "full";

  useEffect(() => {
    if (coverSelection === "none" || photoId || stockPhoto || !recipeId || !title) return;
    let active = true;
    const load = () => { void resolveStockPhoto(recipeId, requestKey).then((photo) => { if (active && photo) setResolved({ key: requestKey, photo }); }); };
    const observer = new IntersectionObserver(([entry]) => { if (entry.isIntersecting) { observer.disconnect(); load(); } }, { rootMargin: "150px" });
    if (container.current) observer.observe(container.current);
    return () => { active = false; observer.disconnect(); };
  }, [coverSelection, photoId, stockPhoto, recipeId, title, requestKey]);

  const imagery = src && !failedSources.has(src)
    ? !usingStock && coverImage?.widths.length
      // Private cover derivatives are already resized and require authentication.
      // eslint-disable-next-line @next/next/no-img-element
      ? <img src={src} srcSet={coverImage.widths.map((width) => `${src}?width=${width} ${width}w`).join(", ")} sizes={sizes} alt={alt} loading={eager ? "eager" : "lazy"} className="absolute inset-0 size-full object-cover" onError={() => setFailedSources((current) => new Set(current).add(src))} />
      : <Image src={src} alt={photo ? `Stock photo: ${photo.alt}` : alt} fill unoptimized={!src.startsWith("/stock/")} loading={eager ? "eager" : "lazy"} sizes={sizes} className="object-cover transition-transform duration-500 group-hover:scale-[1.035]" onError={() => setFailedSources((current) => new Set(current).add(src))} />
    : <div className="flex size-full items-center justify-center"><SiftMark className="size-8 text-muted-foreground/40" />{alt && <span className="sr-only">Photo unavailable</span>}</div>;
  return <div ref={container} className={cn("relative shrink-0 overflow-hidden rounded-xl bg-muted", className)} aria-hidden={!alt && !photo && !imageHref ? true : undefined}>
    {imageHref ? <Link href={imageHref} aria-label={title} className="absolute inset-0 focus-visible:outline-2 focus-visible:-outline-offset-4 focus-visible:outline-ring">{imagery}</Link> : imagery}
    {photo && credit && <div className={cn("absolute bottom-2 left-2 z-10 flex min-h-6 max-w-[calc(100%-1rem)] items-center gap-1 rounded-md bg-black/65 px-2 py-1 text-[10px] leading-4 text-white/90", credit === "full" && "bottom-3 left-3 px-2.5 text-[11px]", stackedCredit && "flex-col items-start gap-0", credit === "list" && "bottom-1 left-1 max-w-[calc(100%-0.5rem)] flex-col items-start gap-0 px-1.5 text-[9px] leading-3.5")}>
      <span className={cn("shrink-0", (credit === "list" || stackedCredit) && "sr-only")}>{credit === "full" ? "Stock photo ·" : "Stock ·"}</span>
      <a href={photo.provider === "Unsplash" ? photo.photographerUrl : photo.url} target="_blank" rel="noopener noreferrer" aria-label={`Stock photo by ${photo.photographer} on ${photo.provider}`} title={`Representative stock photo by ${photo.photographer} on ${photo.provider}`} className="min-w-0 max-w-full truncate rounded-sm hover:text-white focus-visible:outline-2 focus-visible:outline-white">{photo.provider === "Unsplash" ? photo.photographer : credit === "full" ? `${photo.photographer} / Pexels` : "Pexels"}</a>
      {photo.provider === "Unsplash" && <>{!stackedCredit && <span>/</span>}<a href={unsplashReferralUrl} aria-label="Unsplash" target="_blank" rel="noopener noreferrer" className="shrink-0 rounded-sm hover:text-white focus-visible:outline-2 focus-visible:outline-white">{credit === "compact" && "Stock · "}Unsplash</a></>}
      {credit !== "list" && !stackedCredit && <ArrowUpRight className="size-3 shrink-0" />}
    </div>}
  </div>;
}
