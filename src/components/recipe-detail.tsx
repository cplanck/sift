"use client";
import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Archive, ArrowLeft, Check, Clock3, History, MoreHorizontal, Pencil, Plus, RotateCcw, Minus } from "lucide-react";
import type { getRecipe, listRecipeNotes, listVersions } from "@/services/recipes";
import type { listRecipePhotos } from "@/services/photos";
import type { CookingHistoryItem } from "@/domain/cooking";
import { CookRecipe } from "./cook-recipe";
import { CookingHistory } from "./cooking-history";
import { OfflineRecipeSnapshot } from "./offline-recipe";
import { RecipePhotos } from "./recipe-photos";
import { RecipeThumbnail } from "./recipe-thumbnail";
import { RecipeSourceInfo } from "./recipe-source";
import { ShareRecipe } from "./share-recipe";
import { useAssistantPage } from "./assistant-shell";
import { scaleIngredient } from "@/domain/scaling";
import { api } from "@/lib/client-http";
import { FavoriteButton } from "./favorite-button";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Textarea } from "./ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "./ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "./ui/dropdown-menu";

type Recipe = Awaited<ReturnType<typeof getRecipe>>;
type Notes = Awaited<ReturnType<typeof listRecipeNotes>>;
type Versions = Awaited<ReturnType<typeof listVersions>>;

