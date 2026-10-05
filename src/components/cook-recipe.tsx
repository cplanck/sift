"use client";
import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { CookingPot, LoaderCircle, Play } from "lucide-react";
import { api } from "@/lib/client-http";
import { Button } from "./ui/button";

export function CookRecipe({ recipeId, versionId, servings, activeSessionId }: { recipeId: string; versionId: string; servings: number; activeSessionId?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  return <div className="space-y-2">
    {activeSessionId && <Button asChild className="h-12 w-full rounded-full px-6"><Link href={`/recipes/${recipeId}?cook=${activeSessionId}`}><Play />Resume cooking</Link></Button>}
    {!activeSessionId && <Button className="h-12 w-full rounded-full px-6" variant="default" disabled={busy} onClick={async () => {
      setBusy(true); setError("");
      try {
        const session = await api<{ id: string }>("/api/cooking-sessions", { body: { recipeId, expectedVersionId: versionId, servings } });
        router.push(`/recipes/${recipeId}?cook=${session.id}`);
      } catch (error) { setError(error instanceof Error ? error.message : "Couldn’t start this cook."); setBusy(false); }
    }}>{busy ? <LoaderCircle className="animate-spin" /> : <CookingPot />}Cook</Button>}
    {activeSessionId && <p className="text-center text-xs text-muted-foreground">Pick up where you left off.</p>}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}</div>;
}
