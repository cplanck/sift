"use client";
import { Heart } from "lucide-react";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/client-http";
import { Button } from "./ui/button";

export function FavoriteButton({ id, initial, onChange, className }: { id: string; initial: boolean; onChange?: (favorite: boolean) => void; className?: string }) {
  const router = useRouter();
  const [favorite, setFavorite] = useState(initial), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [previousInitial, setPreviousInitial] = useState(initial);
  if (previousInitial !== initial) { setPreviousInitial(initial); setFavorite(initial); }
  return <div className="relative"><Button variant="ghost" size="icon" className={className} aria-label={favorite ? "Remove from favorites" : "Add to favorites"} aria-pressed={favorite} disabled={busy} onClick={async () => {
    const next = !favorite; setFavorite(next); onChange?.(next); setBusy(true); setError("");
    try { await api(`/api/recipes/${id}/actions`, { body: { action: "favorite", favorite: next } }); router.refresh(); }
    catch { setFavorite(!next); onChange?.(!next); setError("Favorite wasn’t saved. Try again."); }
    finally { setBusy(false); }
  }}><Heart className={favorite ? "fill-current" : ""} /></Button>{error && <span role="alert" className="absolute right-0 top-full z-10 w-52 max-w-[calc(50vw-2rem)] rounded-lg border bg-background p-2 text-xs shadow-md sm:max-w-none">{error}</span>}</div>;
}