export function RecipeDetail({ recipe, notes, versions, photos, cookingHistory, activeSessionId }: { cookingHistory: CookingHistoryItem[]; activeSessionId?: string; recipe: Recipe; notes: Notes; versions: Versions; photos: Awaited<ReturnType<typeof listRecipePhotos>> }) {
  const content = recipe.version.content;
  useAssistantPage({ route: `/recipes/${recipe.id}`, activeRecipeId: recipe.id, activeRecipeVersionId: recipe.version.id, title: content.title });
  const [servings, setServings] = useState(content.servings), [dialog, setDialog] = useState<"rename" | "archive" | null>(null), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const router = useRouter();
  const mutate = async (body: unknown) => {
    setError(""); setBusy(true);
    try { await api(`/api/recipes/${recipe.id}/actions`, { body }); router.refresh(); setDialog(null); return true; }
    catch (error) { setError(error instanceof Error ? error.message : "Couldn’t save this change."); return false; }
    finally { setBusy(false); }
  };
  const total = content.totalMinutes ?? ((content.prepMinutes ?? 0) + (content.cookMinutes ?? 0) || null);
  return <main id="main" className="page-width max-w-5xl py-8 md:py-12">
    <OfflineRecipeSnapshot snapshot={{ recipeId: recipe.id, versionId: recipe.version.id, versionNumber: recipe.version.number, content, coverPhotoId: recipe.coverPhotoId }} />
    <div className="mb-6 flex items-center justify-between"><Link href="/library" className="inline-flex min-h-11 items-center gap-2 text-sm text-muted-foreground"><ArrowLeft size={16} />All recipes</Link><div className="flex items-center gap-1">{recipe.status === "active" && <ShareRecipe recipeId={recipe.id} versionId={recipe.version.id} versionNumber={recipe.version.number} coverPhotoId={recipe.coverPhotoId} />}<FavoriteButton id={recipe.id} initial={recipe.favorite} />
      <DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" size="icon" aria-label="Recipe options"><MoreHorizontal /></Button></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuItem onSelect={() => { setError(""); setDialog("rename"); }}><Pencil />Rename recipe</DropdownMenuItem>{recipe.status !== "draft" && <DropdownMenuItem onSelect={() => { setError(""); setDialog("archive"); }}><Archive />{recipe.status === "archived" ? "Return to Library" : "Archive recipe"}</DropdownMenuItem>}</DropdownMenuContent></DropdownMenu>
    </div></div>
    {recipe.status !== "active" && <div className="mb-6 flex flex-wrap items-center justify-between gap-4 rounded-xl border bg-muted/40 p-4 text-sm"><span>{recipe.status === "draft" ? "This recipe is a draft. Review it before saving to your Library." : "This recipe is archived."}</span>{recipe.status === "draft" ? recipe.reviewImportId && <Button asChild size="sm"><Link href={`/imports/${recipe.reviewImportId}`}>Review import</Link></Button> : <Button disabled={busy} size="sm" onClick={() => mutate({ action: "status", status: "active" })}>Return to Library</Button>}</div>}
    {recipe.coverPhotoId && <RecipeThumbnail key={recipe.coverPhotoId} photoId={recipe.coverPhotoId} alt={content.title} className="mb-8 aspect-[16/9] max-h-[420px] w-full rounded-2xl sm:aspect-[21/9]" />}
    <h1 className="max-w-3xl text-4xl font-semibold leading-tight tracking-[-.04em] md:text-5xl">{content.title}</h1>
    {content.description && <p className="mt-4 max-w-2xl text-base leading-relaxed text-muted-foreground md:text-lg">{content.description}</p>}
    <div className="mb-8 mt-5 flex flex-wrap items-center gap-2">{content.tags.map((tag) => <span key={tag} className="rounded-md bg-muted px-2.5 py-1 text-xs">{tag}</span>)}{total !== null && <span className="ml-1 inline-flex items-center gap-1.5 text-sm text-muted-foreground"><Clock3 size={14} />{total} min</span>}</div>
    {(recipe.status === "active" || activeSessionId) && <CookRecipe recipeId={recipe.id} versionId={recipe.version.id} servings={servings} activeSessionId={activeSessionId} />}
    <Tabs defaultValue="ingredients" className="mt-8 gap-6"><TabsList className="h-auto w-full justify-start gap-0 overflow-x-auto rounded-none border-b bg-transparent p-0">
      {[["ingredients", "Ingredients"], ["instructions", "Instructions"], ["notes", "Notes"], ["photos", "Photos"], ["history", "History"]].map(([value, label]) => <TabsTrigger key={value} value={value} className="min-h-12 flex-none rounded-none border-0 border-b-2 border-transparent px-3 shadow-none data-[state=active]:border-foreground data-[state=active]:bg-transparent data-[state=active]:shadow-none sm:px-5">{label}{value === "notes" && notes.length > 0 && <span className="ml-1 text-xs text-muted-foreground">{notes.length}</span>}</TabsTrigger>)}
    </TabsList>
      <TabsContent value="ingredients"><div className="grid gap-10 md:grid-cols-[1fr_260px]"><section aria-label="Ingredients"><div className="mb-6 flex flex-wrap items-center gap-3"><label htmlFor="servings" className="text-sm text-muted-foreground">Servings</label><Button size="icon" variant="outline" aria-label="Fewer servings" disabled={servings <= 1} onClick={() => setServings(Math.max(1, servings - 1))}><Minus /></Button><Input id="servings" type="number" min={0.125} max={1000} step="any" value={servings} onChange={(event) => { const value = Number(event.target.value); if (value > 0 && value <= 1000) setServings(value); }} className="w-20 text-center" /><Button size="icon" variant="outline" aria-label="More servings" disabled={servings >= 1000} onClick={() => setServings(Math.min(1000, servings + 1))}><Plus /></Button>{servings !== content.servings && <Button variant="ghost" size="sm" onClick={() => setServings(content.servings)}>Reset</Button>}</div>
        {content.ingredientSections.map((section, sectionIndex) => <div key={sectionIndex} className="mb-7">{section.name && <h2 className="mb-3 text-sm font-semibold">{section.name}</h2>}<ul className="space-y-1">{section.items.map((ingredient, index) => <li key={index}><label className="flex min-h-12 cursor-pointer items-start gap-3 rounded-lg px-1 py-3 hover:bg-muted/50"><input type="checkbox" className="mt-1 size-4 shrink-0 accent-foreground" /><span className="leading-relaxed">{scaleIngredient(ingredient, servings / content.servings)}</span></label></li>)}</ul></div>)}
        {servings !== content.servings && <p className="text-xs text-muted-foreground">Scaled for this view. Your saved recipe is unchanged. Adjust seasoning and cooking times to suit.</p>}
      </section><aside className="h-fit rounded-2xl border bg-muted/35 p-5"><h2 className="mb-4 text-sm font-semibold">About this recipe</h2><dl className="space-y-3 text-sm text-muted-foreground">{content.yieldText && <div className="flex justify-between gap-4"><dt>Yield</dt><dd>{content.yieldText}</dd></div>}{content.prepMinutes !== null && <div className="flex justify-between"><dt>Prep time</dt><dd>{content.prepMinutes} min</dd></div>}{content.cookMinutes !== null && <div className="flex justify-between"><dt>Cook time</dt><dd>{content.cookMinutes} min</dd></div>}{total !== null && <div className="flex justify-between"><dt>Total time</dt><dd>{total} min</dd></div>}<div className="flex justify-between"><dt>Saved servings</dt><dd>{content.servings}</dd></div><div className="flex justify-between"><dt>Version</dt><dd>{recipe.version.number}</dd></div></dl><div className="mt-5 border-t pt-4"><RecipeSourceInfo source={recipe.source} showOriginal /></div></aside></div></TabsContent>
      <TabsContent value="instructions"><div className="max-w-3xl">{content.instructionSections.map((section, sectionIndex) => <section key={sectionIndex} className="mb-10">{section.name && <h2 className="mb-6 text-lg font-medium">{section.name}</h2>}<ol className="space-y-8">{section.steps.map((step, index) => <li key={index} className="flex gap-5"><span className="flex size-9 shrink-0 items-center justify-center rounded-full border text-sm text-muted-foreground">{index + 1}</span><p className="pt-1 text-lg leading-relaxed">{step}</p></li>)}</ol></section>)}</div></TabsContent>
      <TabsContent value="notes"><section className="max-w-2xl"><h2 className="text-xl font-medium">Notes for next time.</h2><p className="mt-2 text-sm text-muted-foreground">Observations stay here without changing your recipe.</p><form className="my-6 space-y-3" onSubmit={async (event) => { event.preventDefault(); const form = event.currentTarget; const body = String(new FormData(form).get("body")); if (await mutate({ action: "note", body })) form.reset(); }}><Textarea aria-label="Recipe note" name="body" required maxLength={5000} placeholder="A little more lemon next time…" className="min-h-28" /><Button disabled={busy} type="submit">Add note</Button></form><div className="space-y-4">{notes.map((note) => <article key={note.id} className="rounded-2xl border p-5"><p className="whitespace-pre-wrap leading-relaxed">{note.body}</p><p className="mt-3 text-xs text-muted-foreground">{new Date(note.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })}</p></article>)}</div></section></TabsContent>
      <TabsContent value="photos"><RecipePhotos recipeId={recipe.id} initialPhotos={photos} coverPhotoId={recipe.coverPhotoId} title={content.title} /></TabsContent>
      <TabsContent value="history"><section className="max-w-3xl"><CookingHistory history={cookingHistory} /><h2 className="text-xl font-medium">Every version, kept.</h2><p className="mb-6 mt-2 text-sm text-muted-foreground">Restoring creates a new version. Your history stays intact.</p><div className="space-y-4">{versions.map((version) => <article key={version.id} className="rounded-2xl border p-5"><div className="flex flex-wrap items-center justify-between gap-4"><div><h3 className="flex items-center gap-2 font-medium"><History size={15} />Version {version.number}{version.id === recipe.version.id && <span className="text-xs font-normal text-muted-foreground">Current</span>}</h3><p className="mt-2 text-sm text-muted-foreground">{version.changeSummary}</p></div>{version.id !== recipe.version.id && <Button variant="outline" size="sm" disabled={busy} onClick={() => mutate({ action: "restore", versionId: version.id, expectedVersionId: recipe.version.id })}><RotateCcw />Restore version {version.number}</Button>}</div><details className="mt-4 text-sm"><summary className="cursor-pointer py-2 text-muted-foreground">View saved recipe</summary><h4 className="my-3 font-medium">{version.content.title}</h4>{version.content.ingredientSections.map((section, i) => <div key={i}><p className="mt-3 font-medium">{section.name}</p><ul className="list-inside list-disc space-y-1">{section.items.map((item, n) => <li key={n}>{item.text}</li>)}</ul></div>)}{version.content.instructionSections.map((section, i) => <div key={i}><p className="mt-3 font-medium">{section.name || "Instructions"}</p><ol className="list-inside list-decimal space-y-2">{section.steps.map((step, n) => <li key={n}>{step}</li>)}</ol></div>)}</details></article>)}</div></section></TabsContent>
    </Tabs>
    {error && <p role="alert" className="my-4 text-sm text-destructive">{error}</p>}
    <Dialog open={dialog !== null} onOpenChange={(open) => { if (!open) setDialog(null); }}><DialogContent className="max-h-[90dvh] overflow-y-auto"><DialogHeader><DialogTitle>{dialog === "rename" ? "Rename recipe" : recipe.status === "archived" ? "Return to Library?" : "Archive this recipe?"}</DialogTitle><DialogDescription>{dialog === "rename" ? "The previous title will remain in version history." : "You can find and restore archived recipes from the Library filter."}</DialogDescription></DialogHeader>
      {dialog === "rename" ? <form className="space-y-5" onSubmit={(event) => { event.preventDefault(); mutate({ action: "rename", title: new FormData(event.currentTarget).get("title"), expectedVersionId: recipe.version.id }); }}><label className="block text-sm">Recipe title<Input name="title" defaultValue={content.title} required maxLength={160} className="mt-2" /></label>{error && <p role="alert" className="text-sm text-destructive">{error}</p>}<DialogFooter><Button disabled={busy} type="submit"><Check />Save title</Button></DialogFooter></form> : <DialogFooter><Button variant="outline" onClick={() => setDialog(null)}>Cancel</Button><Button disabled={busy} onClick={() => mutate({ action: "status", status: recipe.status === "archived" ? "active" : "archived" })}>{recipe.status === "archived" ? "Return to Library" : "Archive recipe"}</Button></DialogFooter>}
    </DialogContent></Dialog>
  </main>;
}
