"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { LoaderCircle } from "lucide-react";
import { api } from "@/lib/client-http";
import { RecipeForm } from "./recipe-form";
import { PhotoUpload } from "./photo-upload";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Textarea } from "./ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs";

export function NewRecipeForm() {
  const router = useRouter();
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  async function startImport(input: unknown) {
    const result = await api<{ id: string }>("/api/imports", { body: input });
    router.push(`/imports/${result.id}`); router.refresh();
  }
  return <Tabs defaultValue="manual" className="mt-8" onValueChange={() => setError("")}>
    <TabsList className="grid h-auto w-full grid-cols-2 gap-1 sm:grid-cols-4"><TabsTrigger value="manual" className="min-h-11">Manual</TabsTrigger><TabsTrigger value="paste" className="min-h-11">Paste text</TabsTrigger><TabsTrigger value="url" className="min-h-11">From a URL</TabsTrigger><TabsTrigger value="image" className="min-h-11">From a photo</TabsTrigger></TabsList>
    <TabsContent value="manual"><RecipeForm /></TabsContent>
    {(["paste", "url"] as const).map((kind) => <TabsContent value={kind} key={kind}><form className="mt-6 space-y-5" onSubmit={async (event) => {
      event.preventDefault(); const form = new FormData(event.currentTarget); setBusy(true); setError("");
      try { await startImport(kind === "paste" ? { kind, text: String(form.get("text")) } : { kind, url: String(form.get("url")) }); }
      catch (error) { setError(error instanceof Error ? error.message : "Couldn’t start this import."); }
      finally { setBusy(false); }
    }}>
      <p className="text-sm leading-relaxed text-muted-foreground">{kind === "paste" ? "Paste a recipe from anywhere. Include the title, ingredients, and instructions; Sift will prepare a draft for you to review." : "Bring a recipe into your cookbook from its original page. You’ll be able to check and correct it before saving."}</p>
      {kind === "paste" ? <label className="block text-sm font-medium">Recipe text<Textarea name="text" required minLength={20} maxLength={80000} className="mt-2 min-h-72 leading-relaxed" placeholder={"Lemon pasta\n\nIngredients\n200 g pasta\n1 lemon\n\nInstructions\nCook the pasta. Toss with lemon."} /></label> : <label className="block text-sm font-medium">Recipe URL<Input name="url" type="url" required maxLength={4000} placeholder="https://example.com/your-favorite-recipe" className="mt-2" /></label>}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <Button type="submit" disabled={busy}>{busy && <LoaderCircle className="animate-spin" />}Review recipe</Button>
    </form></TabsContent>)}
    <TabsContent value="image" className="mt-6"><PhotoUpload purpose="import" onUploaded={(photoId) => startImport({ kind: "image", photoId })} /><p className="mt-4 text-xs text-muted-foreground">This image is used for reading the recipe. Add photos of the dish after saving.</p></TabsContent>
  </Tabs>;
}
