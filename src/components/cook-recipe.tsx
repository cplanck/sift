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
  return <div className="space-y-2"><div className="flex flex-wrap items-center gap-3">
    {activeSessionId && <Button asChild><Link href={`/recipes/${recipeId}?cook=${activeSessionId}`}><Play />Resume cooking</Link></Button>}
    {!activeSessionId && <Button variant="default" disabled={busy} onClick={async () => {
      setBusy(true); setError("");
      try {
        const session = await api<{ id: string }>("/api/cooking-sessions", { body: { recipeId, expectedVersionId: versionId, servings } });
        router.push(`/recipes/${recipeId}?cook=${session.id}`);
      } catch (error) { setError(error instanceof Error ? error.message : "Couldn’t start this cook."); setBusy(false); }
    }}>{busy ? <LoaderCircle className="animate-spin" /> : <CookingPot />}Cook</Button>}
    <span className="text-xs text-muted-foreground">{activeSessionId ? "Your earlier cook is saved." : "A fresh cook, using this version."}</span>
  </div>{error && <p role="alert" className="text-sm text-destructive">{error}</p>}</div>;
}
