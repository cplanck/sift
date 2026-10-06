"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { LoaderCircle } from "lucide-react";
import { contentFromForm } from "@/domain/recipe-text";
import type { RecipeContent } from "@/domain/recipe";
import { api } from "@/lib/client-http";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Textarea } from "./ui/textarea";

export function RecipeForm({ initialContent, importId, expectedVersionId, onDirty }: { onDirty?: () => void; initialContent?: RecipeContent; importId?: string; expectedVersionId?: string }) {
  const [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const router = useRouter();
  const ingredients = initialContent?.ingredientSections.map((section) => [section.name ? `[${section.name}]` : "", ...section.items.map((item) => item.text)].filter(Boolean).join("\n")).join("\n\n") ?? "";
  const instructions = initialContent?.instructionSections.map((section) => [section.name ? `[${section.name}]` : "", ...section.steps].filter(Boolean).join("\n")).join("\n\n") ?? "";
  return <form className="mt-8 space-y-6" onChange={onDirty} onSubmit={async (event) => {
    event.preventDefault(); const data = new FormData(event.currentTarget); setError(""); setBusy(true);
    const content = contentFromForm(data);
    content.totalMinutes = data.get("totalMinutes") ? Number(data.get("totalMinutes")) : null;
    content.collections = String(data.get("collections") ?? "").split(",").map((value) => value.trim()).filter(Boolean);
    // Preserve untouched extraction structure, including normalized ingredients,
    // multiline instructions, and names containing punctuation.
    if (initialContent) {
      if (data.get("ingredients") === ingredients) content.ingredientSections = initialContent.ingredientSections;
      else content.ingredientSections = content.ingredientSections.map((section) => ({ ...section, items: section.items.map((item) => initialContent.ingredientSections.flatMap((section) => section.items).find((original) => original.text === item.text) ?? item) }));
      if (data.get("instructions") === instructions) content.instructionSections = initialContent.instructionSections;
      if (data.get("tags") === initialContent.tags.join(", ")) content.tags = initialContent.tags;
      if (data.get("collections") === initialContent.collections.join(", ")) content.collections = initialContent.collections;
    }
    try {
      let id: string;
      if (importId) { const result = await api<{ recipeId: string }>(`/api/imports/${importId}`, { body: { content, expectedVersionId } }); id = result.recipeId; }
      else { const result = await api<{ id: string }>("/api/recipes", { body: { content, source: { type: "manual" }, status: "active" } }); id = result.id; }
      router.push(`/recipes/${id}`); router.refresh();
    }
    catch (error) { setError(error instanceof Error ? error.message : "Couldn’t save this recipe."); }
    finally { setBusy(false); }
  }}>
    <label className="block text-sm font-medium">Recipe title<Input name="title" required maxLength={160} defaultValue={initialContent?.title} className="mt-2" placeholder="The one everyone asks for" /></label>
    <label className="block text-sm font-medium">A few words about it <span className="font-normal text-muted-foreground">(optional)</span><Textarea name="description" maxLength={4000} defaultValue={initialContent?.description} className="mt-2" /></label>
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3"><label className="text-sm">Servings<Input name="servings" type="number" min={0.125} max={1000} step="any" defaultValue={initialContent?.servings ?? 4} required className="mt-2" /></label><label className="text-sm">Prep (min)<Input name="prepMinutes" type="number" min={0} max={10080} defaultValue={initialContent?.prepMinutes ?? ""} className="mt-2" /></label><label className="text-sm">Cook (min)<Input name="cookMinutes" type="number" min={0} max={10080} defaultValue={initialContent?.cookMinutes ?? ""} className="mt-2" /></label></div>
    <label className="block text-sm font-medium">Ingredients<Textarea name="ingredients" required maxLength={80000} defaultValue={ingredients} className="mt-2 min-h-40 leading-relaxed" placeholder={"½ cup olive oil\n2–3 tbsp lemon juice\nSalt to taste"} /></label>
    <p className="-mt-3 text-xs text-muted-foreground">One ingredient per line. Use [Sauce] or another heading for a section.</p>
    <label className="block text-sm font-medium">Instructions<Textarea name="instructions" required maxLength={120000} defaultValue={instructions} className="mt-2 min-h-40 leading-relaxed" placeholder="One step per line. Section headings work here too." /></label>
    <label className="block text-sm">Tags <span className="text-muted-foreground">(optional, separated by commas)</span><Input name="tags" maxLength={2000} defaultValue={initialContent?.tags.join(", ")} className="mt-2" placeholder="Weeknight, Italian" /></label>
    <details className="rounded-xl border px-4 py-2"><summary className="cursor-pointer py-2 text-sm font-medium">Yield, total time & collections</summary><div className="my-3 space-y-5"><div className="grid grid-cols-2 gap-3"><label className="text-sm">Yield<Input name="yieldText" maxLength={150} defaultValue={initialContent?.yieldText} placeholder="12 cookies" className="mt-2" /></label><label className="text-sm">Total (min)<Input name="totalMinutes" type="number" min={0} max={20160} defaultValue={initialContent?.totalMinutes ?? ""} className="mt-2" /></label></div><label className="block text-sm">Collections <span className="text-muted-foreground">(separated by commas)</span><Input name="collections" maxLength={2000} defaultValue={initialContent?.collections.join(", ")} className="mt-2" /></label></div></details>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    <Button type="submit" disabled={busy} className="w-full sm:w-auto">{busy && <LoaderCircle className="animate-spin" />}Save recipe</Button>
  </form>;
}
