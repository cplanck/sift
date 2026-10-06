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
  return <Tabs defaultValue="url" className="mt-7" onValueChange={() => setError("")}>
    <TabsList aria-label="Add recipe method" className="group-data-[orientation=horizontal]/tabs:h-auto grid h-auto w-full grid-cols-4 gap-1 rounded-xl border border-border/60 bg-muted/30 p-1">{[["url", "URL"], ["image", "Photo"], ["paste", "Text"], ["manual", "Manual"]].map(([value, label]) => <TabsTrigger key={value} value={value} className="min-h-11 rounded-lg text-xs data-[state=active]:bg-selection data-[state=active]:text-selection-foreground dark:data-[state=active]:bg-selection dark:data-[state=active]:text-selection-foreground">{label}</TabsTrigger>)}</TabsList>
    <TabsContent value="manual"><RecipeForm /></TabsContent>
    {(["paste", "url"] as const).map((kind) => <TabsContent value={kind} key={kind}><form className="mt-6 flex min-h-72 flex-col gap-5" onSubmit={async (event) => {
      event.preventDefault(); const form = new FormData(event.currentTarget); setBusy(true); setError("");
      try { await startImport(kind === "paste" ? { kind, text: String(form.get("text")) } : { kind, url: String(form.get("url")) }); }
      catch (error) { setError(error instanceof Error ? error.message : "Couldn’t start this import."); }
      finally { setBusy(false); }
    }}>
      <p className="text-sm leading-relaxed text-muted-foreground">{kind === "paste" ? "Paste a recipe from anywhere. Include the title, ingredients, and instructions; Sift will prepare a draft for you to review." : "Found something good? Paste the link and we’ll prepare a recipe for you to review."}</p>
      {kind === "paste" ? <label className="block text-sm font-medium">Recipe text<Textarea name="text" required minLength={20} maxLength={80000} className="mt-2 min-h-72 leading-relaxed" placeholder={"Lemon pasta\n\nIngredients\n200 g pasta\n1 lemon\n\nInstructions\nCook the pasta. Toss with lemon."} /></label> : <label className="block text-sm font-medium">Recipe URL<Input name="url" type="url" required maxLength={4000} placeholder="Paste a recipe link…" className="mt-2 h-12" /></label>}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <Button type="submit" className="mt-auto h-12 w-full rounded-xl" disabled={busy}>{busy && <LoaderCircle className="animate-spin" />}Review recipe</Button>
    </form></TabsContent>)}
    <TabsContent value="image" className="mt-6"><PhotoUpload purpose="import" onUploaded={(photoId) => startImport({ kind: "image", photoId })} /><p className="mt-4 text-xs text-muted-foreground">This image is used for reading the recipe. Add photos of the dish after saving.</p></TabsContent>
  </Tabs>;
}
