import * as React from "react";
import { cn } from "@/lib/utils";

export function Input({ className, ...props }: React.ComponentProps<"input">) {
  return <input className={cn("w-full min-h-11 rounded-xl border border-border bg-background px-3 py-2 text-base placeholder:text-muted-foreground focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50", className)} {...props} />;
}
