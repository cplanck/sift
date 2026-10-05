"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ArrowRight, BookOpen, CalendarDays, Heart, ListChecks, Plus, Search, X } from "lucide-react";
import { type RecipeSummary, searchLibrary } from "@/domain/recipe";
import type { ArtifactSummary } from "@/domain/artifact";
import type { listPendingImports } from "@/services/imports";
import { AccountMenu } from "./account-menu";
import { Brand, SiftMark } from "./brand";
import { FavoriteButton } from "./favorite-button";
import { RecipeThumbnail } from "./recipe-thumbnail";
import { PendingImports } from "./pending-imports";
import { Button } from "./ui/button";
import { Input } from "./ui/input";

export function LibraryView({ initialRecipes, initialImports, recentArtifacts, name }: { initialRecipes: RecipeSummary[]; initialImports: Awaited<ReturnType<typeof listPendingImports>>; recentArtifacts: ArtifactSummary[]; name: string }) {
  const [favoriteChanges, setFavoriteChanges] = useState<{ source: RecipeSummary[]; values: Record<string, boolean> }>({ source: initialRecipes, values: {} }), [query, setQuery] = useState(""), [favorites, setFavorites] = useState(false), [status, setStatus] = useState("current");
  const recipes = initialRecipes.map((recipe) => {
    const favorite = favoriteChanges.source === initialRecipes ? favoriteChanges.values[recipe.id] : undefined;
    return favorite === undefined ? recipe : { ...recipe, favorite };
  });
  const search = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if ((event.metaKey || event.ctrlKey) && event.key === "k") { event.preventDefault(); search.current?.focus(); } };
    window.addEventListener("keydown", onKey); return () => window.removeEventListener("keydown", onKey);
  }, []);
  const visible = searchLibrary(recipes, query).filter((r) => (!favorites || r.favorite) && (status === "archived" ? r.status === "archived" : r.status === "active"));
  const recent = recipes.filter((r) => r.status === "active").slice(0, 5);
  return <div className="mx-auto flex min-h-dvh max-w-[1600px]">
    <aside className="sticky top-0 hidden h-dvh w-48 shrink-0 flex-col border-r p-5 lg:flex">
      <div className="py-5"><Brand /></div>
      <nav aria-label="Cookbook filters" className="mt-8 space-y-2">
        <Button variant={!favorites ? "secondary" : "ghost"} className="w-full justify-start" aria-pressed={!favorites} onClick={() => setFavorites(false)}><BookOpen />Library</Button>
        <Button variant={favorites ? "secondary" : "ghost"} className="w-full justify-start" aria-pressed={favorites} onClick={() => setFavorites(true)}><Heart />Favorites</Button>
      </nav><p className="mt-auto pb-5 text-xs leading-relaxed text-muted-foreground">Your recipes.<br />Made your own.</p>
    </aside>
    <div className="min-w-0 flex-1 px-5 pb-20 md:px-10 lg:px-12">
      <header className="flex min-h-24 items-center justify-between gap-4"><div className="lg:hidden"><Brand /></div><span className="hidden text-sm text-muted-foreground lg:block">Your personal cookbook</span><AccountMenu name={name} /></header>
      <main id="main">
        <div className="relative"><Search className="pointer-events-none absolute left-4 top-4 size-4 text-muted-foreground" /><Input ref={search} aria-label="Search recipes" placeholder="Search recipes, ingredients, or notes…" value={query} onChange={(e) => setQuery(e.target.value)} className="h-12 rounded-2xl bg-muted/45 pl-11 pr-16" maxLength={200} />
          {query ? <Button variant="ghost" size="icon" aria-label="Clear search" className="absolute right-1 top-0.5" onClick={() => setQuery("")}><X /></Button> : <kbd className="absolute right-4 top-4 hidden rounded bg-muted px-1.5 text-xs text-muted-foreground sm:block">⌘ K</kbd>}
        </div>
        <div className="mb-10 mt-9 flex flex-wrap items-start justify-between gap-5"><div><h1 className="text-3xl font-semibold tracking-[-.04em] md:text-4xl">{favorites ? "Your favorites." : `Hello, ${name.split(" ")[0]}.`}</h1><p className="mt-2 text-muted-foreground">What are we cooking today?</p><span className="sr-only">Library</span></div><Button asChild><Link href="/recipes/new"><Plus />Add recipe</Link></Button></div>
        {!query && !favorites && status !== "archived" && <PendingImports initial={initialImports} />}
        {!query && !favorites && status !== "archived" && recentArtifacts.length > 0 && <section aria-labelledby="recent-artifacts-heading" className="mb-10"><h2 id="recent-artifacts-heading" className="mb-4 font-medium">On your counter</h2><div className="grid gap-3 sm:grid-cols-2">{recentArtifacts.map((artifact) => { const Icon = artifact.kind === "grocery" ? ListChecks : CalendarDays; return <Link key={artifact.id} href={`/artifacts/${artifact.id}`} className="flex min-w-0 items-center gap-3 rounded-2xl border p-4 hover:bg-muted/30"><Icon className="size-5 shrink-0 text-muted-foreground" /><span className="min-w-0"><span className="block truncate text-sm font-medium">{artifact.title}</span><span className="mt-1 block text-xs text-muted-foreground">{artifact.kind === "grocery" ? "Grocery list" : "Meal plan"}</span></span><ArrowRight className="ml-auto size-4 shrink-0 text-muted-foreground" /></Link>; })}</div><p className="mt-3 text-xs text-muted-foreground">Ask Sift to find an older list or plan.</p></section>}
        {!query && !favorites && status !== "archived" && recent.length > 0 && <section aria-labelledby="recent-heading" className="mb-10"><div className="mb-4 flex items-center justify-between"><h2 id="recent-heading" className="font-medium">Recent</h2><a href="#all-recipes" className="flex min-h-11 items-center gap-1 text-sm text-muted-foreground">View all <ArrowRight size={14} /></a></div>
          <div className="grid auto-cols-[148px] grid-flow-col gap-4 overflow-x-auto pb-3 sm:auto-cols-[180px]">{recent.map((recipe) => <Link key={recipe.id} href={`/recipes/${recipe.id}`} className="group min-w-0 rounded-xl focus-visible:outline-2 focus-visible:outline-ring"><RecipeThumbnail photoId={recipe.coverPhotoId} className="aspect-[4/3] w-full transition-colors group-hover:bg-border" /><h3 className="mt-3 truncate text-sm font-medium">{recipe.title}</h3><p className="mt-1 text-xs text-muted-foreground">{recipe.totalMinutes ? `${recipe.totalMinutes} min` : "Your recipe"}</p></Link>)}</div>
        </section>}
        <section id="all-recipes" aria-labelledby="all-heading"><div className="mb-4 flex flex-wrap items-center justify-between gap-3"><h2 id="all-heading" className="font-medium">{query ? `Results for “${query}”` : favorites ? "Favorites" : "All recipes"} <span className="ml-1 text-xs font-normal text-muted-foreground">{visible.length}</span></h2>
          <div className="flex items-center gap-2"><Button variant={favorites ? "secondary" : "ghost"} size="icon" className="lg:hidden" aria-label="Filter favorites" aria-pressed={favorites} onClick={() => setFavorites(!favorites)}><Heart /></Button><select aria-label="Recipe status" value={status} onChange={(event) => setStatus(event.target.value)} className="min-h-11 rounded-xl border bg-background px-3 text-sm"><option value="current">Current recipes</option><option value="archived">Archived</option></select></div></div>
          {visible.length ? <div className="divide-y rounded-2xl border">{visible.map((recipe) => <article key={recipe.id} className="flex items-center gap-3 p-3 sm:gap-4 sm:p-4"><Link href={`/recipes/${recipe.id}`} className="flex min-w-0 flex-1 items-center gap-3 rounded-lg focus-visible:outline-2 focus-visible:outline-ring sm:gap-4"><RecipeThumbnail photoId={recipe.coverPhotoId} className="size-16 sm:size-20" /><div className="min-w-0"><h3 className="truncate font-medium">{recipe.title}</h3><div className="mt-2 flex flex-wrap gap-1.5">{recipe.tags.slice(0, 3).map((tag) => <span key={tag} className="rounded bg-muted px-2 py-0.5 text-xs text-muted-foreground">{tag}</span>)}{recipe.status !== "active" && <span className="text-xs text-muted-foreground">{recipe.status}</span>}</div></div></Link>{recipe.totalMinutes && <span className="hidden text-sm text-muted-foreground sm:block">{recipe.totalMinutes} min</span>}<FavoriteButton id={recipe.id} initial={recipe.favorite} onChange={(favorite) => setFavoriteChanges((changes) => ({ source: initialRecipes, values: { ...(changes.source === initialRecipes ? changes.values : {}), [recipe.id]: favorite } }))} /></article>)}</div>
            : <div className="flex min-h-72 flex-col items-center justify-center rounded-2xl border border-dashed px-6 text-center"><SiftMark className="mb-5 size-10 text-muted-foreground" /><h3 className="text-xl font-medium">{query ? "No recipes found." : favorites ? "Keep your favorites close." : status === "archived" ? "No archived recipes." : "A fresh page."}</h3><p className="mt-3 max-w-sm text-sm leading-relaxed text-muted-foreground">{query ? "Try a title, ingredient, tag, or a word from your notes." : favorites ? "Tap the heart on any recipe to find it here." : status === "archived" ? "Recipes you archive will appear here." : "Add the first recipe you’d like to make again."}</p>{!query && !favorites && status !== "archived" && <Button asChild variant="outline" className="mt-6"><Link href="/recipes/new"><Plus />Add your first recipe</Link></Button>}</div>}
        </section>
      </main>
    </div>
  </div>;
}
