"use client";
import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { CookingPot, LoaderCircle, Play } from "lucide-react";
import { api } from "@/lib/client-http";
import { cn } from "@/lib/utils";
import { Button } from "./ui/button";

export function CookRecipe({ recipeId, versionId, servings, activeSessionId, label = "Cook", className }: { recipeId: string; versionId: string; servings: number; activeSessionId?: string; label?: string; className?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  return <div className="space-y-2">
    {activeSessionId && <Button asChild className={cn("h-12 w-full rounded-full px-6", className)}><Link href={`/recipes/${recipeId}?cook=${activeSessionId}`}><Play />Resume cooking</Link></Button>}
    {!activeSessionId && <Button className={cn("h-12 w-full rounded-full px-6", className)} variant="default" disabled={busy} onClick={async () => {
      setBusy(true); setError("");
      try {
        const session = await api<{ id: string }>("/api/cooking-sessions", { body: { recipeId, expectedVersionId: versionId, servings } });
        router.push(`/recipes/${recipeId}?cook=${session.id}`);
        router.refresh();
      } catch (error) { setError(error instanceof Error ? error.message : "Couldn’t start this cook."); setBusy(false); }
    }}>{busy ? <LoaderCircle className="animate-spin" /> : <CookingPot />}{label}</Button>}
    {activeSessionId && <p className="text-center text-xs text-muted-foreground">Pick up where you left off.</p>}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}</div>;
}
