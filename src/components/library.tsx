"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ArrowRight, CalendarDays, ChevronDown, Clock3, Heart, LayoutGrid, List, ListChecks, Plus, Search, X } from "lucide-react";
import { type RecipeSummary, searchLibrary } from "@/domain/recipe";
import type { ArtifactSummary } from "@/domain/artifact";
import type { listPendingImports } from "@/services/imports";
import { cn } from "@/lib/utils";
import { AccountMenu } from "./account-menu";
import { Brand, SiftMark } from "./brand";
import { FavoriteButton } from "./favorite-button";
import { RecipeThumbnail } from "./recipe-thumbnail";
import { PendingImports } from "./pending-imports";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { formatDuration } from "@/lib/format-duration";

export function LibraryView({ initialRecipes, initialImports, recentArtifacts, name, allowProductionSync = false }: { initialRecipes: RecipeSummary[]; initialImports: Awaited<ReturnType<typeof listPendingImports>>; recentArtifacts: ArtifactSummary[]; name: string; allowProductionSync?: boolean }) {
  const [favoriteChanges, setFavoriteChanges] = useState<{ source: RecipeSummary[]; values: Record<string, boolean> }>({ source: initialRecipes, values: {} });
  const [query, setQuery] = useState(""), [favorites, setFavorites] = useState(false), [status, setStatus] = useState("current"), [layout, setLayout] = useState<"grid" | "list">("grid");
  const [recentOnly, setRecentOnly] = useState(false), [quick, setQuick] = useState(false), [vegetarian, setVegetarian] = useState(false), [collection, setCollection] = useState("");
  const search = useRef<HTMLInputElement>(null);
  const recipes = initialRecipes.map((recipe) => {
    const favorite = favoriteChanges.source === initialRecipes ? favoriteChanges.values[recipe.id] : undefined;
    return favorite === undefined ? recipe : { ...recipe, favorite };
  });
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === "k" && !document.querySelector('[role="dialog"]')) { event.preventDefault(); search.current?.focus(); }
    };
    window.addEventListener("keydown", onKey); return () => window.removeEventListener("keydown", onKey);
  }, []);
  const filtered = searchLibrary(recipes, query).filter((r) => (!favorites || r.favorite) && (status === "archived" ? r.status === "archived" : r.status === "active") && (!quick || (r.totalMinutes !== null && r.totalMinutes < 30)) && (!vegetarian || r.tags.some((tag) => /^(vegetarian|vegan)$/i.test(tag))) && (!collection || r.collections.includes(collection)));
  const visible = recentOnly ? [...filtered].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 8) : filtered;
  const collections = [...new Set(recipes.flatMap((recipe) => recipe.collections))].sort();
  const showRecent = !query && !favorites && !recentOnly && !quick && !vegetarian && !collection && status !== "archived";
  const chip = (selected: boolean) => cn("h-11 rounded-full border border-border/50 bg-muted/30 px-4 text-xs text-muted-foreground hover:text-foreground", selected && "border-transparent bg-selection text-selection-foreground hover:bg-selection/90 hover:text-selection-foreground");
  const changeFavorite = (id: string, favorite: boolean) => setFavoriteChanges((changes) => ({ source: initialRecipes, values: { ...(changes.source === initialRecipes ? changes.values : {}), [id]: favorite } }));

  return <div className="library-shell mx-auto min-h-dvh max-w-[1200px] px-5 pb-32 sm:px-8 lg:px-12">
    <header className="flex h-24 items-center justify-between gap-4"><Brand /><AccountMenu name={name} allowProductionSync={allowProductionSync} /></header>
    <main id="main" className="pt-3 sm:pt-5">
      <h1 className="sr-only">Library</h1>
      <div className="mb-7 flex w-full items-center gap-3 sm:gap-4">
        <div role="search" className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-4 top-1/2 size-[18px] -translate-y-1/2 text-muted-foreground" />
          <Input ref={search} aria-label="Search recipes" placeholder="Search recipes, ingredients, or notes…" value={query} onChange={(event) => setQuery(event.target.value)} className="h-12 rounded-2xl border-border bg-muted/20 pl-11 pr-12 text-base shadow-none placeholder:text-muted-foreground sm:pr-16 sm:text-sm" maxLength={200} />
          {query ? <Button variant="ghost" size="icon" aria-label="Clear search" className="absolute right-1 top-1/2 -translate-y-1/2 rounded-xl" onClick={() => { setQuery(""); search.current?.focus(); }}><X /></Button> : <kbd className="absolute right-4 top-1/2 hidden -translate-y-1/2 text-[11px] text-muted-foreground sm:block">⌘ K</kbd>}
        </div>
        <Button asChild className="size-12 rounded-2xl p-0"><Link href="/recipes/new" aria-label="Add recipe" title="Add recipe"><Plus className="size-5" /></Link></Button>
      </div>
      {showRecent && <PendingImports initial={initialImports} />}
      {showRecent && recentArtifacts.length > 0 && <section aria-labelledby="recent-artifacts-heading" className="mb-10">
        <h2 id="recent-artifacts-heading" className="mb-4 text-sm font-medium">On your counter</h2>
        <div className="grid gap-3 sm:grid-cols-2">{recentArtifacts.map((artifact) => {
          const Icon = artifact.kind === "grocery" ? ListChecks : CalendarDays;
          return <Link key={artifact.id} href={`/artifacts/${artifact.id}`} className="flex min-w-0 items-center gap-3 rounded-2xl border border-border/70 bg-muted/20 px-4 py-3.5 transition-colors hover:bg-muted/60"><span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-muted"><Icon className="size-[18px] text-muted-foreground" /></span><span className="min-w-0"><span className="block truncate text-sm font-medium">{artifact.title}</span><span className="mt-1 block text-xs text-muted-foreground">{artifact.kind === "grocery" ? "Grocery list" : "Meal plan"}</span></span><ArrowRight className="ml-auto size-4 shrink-0 text-muted-foreground" /></Link>;
        })}</div>
      </section>}
      <section id="all-recipes" aria-labelledby="all-heading" className="scroll-mt-6">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <nav aria-label="Cookbook filters" className="flex max-w-full items-center gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <Button variant="ghost" aria-pressed={!favorites && !recentOnly} className={chip(!favorites && !recentOnly)} onClick={() => { setFavorites(false); setRecentOnly(false); }}>All<span className="text-[10px] opacity-70">{recipes.filter((recipe) => recipe.status === (status === "archived" ? "archived" : "active")).length}</span></Button>
            <Button variant="ghost" aria-pressed={recentOnly} className={chip(recentOnly)} onClick={() => { setRecentOnly(!recentOnly); setFavorites(false); }}>Recent</Button>
            <Button variant="ghost" aria-label="Filter favorites" aria-pressed={favorites} className={chip(favorites)} onClick={() => { setFavorites(!favorites); setRecentOnly(false); }}><Heart className="size-3.5" />Favorites</Button>
            <Button variant="ghost" aria-pressed={vegetarian} className={chip(vegetarian)} onClick={() => setVegetarian(!vegetarian)}>Vegetarian</Button>
            <Button variant="ghost" aria-pressed={quick} className={chip(quick)} onClick={() => setQuick(!quick)}>&lt; 30 min</Button>
          </nav>
          <div className="ml-auto flex max-w-full flex-wrap items-center justify-end gap-2">
            {collections.length > 0 && <select aria-label="Collection" value={collection} onChange={(event) => setCollection(event.target.value)} className="h-11 max-w-36 rounded-xl border bg-background px-2 text-xs text-muted-foreground"><option value="">Collections</option>{collections.map((item) => <option key={item}>{item}</option>)}</select>}
            <div className="relative"><select aria-label="Recipe status" value={status} onChange={(event) => setStatus(event.target.value)} className="h-11 max-w-[146px] appearance-none rounded-xl border-0 bg-transparent pl-2 pr-7 text-xs text-muted-foreground focus-visible:outline-2 focus-visible:outline-ring"><option value="current">Current recipes</option><option value="archived">Archived</option></select><ChevronDown className="pointer-events-none absolute right-2 top-1/2 size-3 -translate-y-1/2 text-muted-foreground" /></div>
            <div role="group" aria-label="Recipe layout" className="flex rounded-xl border border-border/60 p-0.5"><Button variant="ghost" size="icon" aria-label="Grid view" aria-pressed={layout === "grid"} className={cn("size-10 rounded-lg text-muted-foreground", layout === "grid" && "bg-muted text-foreground")} onClick={() => setLayout("grid")}><LayoutGrid className="size-4" /></Button><Button variant="ghost" size="icon" aria-label="List view" aria-pressed={layout === "list"} className={cn("size-10 rounded-lg text-muted-foreground", layout === "list" && "bg-muted text-foreground")} onClick={() => setLayout("list")}><List className="size-4" /></Button></div>
          </div>
        </div>
        <h2 id="all-heading" className={cn("mb-5 text-sm font-medium", !query && "sr-only")}>{query ? `Results for “${query}”` : favorites ? "Favorites" : recentOnly ? "Recently updated" : status === "archived" ? "Archived recipes" : "All recipes"}<span className="ml-2 font-normal text-muted-foreground">{visible.length}</span></h2>
        {visible.length ? <div className={layout === "grid" ? "grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4" : "divide-y rounded-2xl border border-border/70"}>
          {visible.map((recipe) => <article key={recipe.id} aria-label={`${recipe.title} recipe`} className={cn("group min-w-0", layout === "grid" && "overflow-hidden rounded-2xl border border-border/60 bg-card transition-colors hover:border-ring/50", layout === "list" && "flex items-center gap-4 p-3 sm:p-4")}>
            <div className={cn("relative", layout === "list" && "shrink-0")}>
              <RecipeThumbnail photoId={recipe.coverPhotoId} recipeId={recipe.id} stockPhoto={recipe.stockPhoto} title={recipe.title} tags={recipe.tags} imageHref={`/recipes/${recipe.id}`} sizes={layout === "grid" ? "(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 270px" : "128px"} className={layout === "grid" ? "aspect-[4/3] w-full rounded-none" : "size-20 rounded-xl sm:h-24 sm:w-32"} />
              {layout === "grid" && <div className="absolute right-2.5 top-2.5"><FavoriteButton id={recipe.id} initial={recipe.favorite} className="size-10 rounded-full bg-background/95 text-foreground shadow-sm hover:bg-background" onChange={(favorite) => changeFavorite(recipe.id, favorite)} /></div>}
            </div>
            <div className={cn("min-w-0", layout === "grid" ? "px-3 pb-3 pt-3 sm:px-4 sm:pb-4" : "flex-1")}>
              <Link href={`/recipes/${recipe.id}`} className="block rounded-sm hover:underline focus-visible:outline-2 focus-visible:outline-ring"><h3 className="line-clamp-2 min-h-[2.75em] text-[13px] font-medium leading-snug tracking-[-.015em] sm:text-sm">{recipe.title}</h3></Link>
              {layout === "list" && recipe.description && <p className="mt-1.5 line-clamp-1 text-xs leading-5 text-muted-foreground">{recipe.description}</p>}
              <div className="mt-3 flex flex-wrap items-center gap-x-2.5 gap-y-2 text-[11px] text-muted-foreground">
                {recipe.totalMinutes !== null && <span className="inline-flex items-center gap-1"><Clock3 className="size-3" />{formatDuration(recipe.totalMinutes)}</span>}
                {(layout === "list" ? recipe.tags.slice(0, 2) : []).map((tag) => <span key={tag} className="rounded-md bg-muted/80 px-2 py-1 leading-none">{tag}</span>)}
                {recipe.status === "archived" && <span>Archived</span>}
              </div>
            </div>
            {layout === "list" && <FavoriteButton id={recipe.id} initial={recipe.favorite} onChange={(favorite) => changeFavorite(recipe.id, favorite)} />}
          </article>)}
        </div> : <div className="flex min-h-80 flex-col items-center justify-center rounded-3xl border border-dashed border-border/80 bg-muted/15 px-6 text-center">
          <span className="mb-5 flex size-16 items-center justify-center rounded-2xl bg-muted/75">{query ? <Search className="size-6 text-muted-foreground" /> : favorites ? <Heart className="size-6 text-muted-foreground" /> : <SiftMark className="size-8 text-muted-foreground" />}</span>
          <h3 className="text-xl font-medium tracking-tight">{query || quick || vegetarian || collection ? "No recipes found." : favorites ? "Keep your favorites close." : status === "archived" ? "No archived recipes." : "A fresh page."}</h3>
          <p className="mt-3 max-w-sm text-sm leading-relaxed text-muted-foreground">{query || quick || vegetarian || collection ? "Try another search or clear a filter to see more recipes." : favorites ? "Tap the heart on any recipe to find it here." : status === "archived" ? "Recipes you archive will appear here." : "A link, a family favorite, a photo of a recipe. Save something you’d like to make again."}</p>
          {(query || quick || vegetarian || collection) && <Button variant="ghost" className="mt-4 rounded-full" onClick={() => { setQuery(""); setQuick(false); setVegetarian(false); setCollection(""); search.current?.focus(); }}>Clear filters<ArrowRight className="size-4" /></Button>}
          {!query && !favorites && !quick && !vegetarian && !collection && status !== "archived" && <Button asChild variant="outline" className="mt-6 rounded-full"><Link href="/recipes/new"><Plus />Add your first recipe</Link></Button>}
        </div>}
      </section>
    </main>
  </div>;
}
