"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { ArtifactDetail, MealEntryInput } from "@/domain/artifact";
import { api } from "@/lib/client-http";

export const ARTIFACT_CHANGED = "sift-artifact-changed";
export type ArtifactAction =
  | { action: "checkItem"; itemId: string; checked: boolean }
  | { action: "removeItem"; itemId: string }
  | { action: "addItems"; groupName: string; items: { text: string }[] }
  | { action: "addEntry"; entry: MealEntryInput }
  | { action: "removeEntry"; entryId: string };

export function useArtifact(initial: ArtifactDetail, refreshOnMount = false) {
  const [artifact, setArtifact] = useState(initial), [source, setSource] = useState(initial), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const current = useRef(initial), saving = useRef(false), alive = useRef(true), router = useRouter();
  if (source !== initial) {
    setSource(initial);
    if (!busy && initial.revision >= artifact.revision) setArtifact(initial);
  }
  useEffect(() => { current.current = artifact; }, [artifact]);
  const accept = useCallback((saved: ArtifactDetail) => {
    if (alive.current && saved.id === current.current.id && saved.revision >= current.current.revision) { current.current = saved; setArtifact(saved); }
  }, []);
  const refresh = useCallback(async () => {
    const saved = await api<ArtifactDetail>(`/api/artifacts/${initial.id}`);
    if (!saving.current) accept(saved);
    return saved;
  }, [initial.id, accept]);
  useEffect(() => {
    alive.current = true;
    const reload = () => { if (!saving.current) void refresh().catch(() => {}); };
    const changed = (event: Event) => { if ((event as CustomEvent<{ id: string }>).detail.id === initial.id) reload(); };
    if (refreshOnMount) reload();
    window.addEventListener(ARTIFACT_CHANGED, changed); window.addEventListener("focus", reload); window.addEventListener("online", reload);
    return () => { alive.current = false; window.removeEventListener(ARTIFACT_CHANGED, changed); window.removeEventListener("focus", reload); window.removeEventListener("online", reload); };
  }, [initial.id, refresh, refreshOnMount]);
  async function mutate(action: ArtifactAction, optimistic?: (value: ArtifactDetail) => ArtifactDetail) {
    if (saving.current) return false;
    const before = current.current;
    saving.current = true; setBusy(true); setError("");
    if (optimistic) setArtifact(optimistic(before));
    try {
      const saved = await api<ArtifactDetail>(`/api/artifacts/${before.id}/actions`, { body: { ...action, expectedRevision: before.revision } });
      accept(saved);
      window.dispatchEvent(new CustomEvent(ARTIFACT_CHANGED, { detail: { id: saved.id, revision: saved.revision } }));
      router.refresh(); return true;
    } catch (error) {
      if (alive.current) { setArtifact(before); setError(navigator.onLine ? error instanceof Error ? error.message : "Couldn’t save that change. Try again." : "You’re offline. This change wasn’t saved. Reconnect and try again."); }
      const saved = await api<ArtifactDetail>(`/api/artifacts/${before.id}`).catch(() => null);
      if (saved) accept(saved);
      return false;
    } finally { saving.current = false; if (alive.current) setBusy(false); }
  }
  return { artifact, busy, error, mutate, refresh };
}
