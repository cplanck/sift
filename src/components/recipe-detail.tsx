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
import { formatDuration } from "@/lib/format-duration";
import { ingredientName, scaleIngredient } from "@/domain/scaling";
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
  const [section, setSection] = useState("ingredients");
  const [showAmounts, setShowAmounts] = useState(false);
  const description = content.description.split(/\b(?:substitutions?|notes?|tips?):/i)[0].trim();
  const summary = description.length > 180 ? `${description.slice(0, 177).replace(/\s+\S*$/, "")}…` : description;
  const hasMoreDescription = summary !== content.description;
  const total = content.totalMinutes ?? ((content.prepMinutes ?? 0) + (content.cookMinutes ?? 0) || null);
  const completedCooks = cookingHistory.filter((cook) => cook.status === "completed");
  const lastCook = completedCooks.reduce<string | null>((latest, cook) => {
    const date = cook.finishedAt ?? cook.startedAt;
    return !latest || date > latest ? date : latest;
  }, null);
  return <main id="main" className="mx-auto w-full max-w-[1120px] px-5 pb-32 pt-5 sm:px-8 sm:pt-8 lg:px-12">
    <OfflineRecipeSnapshot snapshot={{ recipeId: recipe.id, versionId: recipe.version.id, versionNumber: recipe.version.number, content, coverPhotoId: recipe.coverPhotoId }} />
    <div className="mb-4 flex items-center justify-between gap-3 sm:mb-6"><Link href="/library" className="inline-flex min-h-11 items-center gap-2 rounded-lg text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"><ArrowLeft size={16} />All recipes</Link><div className="flex items-center gap-1">{recipe.status === "active" && <ShareRecipe recipeId={recipe.id} versionId={recipe.version.id} versionNumber={recipe.version.number} coverPhotoId={recipe.coverPhotoId} />}<FavoriteButton id={recipe.id} initial={recipe.favorite} />
      <DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" size="icon" aria-label="Recipe options"><MoreHorizontal /></Button></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuItem onSelect={() => { setError(""); setDialog("rename"); }}><Pencil />Rename recipe</DropdownMenuItem>{recipe.status !== "draft" && <DropdownMenuItem onSelect={() => { setError(""); setDialog("archive"); }}><Archive />{recipe.status === "archived" ? "Return to Library" : "Archive recipe"}</DropdownMenuItem>}</DropdownMenuContent></DropdownMenu>
    </div></div>
    {recipe.status !== "active" && <div className="mb-6 flex flex-wrap items-center justify-between gap-4 rounded-xl border bg-muted/40 p-4 text-sm"><span>{recipe.status === "draft" ? "This recipe is a draft. Review it before saving to your Library." : "This recipe is archived."}</span>{recipe.status === "draft" ? recipe.reviewImportId && <Button asChild size="sm"><Link href={`/imports/${recipe.reviewImportId}`}>Review import</Link></Button> : <Button disabled={busy} size="sm" onClick={() => mutate({ action: "status", status: "active" })}>Return to Library</Button>}</div>}
    <div className="grid items-start gap-6 sm:grid-cols-[minmax(0,.8fr)_minmax(0,1.2fr)] sm:gap-8">
      <RecipeThumbnail photoId={recipe.coverPhotoId} recipeId={recipe.id} stockPhoto={recipe.stockPhoto} title={content.title} tags={content.tags} alt={content.title} eager sizes="(max-width: 640px) 100vw, 420px" className="aspect-[2/1] w-full rounded-2xl sm:aspect-square" />
      <header className="min-w-0 py-1">
        <h1 className="break-words text-[28px] font-semibold leading-[1.15] tracking-[-.035em] text-balance sm:text-[32px] lg:text-[36px]">{content.title}</h1>
        {summary && <p className="mt-3 text-sm leading-6 text-muted-foreground">{summary}{hasMoreDescription && <button className="ml-1 underline underline-offset-4 hover:text-foreground" onClick={() => { setSection("notes"); document.getElementById("recipe-sections")?.scrollIntoView({ behavior: "smooth", block: "start" }); }}>Read more</button>}</p>}
        {content.tags.length > 0 && <div className="mt-4 flex flex-wrap gap-1.5">{content.tags.map((tag) => <span key={tag} className="rounded-full border border-border/70 bg-muted/30 px-2.5 py-1 text-[10px] text-muted-foreground">{tag}</span>)}</div>}
        <dl className="my-5 flex flex-wrap gap-x-6 gap-y-3 border-y border-border/60 py-4">
          {([["Total", total], ["Prep", content.prepMinutes], ["Cook", content.cookMinutes]] as const).filter(([, minutes]) => minutes !== null).map(([label, minutes]) => <div key={label}><dt className="mb-1 text-[10px] text-muted-foreground">{label}</dt><dd className="flex items-center gap-1.5 text-xs font-medium"><Clock3 className="size-3.5 text-muted-foreground" />{formatDuration(minutes!)}</dd></div>)}
          <div><dt className="mb-1 text-[10px] text-muted-foreground">Serves</dt><dd className="text-xs font-medium">{servings}</dd></div>
        </dl>
        {(recipe.status === "active" || activeSessionId) && <div className="max-w-sm"><CookRecipe recipeId={recipe.id} versionId={recipe.version.id} servings={servings} activeSessionId={activeSessionId} /></div>}
        {completedCooks.length > 0 && <p className="mt-3 text-[11px] text-muted-foreground">Cooked {completedCooks.length} {completedCooks.length === 1 ? "time" : "times"}{lastCook && ` · Last made ${new Date(lastCook).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })}`}</p>}
      </header>
    </div>
    <Tabs id="recipe-sections" value={section} onValueChange={setSection} className="mt-6 scroll-mt-5 gap-6 sm:mt-8">
      <TabsList aria-label="Recipe sections" className="group-data-[orientation=horizontal]/tabs:h-auto h-auto w-full justify-start gap-4 overflow-x-auto overflow-y-hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden rounded-none border-b bg-transparent p-0 sm:gap-8">
        {[["ingredients", "Ingredients"], ["instructions", "Instructions"], ["notes", "Notes"], ["photos", "Photos"], ["history", "History"]].map(([value, label]) => <TabsTrigger key={value} value={value} className="min-h-12 flex-none rounded-none border-0 border-b-2 border-transparent px-0.5 text-[13px] shadow-none data-[state=active]:border-foreground data-[state=active]:bg-transparent data-[state=active]:shadow-none dark:data-[state=active]:border-foreground dark:data-[state=active]:bg-transparent sm:text-sm">{label}{value === "notes" && notes.length > 0 && <span className="ml-1 text-xs text-muted-foreground">{notes.length}</span>}</TabsTrigger>)}
      </TabsList>
      <TabsContent value="ingredients">
        <div className="grid items-start gap-10 md:grid-cols-[minmax(0,1fr)_260px] md:gap-16">
          <section aria-label="Ingredients" className="min-w-0">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-4">
              <h2 className="text-xl font-semibold tracking-tight">Ingredients</h2>
              <Button variant="outline" size="sm" className="rounded-full" aria-pressed={showAmounts} onClick={() => setShowAmounts(!showAmounts)}>{showAmounts ? "Hide amounts" : "Show amounts"}</Button>
            </div>
            {showAmounts && <div className="mb-4 flex items-center gap-2">
                <label htmlFor="servings" className="mr-1 text-xs text-muted-foreground">Servings</label>
                <div className="flex items-center rounded-full border bg-background p-0.5">
                  <Button size="icon" variant="ghost" className="size-11 rounded-full" aria-label="Fewer servings" disabled={servings <= 1} onClick={() => setServings(Math.max(1, servings - 1))}><Minus className="size-3.5" /></Button>
                  <Input id="servings" type="number" min={0.125} max={1000} step="any" value={servings} onChange={(event) => { const value = Number(event.target.value); if (value > 0 && value <= 1000) setServings(value); }} className="h-10 w-14 rounded-lg border-0 bg-transparent px-0 text-center text-sm font-medium shadow-none [appearance:textfield] dark:bg-transparent [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none" />
                  <Button size="icon" variant="ghost" className="size-11 rounded-full" aria-label="More servings" disabled={servings >= 1000} onClick={() => setServings(Math.min(1000, servings + 1))}><Plus className="size-3.5" /></Button>
                </div>
            </div>}
            {showAmounts && servings !== content.servings && <div className="mb-5 flex items-start justify-between gap-4 rounded-xl bg-muted/60 px-4 py-3"><p className="text-xs leading-5 text-muted-foreground">Scaled for this view. Adjust seasoning and cooking times to suit.</p><Button variant="ghost" size="sm" className="-my-2 shrink-0 text-xs" onClick={() => setServings(content.servings)}>Reset</Button></div>}
            <div className="space-y-8">{content.ingredientSections.map((section, sectionIndex) => <div key={sectionIndex}>
              {section.name && <h3 className="mb-2 text-xs font-medium uppercase tracking-[.12em] text-muted-foreground">{section.name}</h3>}
              <ul className="divide-y divide-border/60">{section.items.map((ingredient, index) => <li key={index}>
                <label className="-mx-2 flex min-h-12 cursor-pointer items-start gap-3.5 rounded-lg px-2 py-3 transition-colors hover:bg-muted/50">
                  <input type="checkbox" className="peer mt-1 size-4 shrink-0 cursor-pointer rounded accent-foreground focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring" />
                  <span className="min-w-0 break-words text-sm leading-6 peer-checked:text-muted-foreground peer-checked:line-through peer-checked:decoration-muted-foreground/50">{showAmounts ? scaleIngredient(ingredient, servings / content.servings) : ingredientName(ingredient)}</span>
                </label>
              </li>)}</ul>
            </div>)}</div>
          </section>
          <aside className="rounded-2xl bg-muted/55 p-6">
            <h2 className="mb-5 text-sm font-semibold">At a glance</h2>
            <dl className="space-y-3.5 text-sm">
              {content.yieldText && <div className="flex justify-between gap-5"><dt className="text-muted-foreground">Makes</dt><dd className="text-right">{content.yieldText}</dd></div>}
              {content.prepMinutes !== null && <div className="flex justify-between gap-5"><dt className="text-muted-foreground">Prep</dt><dd>{formatDuration(content.prepMinutes)}</dd></div>}
              {content.cookMinutes !== null && <div className="flex justify-between gap-5"><dt className="text-muted-foreground">Cook</dt><dd>{formatDuration(content.cookMinutes)}</dd></div>}
              {total !== null && <div className="flex justify-between gap-5 border-t border-border/70 pt-3.5"><dt className="font-medium">Total time</dt><dd className="font-medium">{formatDuration(total)}</dd></div>}
              <div className="flex justify-between gap-5"><dt className="text-muted-foreground">Original servings</dt><dd>{content.servings}</dd></div>
            </dl>
            <div className="mt-6 border-t border-border/70 pt-5"><RecipeSourceInfo source={recipe.source} showOriginal /></div>
          </aside>
        </div>
      </TabsContent>
      <TabsContent value="instructions">
        <div className="max-w-3xl">
          <h2 className="mb-8 text-xl font-semibold tracking-tight">Instructions</h2>
          {content.instructionSections.map((section, sectionIndex) => <section key={sectionIndex} className="mb-10">
            {section.name && <h3 className="mb-5 text-xs font-medium uppercase tracking-[.12em] text-muted-foreground">{section.name}</h3>}
            <ol className="divide-y divide-border/60" start={content.instructionSections.slice(0, sectionIndex).reduce((count, section) => count + section.steps.length, 1)}>{section.steps.map((step, index) => <li key={index} className="flex gap-5 py-6 first:pt-0 sm:gap-7">
              <span aria-hidden="true" className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-medium tabular-nums">{content.instructionSections.slice(0, sectionIndex).reduce((count, section) => count + section.steps.length, index + 1)}</span>
              <p className="min-w-0 break-words pt-0.5 text-base leading-8 sm:text-lg">{step}</p>
            </li>)}</ol>
          </section>)}
        </div>
      </TabsContent>
      <TabsContent value="notes">
        <section className="max-w-2xl">
          {content.description && <div className="mb-8 rounded-2xl border border-border/60 bg-card p-5"><h2 className="mb-3 text-sm font-semibold">Recipe notes & substitutions</h2><p className="whitespace-pre-wrap text-sm leading-7 text-muted-foreground">{content.description}</p></div>}
          <h2 className="text-xl font-semibold tracking-tight">Notes for next time.</h2>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">The small changes that make it yours. Your saved recipe stays as it is.</p>
          <form className="my-7 rounded-2xl border bg-muted/25 p-3" onSubmit={async (event) => { event.preventDefault(); const form = event.currentTarget; const body = String(new FormData(form).get("body")); if (await mutate({ action: "note", body })) form.reset(); }}>
            <Textarea aria-label="Recipe note" name="body" required maxLength={5000} placeholder="A little more lemon next time…" className="min-h-28 resize-y border-0 bg-transparent px-2 text-[15px] shadow-none dark:bg-transparent" />
            <div className="mt-3 flex justify-end"><Button className="rounded-full px-5" disabled={busy} type="submit"><Plus className="size-3.5" />Add note</Button></div>
          </form>
          <div className="divide-y">{notes.map((note) => <article key={note.id} className="py-6 first:pt-0">
            <p className="mb-2 text-xs text-muted-foreground">{new Date(note.createdAt).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" })}</p>
            <p className="whitespace-pre-wrap break-words text-[15px] leading-7">{note.body}</p>
          </article>)}</div>
        </section>
      </TabsContent>
      <TabsContent value="photos"><RecipePhotos recipeId={recipe.id} initialPhotos={photos} coverPhotoId={recipe.coverPhotoId} title={content.title} /></TabsContent>
      <TabsContent value="history"><section className="max-w-3xl"><CookingHistory history={cookingHistory} /><h2 className="text-xl font-medium">Every version, kept.</h2><p className="mb-6 mt-2 text-sm text-muted-foreground">Restoring creates a new version. Your history stays intact.</p><div className="space-y-4">{versions.map((version) => <article key={version.id} className="rounded-2xl border p-5"><div className="flex flex-wrap items-center justify-between gap-4"><div><h3 className="flex items-center gap-2 font-medium"><History size={15} />Version {version.number}{version.id === recipe.version.id && <span className="text-xs font-normal text-muted-foreground">Current</span>}</h3><p className="mt-2 text-sm text-muted-foreground">{version.changeSummary}</p></div>{version.id !== recipe.version.id && <Button variant="outline" size="sm" disabled={busy} onClick={() => mutate({ action: "restore", versionId: version.id, expectedVersionId: recipe.version.id })}><RotateCcw />Restore version {version.number}</Button>}</div><details className="mt-4 text-sm"><summary className="cursor-pointer py-2 text-muted-foreground">View saved recipe</summary><h4 className="my-3 font-medium">{version.content.title}</h4>{version.content.ingredientSections.map((section, i) => <div key={i}><p className="mt-3 font-medium">{section.name}</p><ul className="list-inside list-disc space-y-1">{section.items.map((item, n) => <li key={n}>{item.text}</li>)}</ul></div>)}{version.content.instructionSections.map((section, i) => <div key={i}><p className="mt-3 font-medium">{section.name || "Instructions"}</p><ol className="list-inside list-decimal space-y-2">{section.steps.map((step, n) => <li key={n}>{step}</li>)}</ol></div>)}</details></article>)}</div></section></TabsContent>
    </Tabs>
    {error && <p role="alert" className="my-4 text-sm text-destructive">{error}</p>}
    <Dialog open={dialog !== null} onOpenChange={(open) => { if (!open) setDialog(null); }}><DialogContent className="max-h-[90dvh] overflow-y-auto"><DialogHeader><DialogTitle>{dialog === "rename" ? "Rename recipe" : recipe.status === "archived" ? "Return to Library?" : "Archive this recipe?"}</DialogTitle><DialogDescription>{dialog === "rename" ? "The previous title will remain in version history." : "You can find and restore archived recipes from the Library filter."}</DialogDescription></DialogHeader>
      {dialog === "rename" ? <form className="space-y-5" onSubmit={(event) => { event.preventDefault(); mutate({ action: "rename", title: new FormData(event.currentTarget).get("title"), expectedVersionId: recipe.version.id }); }}><label className="block text-sm">Recipe title<Input name="title" defaultValue={content.title} required maxLength={160} className="mt-2" /></label>{error && <p role="alert" className="text-sm text-destructive">{error}</p>}<DialogFooter><Button disabled={busy} type="submit"><Check />Save title</Button></DialogFooter></form> : <DialogFooter><Button variant="outline" onClick={() => setDialog(null)}>Cancel</Button><Button disabled={busy} onClick={() => mutate({ action: "status", status: recipe.status === "archived" ? "active" : "archived" })}>{recipe.status === "archived" ? "Return to Library" : "Archive recipe"}</Button></DialogFooter>}
    </DialogContent></Dialog>
  </main>;
}
