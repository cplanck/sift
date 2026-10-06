"use client";
import Link from "next/link";
import { useRef, useState } from "react";
import { Check, ChevronDown, Plus, ShoppingBasket } from "lucide-react";
import type { ArtifactDetail } from "@/domain/artifact";
import { api } from "@/lib/client-http";
import { Button } from "./ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "./ui/dropdown-menu";
import { ShoppingListDialog } from "./shopping-list-dialog";
import { shoppingListChanged, useShoppingLists } from "./use-shopping-lists";
import styles from "./shopping.module.css";

export function ShoppingListButton({ recipeId, versionId, servings }: { recipeId: string; versionId: string; servings: number }) {
  const { lists, active, select, loading, error: loadError, refresh } = useShoppingLists();
  const [creating, setCreating] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const saving = useRef(false);
  const added = active?.recipeIds?.includes(recipeId);
  async function add() {
    if (saving.current) return;
    if (!active) { setCreating(true); return; }
    if (added) return;
    saving.current = true; setBusy(true); setError("");
    try {
      await api<ArtifactDetail>(`/api/artifacts/${active.id}/actions`, { body: { action: "addRecipe", recipeId, versionId, servings, expectedRevision: active.revision } });
      shoppingListChanged(active.id); await refresh();
    } catch (error) { setError(error instanceof Error ? error.message : "Couldn’t add this recipe."); await refresh(); }
    finally { saving.current = false; setBusy(false); }
  }
  return <div className={styles.addRecipe}>
    <div className={styles.splitButton}>
      <Button variant="outline" disabled={loading || busy || !!added || !!loadError} onClick={add} title={active ? `${added ? "Added to" : "Add to"} ${active.title}` : "Add to shopping list"}>{added ? <Check /> : <ShoppingBasket />}<span>{busy ? "Adding…" : added ? `Added to ${active!.title}` : active ? `Add to ${active.title}` : "Add to shopping list"}</span></Button>
      <DropdownMenu><DropdownMenuTrigger asChild><Button variant="outline" disabled={busy || loading} aria-label="Choose shopping list"><ChevronDown /></Button></DropdownMenuTrigger><DropdownMenuContent align="end" className="w-64 rounded-xl p-2">
        {lists.map((list) => <DropdownMenuItem key={list.id} className="min-h-11" onSelect={() => { select(list.id); setError(""); }}><span className="flex-1 truncate">{list.title}</span>{list.id === active?.id && <Check />}</DropdownMenuItem>)}
        {lists.length > 0 && <DropdownMenuSeparator />}<DropdownMenuItem onSelect={() => setCreating(true)}><Plus />New shopping list</DropdownMenuItem>
        {active && <DropdownMenuItem asChild><Link href={`/artifacts/${active.id}`}>Open {active.title}</Link></DropdownMenuItem>}
      </DropdownMenuContent></DropdownMenu>
    </div>
    {(error || loadError) && <p role="alert" className="text-xs text-destructive">{error || loadError}{loadError && <button className="ml-2 underline" onClick={() => void refresh()}>Retry</button>}</p>}
    {creating && <ShoppingListDialog mode="create" addRecipe={{ recipeId, versionId, servings }} onClose={() => setCreating(false)} onSaved={() => void refresh()} />}
  </div>;
}
