"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check } from "lucide-react";
import type { listRecipePhotos } from "@/services/photos";
import { api } from "@/lib/client-http";
import { PhotoUpload } from "./photo-upload";
import { RecipeThumbnail } from "./recipe-thumbnail";
import { Button } from "./ui/button";

type Photos = Awaited<ReturnType<typeof listRecipePhotos>>;
export function RecipePhotos({ recipeId, initialPhotos, coverPhotoId, title }: { recipeId: string; initialPhotos: Photos; coverPhotoId: string | null; title: string }) {
  const router = useRouter();
  const [photos, setPhotos] = useState(initialPhotos), [cover, setCover] = useState(coverPhotoId), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  return <section className="max-w-3xl space-y-6"><div><h2 className="text-xl font-medium">A recipe in pictures.</h2><p className="mt-2 text-sm text-muted-foreground">Photos stay private unless you include a cover in a share link.</p></div>
    <PhotoUpload purpose="recipe" recipeId={recipeId} onUploaded={async (id) => { const items = await api<Photos>(`/api/recipes/${recipeId}/photos`); setPhotos(items); setCover((current) => current ?? id); router.refresh(); }} />
    {photos.length > 0 && <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">{photos.map((photo, index) => <figure key={photo.id} className="space-y-2"><RecipeThumbnail photoId={photo.id} alt={`${title}, photo ${index + 1}`} className="aspect-square w-full" /><figcaption><Button variant={photo.id === cover ? "secondary" : "outline"} className="w-full" size="sm" disabled={busy || photo.id === cover} onClick={async () => {
      const previous = cover; setCover(photo.id); setBusy(true); setError("");
      try { await api(`/api/recipes/${recipeId}/photos`, { body: { photoId: photo.id } }); router.refresh(); }
      catch (error) { setCover(previous); setError(error instanceof Error ? error.message : "Couldn’t change the cover photo."); }
      finally { setBusy(false); }
    }}>{photo.id === cover ? <><Check />Cover photo</> : "Use as cover"}</Button></figcaption></figure>)}</div>}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
  </section>;
}
