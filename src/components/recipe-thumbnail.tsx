import { SiftMark } from "./brand";
import { cn } from "@/lib/utils";
export function RecipeThumbnail({ className }: { className?: string }) {
  return <div className={cn("flex shrink-0 items-center justify-center overflow-hidden rounded-xl border border-border/50 bg-muted", className)} aria-hidden="true"><SiftMark className="size-8 text-muted-foreground/50" /></div>;
}
