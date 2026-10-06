"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { ArtifactDetail, ArtifactSummary } from "@/domain/artifact";
import { api } from "@/lib/client-http";
import { selectShoppingList, shoppingListChanged } from "./use-shopping-lists";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "./ui/dialog";

export function ShoppingListDialog({ mode, list, onClose, onSaved, addRecipe }: { mode: "create" | "rename" | "delete"; list?: ArtifactSummary; onClose: () => void; onSaved?: (list?: ArtifactDetail) => void; addRecipe?: { recipeId: string; versionId: string; servings: number } }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const router = useRouter();
  const created = useRef<ArtifactDetail | null>(null);
  return <Dialog open onOpenChange={(open) => { if (!open && !busy) onClose(); }}><DialogContent className="rounded-2xl sm:max-w-sm" showCloseButton={!busy}>
    <DialogHeader><DialogTitle>{mode === "create" ? "New shopping list" : mode === "rename" ? "Rename your list" : `Delete ${list?.title}?`}</DialogTitle><DialogDescription>{mode === "delete" ? "This removes the list and its checkmarks. Your recipes stay in your cookbook." : mode === "create" ? "Choose a name for your list." : "Give this list a name that’s easy to find."}</DialogDescription></DialogHeader>
    <form className="space-y-5" onSubmit={async (event) => {
      event.preventDefault(); const title = String(new FormData(event.currentTarget).get("title") ?? "").trim(); setBusy(true); setError("");
      try {
        let saved: ArtifactDetail | undefined;
        if (mode === "create") {
          saved = created.current ?? await api<ArtifactDetail>("/api/artifacts", { body: { kind: "grocery", title } });
          created.current = saved;
          selectShoppingList(saved.id);
          if (addRecipe) {
            // The new list remains available if adding fails; retry from the recipe button.
            try { saved = await api<ArtifactDetail>(`/api/artifacts/${saved.id}/actions`, { body: { action: "addRecipe", ...addRecipe, expectedRevision: saved.revision } }); }
            catch (error) { shoppingListChanged(saved.id); throw new Error(`Your list was created, but the recipe wasn’t added. ${error instanceof Error ? error.message : "Try again."}`); }
          }
        } else if (mode === "rename") saved = await api<ArtifactDetail>(`/api/artifacts/${list!.id}`, { method: "PATCH", body: { title, expectedRevision: list!.revision } });
        else await api(`/api/artifacts/${list!.id}`, { method: "DELETE", body: { expectedRevision: list!.revision } });
        shoppingListChanged(saved?.id ?? list!.id); router.refresh(); onSaved?.(saved); onClose();
      } catch (error) { setError(error instanceof Error ? error.message : "Couldn’t save the list."); }
      finally { setBusy(false); }
    }}>
      {mode !== "delete" && <label className="block text-sm">List name<Input autoFocus name="title" required maxLength={160} defaultValue={list?.title ?? "This week"} className="mt-2" /></label>}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <DialogFooter><Button type="button" variant="ghost" disabled={busy} onClick={onClose}>Cancel</Button><Button type="submit" variant={mode === "delete" ? "destructive" : "default"} disabled={busy}>{busy ? "Saving…" : mode === "delete" ? "Delete list" : mode === "rename" ? "Save name" : addRecipe ? "Create list & add recipe" : "Create list"}</Button></DialogFooter>
    </form>
  </DialogContent></Dialog>;
}
