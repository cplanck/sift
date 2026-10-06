"use client";
import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Archive, ArrowLeft, Camera, Check, History, MoreHorizontal, NotebookPen, Pencil, Plus, RotateCcw, Minus, Share2, SlidersHorizontal } from "lucide-react";
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
import { pageFrame } from "./app-header";
import { ingredientName, ingredientMeasure, scaleIngredient } from "@/domain/scaling";
import { api } from "@/lib/client-http";
import { FavoriteButton } from "./favorite-button";
import { ShoppingListButton } from "./shopping-list-button";
import { cn } from "@/lib/utils";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Textarea } from "./ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "./ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "./ui/dropdown-menu";

import { cookingStepPresentation } from "@/domain/cooking-step-presentation";
import type { RecipeContent } from "@/domain/recipe";
import styles from "./recipe-detail.module.css";
import emptyStyles from "./recipe-empty-state.module.css";

type Recipe = Awaited<ReturnType<typeof getRecipe>>;
type Notes = Awaited<ReturnType<typeof listRecipeNotes>>;
type Versions = Awaited<ReturnType<typeof listVersions>>;

export function RecipeDetail({ recipe, notes, versions, photos, cookingHistory, activeSessionId }: { cookingHistory: CookingHistoryItem[]; activeSessionId?: string; recipe: Recipe; notes: Notes; versions: Versions; photos: Awaited<ReturnType<typeof listRecipePhotos>> }) {
  const content = recipe.version.content;
  useAssistantPage({ route: `/recipes/${recipe.id}`, activeRecipeId: recipe.id, activeRecipeVersionId: recipe.version.id, title: content.title });
  const [servings, setServings] = useState(content.servings), [dialog, setDialog] = useState<"rename" | "archive" | null>(null), [error, setError] = useState(""), [busy, setBusy] = useState(false), [sharing, setSharing] = useState(false);
  const router = useRouter();
  const [scaling, setScaling] = useState(false);
  const mutate = async (body: unknown) => {
    setError(""); setBusy(true);
    try { await api(`/api/recipes/${recipe.id}/actions`, { body }); router.refresh(); setDialog(null); return true; }
    catch (error) { setError(error instanceof Error ? error.message : "Couldn’t save this change."); return false; }
    finally { setBusy(false); }
  };
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [section, setSection] = useState("overview");
  const [showAmounts, setShowAmounts] = useState(true);
  const description = content.description.split(/\b(?:substitutions?|notes?|tips?):/i)[0].trim();
  const summary = description.length > 180 ? `${description.slice(0, 177).replace(/\s+\S*$/, "")}…` : description;
  const hasMoreDescription = summary !== content.description;
  const cooksWithNotes = cookingHistory.filter((cook) => cook.status !== "active" && (cook.notes.length > 0 || cook.summary));
  const noteCount = notes.length + cooksWithNotes.reduce((total, cook) => total + cook.notes.length + (cook.summary ? 1 : 0), 0);
  const completedCooks = cookingHistory.filter((cook) => cook.status === "completed");
  const lastCook = completedCooks.reduce<string | null>((latest, cook) => {
    const date = cook.finishedAt ?? cook.startedAt;
    return !latest || date > latest ? date : latest;
  }, null);
  return <main id="main" className={cn(pageFrame, styles.page)}>
    <OfflineRecipeSnapshot snapshot={{ recipeId: recipe.id, versionId: recipe.version.id, versionNumber: recipe.version.number, content, coverPhotoId: recipe.coverPhotoId }} />
    {recipe.status !== "active" && <div className="mb-6 flex flex-wrap items-center justify-between gap-4 rounded-xl border bg-muted/40 p-4 text-sm"><span>{recipe.status === "draft" ? "This recipe is a draft. Review it before saving to your Library." : "This recipe is archived."}</span>{recipe.status === "draft" ? recipe.reviewImportId && <Button asChild size="sm"><Link href={`/imports/${recipe.reviewImportId}`}>Review import</Link></Button> : <Button disabled={busy} size="sm" onClick={() => mutate({ action: "status", status: "active" })}>Return to Library</Button>}</div>}
    <div className={styles.hero}>
      <div className={styles.photo}>
        <RecipeThumbnail photoId={recipe.coverPhotoId} coverSelection={recipe.coverSelection} coverImage={recipe.coverImage} recipeId={recipe.id} stockPhoto={recipe.stockPhoto} title={content.title} tags={content.tags} alt={content.title} eager sizes="(max-width: 767px) 100vw, 40vw" className={styles.thumbnail} />
        <Link href="/library" className={styles.back} aria-label="All recipes"><ArrowLeft size={18} /></Link>
        <button type="button" onClick={() => setSection("photos")} className={styles.changePhoto}><Camera size={15} />Change photo</button>
      </div>
      <header className={styles.heroCopy}>
        <h1>{content.title}</h1>
        {summary && <p className={styles.summary}>{summary}{hasMoreDescription && <button className={styles.readMore} onClick={() => { setSection("overview"); setDetailsOpen(true); requestAnimationFrame(() => document.getElementById("recipe-source-details")?.scrollIntoView({ block: "nearest" })); }}>Read more</button>}</p>}
        <div className={styles.actions}>
          {(recipe.status === "active" || activeSessionId) && <div className={styles.cookAction}><CookRecipe recipeId={recipe.id} versionId={recipe.version.id} servings={servings} activeSessionId={activeSessionId} label="Start cooking" className={styles.startCooking} /></div>}
          {recipe.status === "active" && <ShoppingListButton recipeId={recipe.id} versionId={recipe.version.id} servings={servings} />}
          <FavoriteButton id={recipe.id} initial={recipe.favorite} className={styles.iconAction} />
          {recipe.status === "active" && <Button variant="ghost" size="icon" className={styles.iconAction} aria-label="Share recipe" onClick={() => setSharing(true)}><Share2 /></Button>}
      <DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className={styles.iconAction} aria-label="Recipe options"><MoreHorizontal /></Button></DropdownMenuTrigger><DropdownMenuContent align="end">{recipe.status === "active" && <DropdownMenuItem onSelect={() => setSharing(true)}><Share2 />Share recipe</DropdownMenuItem>}<DropdownMenuItem onSelect={() => { setError(""); setDialog("rename"); }}><Pencil />Rename recipe</DropdownMenuItem>{recipe.status !== "draft" && <DropdownMenuItem onSelect={() => { setError(""); setDialog("archive"); }}><Archive />{recipe.status === "archived" ? "Return to Library" : "Archive recipe"}</DropdownMenuItem>}</DropdownMenuContent></DropdownMenu>
        </div>
        {completedCooks.length > 0 && <p className={styles.cookHistory}>Cooked {completedCooks.length} {completedCooks.length === 1 ? "time" : "times"}{lastCook && ` · Last made ${new Date(lastCook).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })}`}</p>}
      </header>
    </div>
    <Tabs id="recipe-sections" value={section} onValueChange={setSection} className={styles.sections}>
      <TabsList aria-label="Recipe sections" className={styles.tabs}>
        {[["overview", "Overview"], ["recipe", "Recipe"], ["notes", "Notes"], ["photos", "Photos"]].map(([value, label]) => <TabsTrigger key={value} value={value} className={styles.tab}>{label}{value === "notes" && noteCount > 0 && <span className="ml-1 text-xs text-muted-foreground">{noteCount}</span>}</TabsTrigger>)}
      </TabsList>
      <TabsContent value="recipe" className={styles.recipePanel}>
        <div className={styles.overview}>
          <section aria-label="Ingredients" tabIndex={0} className={styles.ingredients}>
            <div className={styles.ingredientTools}>
              <h2>Ingredients</h2>
              <span>{servings} {servings === 1 ? "serving" : "servings"}</span>
              <Button variant="outline" size="sm" aria-expanded={scaling} aria-controls="recipe-scaling" onClick={() => setScaling(!scaling)}><SlidersHorizontal size={14} />Scale</Button>
            </div>
            {scaling && <div id="recipe-scaling" className={styles.scaling}>
              <label htmlFor="servings">Servings</label>
              <div className={styles.servingInput}>
                <Button size="icon" variant="ghost" aria-label="Fewer servings" disabled={servings <= 1} onClick={() => setServings(Math.max(1, servings - 1))}><Minus size={14} /></Button>
                <Input id="servings" type="number" min={0.125} max={1000} step="any" value={servings} onChange={(event) => { const value = Number(event.target.value); if (value > 0 && value <= 1000) setServings(value); }} />
                <Button size="icon" variant="ghost" aria-label="More servings" disabled={servings >= 1000} onClick={() => setServings(Math.min(1000, servings + 1))}><Plus size={14} /></Button>
              </div>
              <Button variant="ghost" size="sm" aria-pressed={showAmounts} onClick={() => setShowAmounts(!showAmounts)}>{showAmounts ? "Hide amounts" : "Show amounts"}</Button>
            </div>}
            {servings !== content.servings && <div className={styles.scaledNotice}><p>Scaled for this view. Adjust seasoning and cooking times to suit.</p><Button variant="ghost" size="sm" onClick={() => setServings(content.servings)}>Reset</Button></div>}
            <RecipeIngredientList content={content} servings={servings} showAmounts={showAmounts} />
          </section>
          <div className={styles.overviewInstructions} role="region" aria-label="Recipe instructions" tabIndex={0}><RecipeInstructions content={content} /></div>
        </div>
      </TabsContent>
      <TabsContent value="notes" className={styles.centeredTab}>
        {cooksWithNotes.length > 0 && <div className="mb-8 w-full max-w-2xl"><CookingHistory history={cooksWithNotes} /></div>}
        <section className={cn(emptyStyles.notes, notes.length === 0 && emptyStyles.emptyNotes)} aria-label="Recipe notes">
          <header className={emptyStyles.heading}>
            {notes.length === 0 && <span className={emptyStyles.icon}><NotebookPen size={27} strokeWidth={1.3} /></span>}
            <h2>{cooksWithNotes.length ? "General recipe notes" : notes.length === 0 ? "No notes yet" : "Notes for next time"}</h2>
            <p>{notes.length === 0 ? "A little more lemon, a little less heat. Remember what makes it yours." : "Your tweaks, discoveries, and ideas for the next cook."}</p>
          </header>
          <form className={emptyStyles.noteForm} onSubmit={async (event) => { event.preventDefault(); const form = event.currentTarget; const body = String(new FormData(form).get("body")); if (await mutate({ action: "note", body })) form.reset(); }}>
            <Textarea aria-label="Recipe note" name="body" required maxLength={5000} placeholder="What would you like to remember?" className={emptyStyles.noteInput} />
            <div className={emptyStyles.noteFooter}><span>Just for your recipe.</span><Button className={emptyStyles.primaryAction} disabled={busy} type="submit"><Plus size={15} />Add note</Button></div>
          </form>
          {notes.length > 0 && <div className={emptyStyles.savedNotes}>{notes.map((note) => <article key={note.id}>
            <p className={emptyStyles.noteDate}>{new Date(note.createdAt).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" })}</p>
            <p className={emptyStyles.noteBody}>{note.body}</p>
          </article>)}</div>}
        </section>
      </TabsContent>
      <TabsContent value="photos" className={styles.centeredTab}><RecipePhotos expectedVersionId={recipe.version.id} recipeId={recipe.id} initialPhotos={photos} coverPhotoId={recipe.coverPhotoId} title={content.title} /></TabsContent>
      <TabsContent value="overview" className={styles.recipePanel}>
        <div className={styles.overview}>
          <section aria-label="Overview ingredients" tabIndex={0} className={styles.ingredients}>
            <div className={styles.ingredientTools}><h2>Ingredients</h2><span>{servings} {servings === 1 ? "serving" : "servings"}</span></div>
            <RecipeIngredientList content={content} servings={servings} showAmounts />
          </section>
          <section aria-label="Recipe overview" tabIndex={0} className={styles.overviewSummary}>
            <div className={styles.pastCooks}><CookingHistory history={cookingHistory.filter((cook) => cook.status !== "active")} /></div>
            <details className={styles.overviewDisclosure}><summary>Version history<span>{versions.length}</span></summary><section>
              <h2 className="text-xl font-medium">Every version, kept.</h2><p className="mb-6 mt-2 text-sm text-muted-foreground">Restoring creates a new version. Your history stays intact.</p><div className="space-y-4">{versions.map((version) => <article key={version.id} className="rounded-2xl border p-5"><div className="flex flex-wrap items-center justify-between gap-4"><div><h3 className="flex items-center gap-2 font-medium"><History size={15} />Version {version.number}{version.id === recipe.version.id && <span className="text-xs font-normal text-muted-foreground">Current</span>}</h3><p className="mt-2 text-sm text-muted-foreground">{version.changeSummary}</p></div>{version.id !== recipe.version.id && <Button variant="outline" size="sm" disabled={busy} onClick={() => mutate({ action: "restore", versionId: version.id, expectedVersionId: recipe.version.id })}><RotateCcw />Restore version {version.number}</Button>}</div><details className="mt-4 text-sm"><summary className="cursor-pointer py-2 text-muted-foreground">View saved recipe</summary><h4 className="my-3 font-medium">{version.content.title}</h4>{version.content.ingredientSections.map((section, i) => <div key={i}><p className="mt-3 font-medium">{section.name}</p><ul className="list-inside list-disc space-y-1">{section.items.map((item, n) => <li key={n}>{item.text}</li>)}</ul></div>)}{version.content.instructionSections.map((section, i) => <div key={i}><p className="mt-3 font-medium">{section.name || "Instructions"}</p><ol className="list-inside list-decimal space-y-2">{section.steps.map((step, n) => <li key={n}>{step}</li>)}</ol></div>)}</details></article>)}</div>
            </section></details>
            <details id="recipe-source-details" open={detailsOpen} onToggle={(event) => setDetailsOpen(event.currentTarget.open)} className={styles.overviewDisclosure}><summary>Source & details</summary><div className="space-y-4 text-sm">
              {content.description && <p className="whitespace-pre-wrap leading-7 text-muted-foreground">{content.description}</p>}
              {content.yieldText && <p>Makes {content.yieldText}</p>}
              <p className="text-muted-foreground">Original recipe: {content.servings} servings</p>
              <RecipeSourceInfo source={recipe.source} showOriginal />
            </div></details>
          </section>
        </div>
      </TabsContent>
    </Tabs>
    {sharing && <ShareRecipe recipeId={recipe.id} versionId={recipe.version.id} versionNumber={recipe.version.number} coverPhotoId={recipe.coverPhotoId} onClose={() => setSharing(false)} />}
    {error && <p role="alert" className="my-4 text-sm text-destructive">{error}</p>}
    <Dialog open={dialog !== null} onOpenChange={(open) => { if (!open) setDialog(null); }}><DialogContent className="max-h-[90dvh] overflow-y-auto"><DialogHeader><DialogTitle>{dialog === "rename" ? "Rename recipe" : recipe.status === "archived" ? "Return to Library?" : "Archive this recipe?"}</DialogTitle><DialogDescription>{dialog === "rename" ? "The previous title will remain in version history." : "You can find and restore archived recipes from the Library filter."}</DialogDescription></DialogHeader>
      {dialog === "rename" ? <form className="space-y-5" onSubmit={(event) => { event.preventDefault(); mutate({ action: "rename", title: new FormData(event.currentTarget).get("title"), expectedVersionId: recipe.version.id }); }}><label className="block text-sm">Recipe title<Input name="title" defaultValue={content.title} required maxLength={160} className="mt-2" /></label>{error && <p role="alert" className="text-sm text-destructive">{error}</p>}<DialogFooter><Button disabled={busy} type="submit"><Check />Save title</Button></DialogFooter></form> : <DialogFooter><Button variant="outline" onClick={() => setDialog(null)}>Cancel</Button><Button disabled={busy} onClick={() => mutate({ action: "status", status: recipe.status === "archived" ? "active" : "archived" })}>{recipe.status === "archived" ? "Return to Library" : "Archive recipe"}</Button></DialogFooter>}
    </DialogContent></Dialog>
  </main>;
}


function RecipeInstructions({ content }: { content: RecipeContent }) {
  let number = 0;
  return <section aria-label="Instructions" className={styles.instructions}>
    <h2 className={styles.panelHeading}>Instructions</h2>
    {content.instructionSections.map((group, groupIndex) => <div key={groupIndex}>
      {group.name && <h3 className={styles.instructionGroup}>{group.name}</h3>}
      <ol start={number + 1}>{group.steps.map((step, index) => {
        const position = ++number;
        const { heading, instruction } = cookingStepPresentation(step, group.name, group.illustrationKeys?.[index]);
        const duration = step.match(/\b\d+(?:\s*[–-]\s*\d+)?\s*(?:minutes?|hours?|seconds?)\b/i)?.[0];
        return <li key={index} className={cn(styles.step, position === 1 && styles.firstStep)}>
          <span className={styles.stepNumber} aria-hidden="true">{position}</span>
          <div className={styles.stepCopy}><h4>{heading}</h4>{instruction && <p>{instruction}</p>}</div>
          {duration && <span className={styles.stepDuration}>{duration}</span>}
        </li>;
      })}</ol>
    </div>)}
  </section>;
}


function RecipeIngredientList({ content, servings, showAmounts }: { content: RecipeContent; servings: number; showAmounts: boolean }) {
  return <>{content.ingredientSections.map((group, groupIndex) => <div key={groupIndex} className={styles.ingredientGroup}>
              {group.name && <h3>{group.name}</h3>}
              <ul>{group.items.map((ingredient, index) => {
                const text = scaleIngredient(ingredient, servings / content.servings);
                const measure = ingredientMeasure(text);
                const split = measure ? measure.amountLength + (measure.unit ? text.slice(measure.amountLength).indexOf(measure.unit) + measure.unit.length : 0) : 0;
                return <li key={index}><label>
                  <input type="checkbox" />
                  {showAmounts && split > 0 ? <><span className={styles.amount}>{text.slice(0, split)}</span><span>{text.slice(split).trim()}</span></> : <span className={styles.wholeIngredient}>{showAmounts ? text : ingredientName(ingredient)}</span>}
                </label></li>;
              })}</ul>
            </div>)}</>;
}
