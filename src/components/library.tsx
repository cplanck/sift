"use client";
import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, ChefHat, ChevronDown, Clock3, Heart, LayoutGrid, List, Plus, Search, X } from "lucide-react";
import { type RecipeSummary, searchLibrary } from "@/domain/recipe";
import type { ArtifactSummary } from "@/domain/artifact";
import type { listPendingImports } from "@/services/imports";
import type { listActiveCookingSessions } from "@/services/cooking";
import { cn } from "@/lib/utils";
import { AppHeader, pageFrame } from "./app-header";
import { SiftMark } from "./brand";
import { FavoriteButton } from "./favorite-button";
import { RecipeThumbnail } from "./recipe-thumbnail";
import { PendingImports } from "./pending-imports";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { formatDuration } from "@/lib/format-duration";
import { ShoppingLists } from "./shopping-lists";
import { HomeShoppingList } from "./home-shopping-list";
import { useAssistantPage } from "./assistant-shell";
import type { KitchenMode } from "./kitchen-navigation";
import styles from "./library.module.css";

type ActiveCooks = Awaited<ReturnType<typeof listActiveCookingSessions>>;
const subscribeGreeting = () => () => {};
function greeting() { const hour = new Date().getHours(); return hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening"; }
function stepTitle(text: string, step: number) { return text.match(/^([^:\n.!?]{1,80}):/)?.[1] ?? `Continue step ${step + 1}`; }

export function LibraryView({ initialRecipes, initialImports, recentArtifacts, activeCooks = [], mode = "home", name, allowProductionSync = false }: { initialRecipes: RecipeSummary[]; initialImports: Awaited<ReturnType<typeof listPendingImports>>; recentArtifacts: ArtifactSummary[]; activeCooks?: ActiveCooks; mode?: KitchenMode; name: string; allowProductionSync?: boolean }) {
  const [favoriteChanges, setFavoriteChanges] = useState<{ source: RecipeSummary[]; values: Record<string, boolean> }>({ source: initialRecipes, values: {} });
  const [query, setQuery] = useState(""), [favorites, setFavorites] = useState(false), [status, setStatus] = useState("current"), [layout, setLayout] = useState<"grid" | "list">("grid");
  const [recentOnly, setRecentOnly] = useState(false), [quick, setQuick] = useState(false), [vegetarian, setVegetarian] = useState(false), [collection, setCollection] = useState(""), [tag, setTag] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(mode !== "home");
  const router = useRouter(), search = useRef<HTMLInputElement>(null);
  const welcome = useSyncExternalStore(subscribeGreeting, greeting, () => "Welcome back");
  useAssistantPage({ route: mode === "home" ? "/library" : `/library?mode=${mode}`, title: mode === "home" ? "Your kitchen" : mode === "shop" ? "Shopping lists" : "Ready to cook" });
  const recipes = initialRecipes.map((recipe) => ({ ...recipe, favorite: favoriteChanges.source === initialRecipes ? favoriteChanges.values[recipe.id] ?? recipe.favorite : recipe.favorite }));
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if ((event.metaKey || event.ctrlKey) && event.key === "k" && !document.querySelector('[role="dialog"]')) { event.preventDefault(); if (mode === "shop") { router.push("/library"); return; } setFiltersOpen(true); requestAnimationFrame(() => search.current?.focus()); } };
    window.addEventListener("keydown", onKey); return () => window.removeEventListener("keydown", onKey);
  }, [mode, router]);
  const activeRecipes = recipes.filter((recipe) => recipe.status === "active");
  const filtered = searchLibrary(recipes, query).filter((r) => (!favorites || r.favorite) && (status === "archived" ? r.status === "archived" : r.status === "active") && (!quick || (r.totalMinutes !== null && r.totalMinutes < 30)) && (!vegetarian || r.tags.some((tag) => /^(vegetarian|vegan)$/i.test(tag))) && (!collection || r.collections.includes(collection)) && (!tag || r.tags.includes(tag)));
  const visible = recentOnly ? [...filtered].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 8) : filtered;
  const collections = [...new Set(recipes.flatMap((recipe) => recipe.collections))].sort();
  const tags = [...new Set(activeRecipes.flatMap((recipe) => recipe.tags))].sort();
  const filteredView = Boolean(query || favorites || recentOnly || quick || vegetarian || collection || tag || status === "archived");
  const chip = (selected: boolean) => cn(styles.chip, selected && styles.selectedChip);
  const resumeHref = activeCooks[0] ? `/recipes/${activeCooks[0].recipeId}?cook=${activeCooks[0].sessionId}` : undefined;
  const featured = activeRecipes.find((recipe) => recipe.id === activeCooks[0]?.recipeId && recipe.coverPhotoId && recipe.coverSelection !== "none") ?? activeRecipes.find((recipe) => recipe.coverPhotoId && recipe.coverSelection !== "none");
  function clearFilters() { setQuery(""); setFavorites(false); setRecentOnly(false); setQuick(false); setVegetarian(false); setCollection(""); setTag(""); setStatus("current"); }
  const changeFavorite = (id: string, favorite: boolean) => setFavoriteChanges((changes) => ({ source: initialRecipes, values: { ...(changes.source === initialRecipes ? changes.values : {}), [id]: favorite } }));
  const thumbnail = (recipe: RecipeSummary, className: string, sizes: string, href?: string) => <RecipeThumbnail recipeId={recipe.id} stockPhoto={recipe.stockPhoto} tags={recipe.tags} photoId={recipe.coverPhotoId} coverSelection={recipe.coverSelection} coverImage={recipe.coverImage} title={recipe.title} imageHref={href} sizes={sizes} className={className} />;

  return <div className={styles.home}>
    <AppHeader name={name} allowProductionSync={allowProductionSync} mode={mode} cookHref={resumeHref}>
      <Button variant="ghost" size="icon" aria-label="Open search" title="Search (⌘K)" className="size-11 rounded-full border border-border/40 text-muted-foreground" onClick={() => { if (mode === "shop") { router.push("/library"); return; } setFiltersOpen(true); requestAnimationFrame(() => search.current?.focus()); }}><Search className="size-5" /></Button>
    </AppHeader>
    <main id="main" className={cn(pageFrame, styles.main)}>
      {mode === "home" ? <section className={styles.hero} aria-label="Welcome to your kitchen">
        <div className={styles.heroImage} aria-hidden="true"><Image src={featured ? `/api/photos/${featured.coverPhotoId}` : "/brand/splash.webp"} alt="" fill unoptimized={!!featured} preload sizes="(max-width: 639px) 100vw, 850px" className={styles.heroPhoto} /></div>
        <div className={styles.heroCopy}><h1>{welcome},<br />{name.trim().split(/\s+/)[0] || "cook"}.</h1>
          <HomeShoppingList initial={recentArtifacts.filter((artifact) => artifact.kind === "grocery")} />
        </div>
        {featured && <Link className={styles.heroCaption} href={`/recipes/${featured.id}`}><span>From your cookbook</span>{featured.title}<ArrowRight size={14} /></Link>}
      </section> : mode === "cook" ? <section className={styles.modeIntro}><p className={styles.eyebrow}>Your kitchen / cook</p><div><h1>Let’s get cooking.</h1><p>Pick up where you left off, or find something to make.</p></div></section> : null}

      {mode === "home" && <PendingImports initial={initialImports} />}
      {(mode === "home" || mode === "cook") && !filteredView && activeCooks.length > 0 && <section className={styles.section} aria-labelledby="continue-heading">
        <div className={styles.sectionHeading}><h2 id="continue-heading">Continue cooking</h2>{mode === "home" && <Link href="/library?mode=cook#continue-heading">View all <ArrowRight size={16} /></Link>}</div>
        <div className={styles.continueGrid}>{(mode === "home" ? activeCooks.slice(0, 3) : activeCooks).map((cook) => {
          const recipe = recipes.find((item) => item.id === cook.recipeId), current = Math.min(cook.currentStep + 1, cook.totalSteps);
          return <Link key={cook.sessionId} href={`/recipes/${cook.recipeId}?cook=${cook.sessionId}`} className={styles.continueCard}>
            <div className={styles.continueImage}>{recipe ? thumbnail(recipe, "size-full rounded-xl", "150px") : <SiftMark />}<span className={styles.badge}>In progress</span></div>
            <div className={styles.continueCopy}><h3>{cook.title}</h3><p>Step {current} of {cook.totalSteps}</p><p className={styles.stepName}>{stepTitle(cook.currentStepText, cook.currentStep)}</p><progress aria-label={`${cook.title} progress`} max={cook.totalSteps} value={Math.min(cook.completedSteps, cook.totalSteps)} /><small>{Math.max(0, cook.totalSteps - cook.completedSteps)} steps to complete</small></div>
          </Link>;
        })}</div>
      </section>}

      {mode === "shop" && <ShoppingLists initial={recentArtifacts.filter((artifact) => artifact.kind === "grocery")} />}

      {mode !== "shop" && <section id="all-recipes" aria-labelledby="all-heading" className={styles.section}>
        <div className={cn(styles.sectionHeading, styles.recipeHeading)}><h2 id="all-heading">{query ? `Results for “${query}”` : favorites ? "Favorites" : status === "archived" ? "Archived recipes" : "Recently added"}</h2>
          <div className={styles.filters}><nav aria-label="Cookbook filters"><button aria-pressed={!favorites && !recentOnly} className={chip(!favorites && !recentOnly)} onClick={() => { setFavorites(false); setRecentOnly(false); }}>All<span>{activeRecipes.length}</span></button><button aria-pressed={recentOnly} className={chip(recentOnly)} onClick={() => { setRecentOnly(!recentOnly); setFavorites(false); }}>Recent</button><button aria-label="Filter favorites" aria-pressed={favorites} className={chip(favorites)} onClick={() => { setFavorites(!favorites); setRecentOnly(false); }}><Heart size={14} /><span className="sr-only sm:not-sr-only">Favorites</span></button></nav><label className={styles.tagSelect}><span className="sr-only">Filter by tag</span><select aria-label="Filter by tag" value={tag} onChange={(event) => setTag(event.target.value)}><option value="">By tag</option>{tags.map((item) => <option key={item}>{item}</option>)}</select><ChevronDown size={13} /></label><button className={chip(filtersOpen)} aria-expanded={filtersOpen} aria-controls="library-filters" onClick={() => setFiltersOpen(!filtersOpen)}>Filters<ChevronDown size={13} /></button></div>
        </div>
        {filtersOpen && <div className={styles.extraFilters} id="library-filters">
          <div className={styles.inlineSearch}><Search size={16} /><Input ref={search} aria-label="Search recipes" placeholder="Search your recipes…" maxLength={200} value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Escape") setQuery(""); }} /></div>
          <button className={chip(vegetarian)} aria-pressed={vegetarian} onClick={() => setVegetarian(!vegetarian)}>Vegetarian</button><button className={chip(quick)} aria-pressed={quick} onClick={() => setQuick(!quick)}>&lt; 30 min</button>
          {collections.length > 0 && <select aria-label="Collection" value={collection} onChange={(event) => setCollection(event.target.value)}><option value="">Collections</option>{collections.map((item) => <option key={item}>{item}</option>)}</select>}
          <select aria-label="Recipe status" value={status} onChange={(event) => setStatus(event.target.value)}><option value="current">Current recipes</option><option value="archived">Archived</option></select>
          <div role="group" aria-label="Recipe layout" className="ml-auto flex"><Button variant="ghost" size="icon" aria-label="Grid view" aria-pressed={layout === "grid"} onClick={() => setLayout("grid")}><LayoutGrid size={17} /></Button><Button variant="ghost" size="icon" aria-label="List view" aria-pressed={layout === "list"} onClick={() => setLayout("list")}><List size={17} /></Button></div>
        </div>}
        {filteredView && <div className={styles.resultsMeta}><span>{visible.length} {visible.length === 1 ? "recipe" : "recipes"}</span><button onClick={clearFilters}>Clear filters <X size={12} /></button></div>}
        {visible.length ? <div className={layout === "grid" ? styles.recipeGrid : styles.recipeList}>{visible.map((recipe) => <article key={recipe.id} aria-label={`${recipe.title} recipe`} className={styles.recipeCard}>
          <div className={styles.recipeImage}>{thumbnail(recipe, styles.thumbnail, layout === "grid" ? "(max-width: 640px) 45vw, (max-width: 1024px) 30vw, 230px" : "120px", `/recipes/${recipe.id}`)}<div className={styles.favorite}><FavoriteButton id={recipe.id} initial={recipe.favorite} className="size-8 rounded-full bg-background/85 text-foreground hover:bg-background" onChange={(favorite) => changeFavorite(recipe.id, favorite)} /></div></div>
          <div className={styles.recipeInfo}><Link href={`/recipes/${recipe.id}`}><h3>{recipe.title}</h3></Link><div>{recipe.totalMinutes !== null && <span><Clock3 size={13} />{formatDuration(recipe.totalMinutes)}</span>}{recipe.status === "archived" && <span>Archived</span>}</div></div>
        </article>)}</div> : <div className={styles.empty}><SiftMark className="size-10 text-muted-foreground" /><h3>{filteredView ? "Nothing here just yet." : "Something good starts here."}</h3><p>{filteredView ? "Try another search or clear a filter." : "Save a recipe you’d love to make. A link, a photo, or a family favorite."}</p>{filteredView ? <Button variant="outline" className="rounded-full" onClick={clearFilters}>Clear filters</Button> : <Button asChild className="rounded-full"><Link href="/recipes/new"><Plus />Add your first recipe</Link></Button>}</div>}
        {visible.length > 0 && <div className={styles.libraryFooter}><span>{activeRecipes.length} recipes in your kitchen</span><Link href="/recipes/new"><Plus size={15} />Add a recipe</Link></div>}
      </section>}
      {mode === "cook" && !activeCooks.length && <p className={styles.quiet}><ChefHat size={16} />Open a recipe and choose Start cooking to begin.</p>}
    </main>
  </div>;
}
