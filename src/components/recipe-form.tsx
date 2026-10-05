"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { LoaderCircle } from "lucide-react";
import { contentFromForm } from "@/domain/recipe-text";
import { api } from "@/lib/client-http";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Textarea } from "./ui/textarea";

export function RecipeForm() {
  const [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const router = useRouter();
  return <form className="mt-10 space-y-6" onSubmit={async (event) => {
    event.preventDefault(); const data = new FormData(event.currentTarget); setError(""); setBusy(true);
    try { const recipe = await api<{ id: string }>("/api/recipes", { body: { content: contentFromForm(data), source: { type: "manual" }, status: "active" } }); router.push(`/recipes/${recipe.id}`); router.refresh(); }
    catch (error) { setError(error instanceof Error ? error.message : "Couldn’t save this recipe."); }
    finally { setBusy(false); }
  }}>
    <label className="block text-sm font-medium">Recipe title<Input name="title" required maxLength={160} className="mt-2" placeholder="The one everyone asks for" /></label>
    <label className="block text-sm font-medium">A few words about it <span className="font-normal text-muted-foreground">(optional)</span><Textarea name="description" maxLength={4000} className="mt-2" /></label>
    <div className="grid grid-cols-3 gap-3"><label className="text-sm">Servings<Input name="servings" type="number" min={0.125} max={1000} step="any" defaultValue={4} required className="mt-2" /></label><label className="text-sm">Prep (min)<Input name="prepMinutes" type="number" min={0} max={10080} className="mt-2" /></label><label className="text-sm">Cook (min)<Input name="cookMinutes" type="number" min={0} max={10080} className="mt-2" /></label></div>
    <label className="block text-sm font-medium">Ingredients<Textarea name="ingredients" required maxLength={30000} className="mt-2 min-h-40 leading-relaxed" placeholder={"½ cup olive oil\n2–3 tbsp lemon juice\nSalt to taste"} /></label>
    <p className="-mt-3 text-xs text-muted-foreground">One ingredient per line. Use [Sauce] or another heading for a section.</p>
    <label className="block text-sm font-medium">Instructions<Textarea name="instructions" required maxLength={50000} className="mt-2 min-h-40 leading-relaxed" placeholder="One step per line. Section headings work here too." /></label>
    <label className="block text-sm">Tags <span className="text-muted-foreground">(optional, separated by commas)</span><Input name="tags" maxLength={1000} className="mt-2" placeholder="Weeknight, Italian" /></label>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    <Button type="submit" disabled={busy} className="w-full sm:w-auto">{busy && <LoaderCircle className="animate-spin" />}Save recipe</Button>
  </form>;
}
