"use client";
import { Heart } from "lucide-react";
import { useState } from "react";
import { api } from "@/lib/client-http";
import { Button } from "./ui/button";

export function FavoriteButton({ id, initial, onChange }: { id: string; initial: boolean; onChange?: (favorite: boolean) => void }) {
  const [favorite, setFavorite] = useState(initial), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [previousInitial, setPreviousInitial] = useState(initial);
  if (previousInitial !== initial) { setPreviousInitial(initial); setFavorite(initial); }
  return <div className="relative"><Button variant="ghost" size="icon" aria-label={favorite ? "Remove from favorites" : "Add to favorites"} aria-pressed={favorite} disabled={busy} onClick={async () => {
    const next = !favorite; setFavorite(next); onChange?.(next); setBusy(true); setError("");
    try { await api(`/api/recipes/${id}/actions`, { body: { action: "favorite", favorite: next } }); }
    catch { setFavorite(!next); onChange?.(!next); setError("Favorite wasn’t saved. Try again."); }
    finally { setBusy(false); }
  }}><Heart className={favorite ? "fill-current" : ""} /></Button>{error && <span role="alert" className="absolute right-0 top-full z-10 w-52 rounded-lg border bg-background p-2 text-xs">{error}</span>}</div>;
}
