"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowUpRight, CalendarDays, ListChecks } from "lucide-react";
import { z } from "zod";
import type { ArtifactDetail } from "@/domain/artifact";
import { api } from "@/lib/client-http";
import { ArtifactActions } from "./artifact-actions";
import { ArtifactContents } from "./artifact-contents";
import { useArtifact } from "./use-artifact";
import { Button } from "./ui/button";

export const artifactPreviewSchema = z.object({ artifactId: z.uuid(), kind: z.enum(["grocery", "meal-plan"]), title: z.string().min(1).max(160), revision: z.number().int().positive() });
export function ArtifactCard({ initial, onNavigate }: { initial: z.infer<typeof artifactPreviewSchema>; onNavigate: () => void }) {
  const [artifact, setArtifact] = useState<ArtifactDetail | null>(null), [error, setError] = useState(""), [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    api<ArtifactDetail>(`/api/artifacts/${initial.artifactId}`, { signal: controller.signal }).then(setArtifact).catch(() => { if (!controller.signal.aborted) setError("Couldn’t open this saved list or plan. Check your connection and try again."); });
    return () => controller.abort();
  }, [initial.artifactId, initial.revision, attempt]);
  if (artifact && artifact.id === initial.artifactId) return <ArtifactCardContent initial={artifact} onNavigate={onNavigate} />;
  return <section aria-label={`${initial.kind === "grocery" ? "Grocery list" : "Meal plan"}: ${initial.title}`} className="space-y-3 rounded-2xl border bg-muted/20 p-4"><Link href={`/artifacts/${initial.artifactId}`} onClick={onNavigate} className="inline-flex min-h-10 items-center break-words text-sm font-medium underline-offset-4 hover:underline">{initial.title}</Link>{error ? <><p role="alert" className="text-xs leading-relaxed text-destructive">{error}</p><Button size="sm" variant="outline" onClick={() => { setError(""); setAttempt((value) => value + 1); }}>Reload saved list or plan</Button></> : <p role="status" className="text-xs text-muted-foreground">Opening the current saved version…</p>}</section>;
}

function ArtifactCardContent({ initial, onNavigate }: { initial: ArtifactDetail; onNavigate: () => void }) {
  const { artifact, busy, error, mutate } = useArtifact(initial), Icon = artifact.kind === "grocery" ? ListChecks : CalendarDays;
  return <section aria-label={`${artifact.kind === "grocery" ? "Grocery list" : "Meal plan"}: ${artifact.title}`} className="space-y-4 rounded-2xl border bg-muted/20 p-4"><Link href={`/artifacts/${artifact.id}`} onClick={onNavigate} className="flex min-h-10 items-start gap-2"><Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" /><span className="min-w-0 flex-1 break-words text-sm font-medium">{artifact.title}</span><ArrowUpRight className="size-4 shrink-0 text-muted-foreground" /></Link><ArtifactContents artifact={artifact} busy={busy} mutate={mutate} compact onNavigate={onNavigate} />{error && <p role="alert" className="text-xs leading-relaxed text-destructive">{error}</p>}<ArtifactActions artifact={artifact} compact /><Link href={`/artifacts/${artifact.id}`} onClick={onNavigate} className="inline-flex min-h-10 items-center text-xs underline underline-offset-4">{artifact.kind === "grocery" ? "Open full list" : "Open full plan"}</Link></section>;
}
