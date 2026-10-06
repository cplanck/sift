"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ArtifactSummary } from "@/domain/artifact";
import { api } from "@/lib/client-http";
import { ARTIFACT_CHANGED } from "./use-artifact";

const ACTIVE_LIST = "sift.shopping-list.v1";
const SELECTION_CHANGED = "sift-shopping-selection";
export function selectShoppingList(id: string) {
  try { localStorage.setItem(ACTIVE_LIST, id); } catch { /* Browsing still works without storage. */ }
  window.dispatchEvent(new CustomEvent(SELECTION_CHANGED, { detail: id }));
}
export function useShoppingLists(initial: ArtifactSummary[] = []) {
  const [allLists, setLists] = useState(initial), [selectedId, setSelectedId] = useState(""), [loading, setLoading] = useState(true), [error, setError] = useState("");
  const sequence = useRef(0), alive = useRef(false);
  const refresh = useCallback(async () => {
    const request = ++sequence.current;
    try {
      const next = await api<ArtifactSummary[]>("/api/artifacts?kind=grocery&includeArchived=true");
      if (!alive.current || request !== sequence.current) return;
      let remembered = ""; try { remembered = localStorage.getItem(ACTIVE_LIST) ?? ""; } catch { /* Optional persistence. */ }
      const nextActive = next.filter((list) => !list.archivedAt);
      setLists(next); setSelectedId((current) => [remembered, current].find((id) => nextActive.some((list) => list.id === id)) ?? nextActive[0]?.id ?? ""); setError("");
    } catch (error) { if (alive.current && request === sequence.current) setError(error instanceof Error ? error.message : "Couldn’t load shopping lists."); }
    finally { if (alive.current && request === sequence.current) setLoading(false); }
  }, []);
  useEffect(() => {
    alive.current = true;
    const changed = () => { void refresh(); };
    const selected = (event: Event) => { setSelectedId((event as CustomEvent<string>).detail); };
    void Promise.resolve().then(refresh);
    window.addEventListener(ARTIFACT_CHANGED, changed); window.addEventListener("focus", changed); window.addEventListener("storage", changed); window.addEventListener(SELECTION_CHANGED, selected);
    return () => { alive.current = false; window.removeEventListener(ARTIFACT_CHANGED, changed); window.removeEventListener("focus", changed); window.removeEventListener("storage", changed); window.removeEventListener(SELECTION_CHANGED, selected); };
  }, [refresh]);
  const lists = allLists.filter((list) => !list.archivedAt), archivedLists = allLists.filter((list) => !!list.archivedAt);
  return { lists, archivedLists, active: lists.find((list) => list.id === selectedId) ?? lists[0], loading, error, refresh, select: selectShoppingList };
}
export function shoppingListChanged(id: string) { window.dispatchEvent(new CustomEvent(ARTIFACT_CHANGED, { detail: { id } })); }
