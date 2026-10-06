"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, ListChecks, MessageCircle, Plus, Merge } from "lucide-react";
import type { ArtifactDetail as Artifact, MealEntryInput } from "@/domain/artifact";
import type { RecipeSummary } from "@/domain/recipe";
import { api } from "@/lib/client-http";
import { ArtifactActions } from "./artifact-actions";
import { ArtifactContents } from "./artifact-contents";
import { useAssistantPage, useOpenSift } from "./assistant-shell";
import { useArtifact } from "./use-artifact";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Textarea } from "./ui/textarea";

export function ArtifactDetail({ initial }: { initial: Artifact }) {
  const { artifact, busy, error, mutate } = useArtifact(initial), [adding, setAdding] = useState(false), [deriving, setDeriving] = useState(false), [deriveError, setDeriveError] = useState("");
  const openSift = useOpenSift(), router = useRouter();
  useAssistantPage({ route: `/artifacts/${artifact.id}`, activeArtifactId: artifact.id, title: artifact.title });
  const sources = artifact.content.kind === "meal-plan" ? artifact.content.entries.flatMap((entry) => entry.recipeId && entry.recipeVersionId ? [{ recipeId: entry.recipeId, versionId: entry.recipeVersionId, ...(entry.servings ? { servings: entry.servings } : {}) }] : []) : [];
  async function derive() {
    setDeriving(true); setDeriveError("");
    try {
      const list = await api<Artifact>("/api/artifacts/derive", { body: { title: `${artifact.title.slice(0, 145)} groceries`, recipes: sources } });
      router.push(`/artifacts/${list.id}`); router.refresh();
    } catch (error) { setDeriveError(error instanceof Error ? error.message : "Couldn’t build your grocery list. Try again."); }
    finally { setDeriving(false); }
  }
  const total = artifact.content.kind === "grocery" ? artifact.content.groups.reduce((count, group) => count + group.items.length, 0) : artifact.content.entries.length;
  const checked = artifact.content.kind === "grocery" ? artifact.content.groups.reduce((count, group) => count + group.items.filter((item) => item.checked).length, 0) : 0;
  return <main id="main" className="page-width max-w-4xl py-7 pb-28 sm:py-10 sm:pb-28"><Link href="/library" className="mb-7 inline-flex min-h-11 items-center gap-2 text-sm text-muted-foreground"><ArrowLeft size={16} />Back to Library</Link><div className="mb-8 flex flex-wrap items-start justify-between gap-5"><div className="min-w-0"><p className="mb-3 text-xs font-medium uppercase tracking-widest text-muted-foreground">{artifact.kind === "grocery" ? "Grocery list" : "Meal plan"}</p><h1 className="break-words text-3xl font-semibold tracking-tight sm:text-4xl">{artifact.title}</h1><p className="mt-3 text-sm text-muted-foreground">{artifact.kind === "grocery" ? `${checked} of ${total} items checked` : `${total} ${total === 1 ? "meal" : "meals"}`}</p></div>{openSift && <Button variant="outline" onClick={openSift}><MessageCircle />Ask Sift</Button>}</div>
    <div className="mb-8 flex flex-wrap items-start justify-between gap-4"><ArtifactActions artifact={artifact} /><div className="flex flex-wrap gap-2">{artifact.content.kind === "grocery" && artifact.content.groups.length > 1 && <Button variant="outline" title="Merge matching ingredients across recipes into one list" onClick={() => mutate({ action: "combine" })} disabled={busy || deriving}><Merge />Combine duplicates</Button>}<Button variant="outline" aria-expanded={adding} onClick={() => setAdding(!adding)} disabled={busy || deriving}><Plus />{artifact.kind === "grocery" ? "Add items" : "Add meal"}</Button></div></div>
    {error && <p role="alert" className="mb-6 rounded-xl border p-4 text-sm text-destructive">{error}</p>}
    {adding && (artifact.kind === "grocery" ? <form className="mb-8 space-y-4 rounded-2xl border p-5" onSubmit={async (event) => {
      event.preventDefault(); const form = event.currentTarget, data = new FormData(form);
      const items = String(data.get("items")).split("\n").map((text) => text.trim()).filter(Boolean).map((text) => ({ text }));
      if (await mutate({ action: "addItems", groupName: String(data.get("groupName") ?? ""), items })) { form.reset(); setAdding(false); }
    }}><h2 className="text-lg font-medium">Add to your list.</h2><label className="block text-sm">Items, one per line<Textarea name="items" required maxLength={20000} placeholder={"A bunch of parsley\nOlive oil"} className="mt-2 min-h-28" /></label><label className="block text-sm">Group (optional)<Input name="groupName" maxLength={320} placeholder="Produce" className="mt-2" list="grocery-groups" /><datalist id="grocery-groups">{artifact.content.kind === "grocery" && artifact.content.groups.filter((group) => group.name).map((group) => <option key={group.id} value={group.name} />)}</datalist></label><div className="flex gap-2"><Button disabled={busy} type="submit">Save items</Button><Button variant="ghost" type="button" onClick={() => setAdding(false)}>Cancel</Button></div></form> : <MealEntryForm busy={busy} onCancel={() => setAdding(false)} onSave={async (entry) => { if (await mutate({ action: "addEntry", entry })) setAdding(false); }} />)}
    <ArtifactContents artifact={artifact} busy={busy || deriving} mutate={mutate} />
    {artifact.kind === "meal-plan" && <section className="mt-10 space-y-3 border-t pt-6"><Button variant="outline" disabled={busy || deriving || !sources.length || sources.length > 30} onClick={derive}><ListChecks />{deriving ? "Building your list…" : "Build grocery list"}</Button><p className="text-xs leading-relaxed text-muted-foreground">{!sources.length ? "Add a recipe to this plan to build its grocery list." : sources.length > 30 ? "Ask Sift to build a list from up to 30 of these meals at a time." : "Uses the saved recipe versions and servings in this plan. Add groceries for meals without a linked recipe separately."}</p>{deriveError && <p role="alert" className="text-sm text-destructive">{deriveError}</p>}</section>}
  </main>;
}

function MealEntryForm({ busy, onSave, onCancel }: { busy: boolean; onSave: (entry: MealEntryInput) => Promise<void>; onCancel: () => void }) {
  const [recipes, setRecipes] = useState<RecipeSummary[]>([]), [recipeId, setRecipeId] = useState(""), [error, setError] = useState(""), [loading, setLoading] = useState(true), [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    api<RecipeSummary[]>("/api/recipes", { signal: controller.signal }).then((records) => { setRecipes(records.filter((recipe) => recipe.status === "active")); setLoading(false); }).catch(() => { if (!controller.signal.aborted) { setError("Couldn’t load your recipes. Describe the meal, or reload recipes."); setLoading(false); } });
    return () => controller.abort();
  }, [attempt]);
  return <form className="mb-8 space-y-4 rounded-2xl border p-5" onSubmit={async (event) => {
    event.preventDefault(); const data = new FormData(event.currentTarget), recipe = recipes.find((recipe) => recipe.id === recipeId), servingText = String(data.get("servings") ?? "");
    await onSave({ meal: String(data.get("meal")), ...(recipe ? { recipeId: recipe.id, versionId: recipe.versionId } : { title: String(data.get("title")) }), ...(data.get("date") ? { date: String(data.get("date")) } : {}), ...(servingText ? { servings: Number(servingText) } : {}), note: String(data.get("note") ?? "") });
  }}><h2 className="text-lg font-medium">Make room for a meal.</h2><div className="grid gap-4 sm:grid-cols-2"><label className="block text-sm">Date (optional)<Input type="date" name="date" className="mt-2" /></label><label className="block text-sm">Meal<Input name="meal" required maxLength={60} defaultValue="Dinner" className="mt-2" /></label></div><label className="block text-sm">Recipe<select value={recipeId} disabled={loading} onChange={(event) => setRecipeId(event.target.value)} className="mt-2 min-h-11 w-full rounded-xl border bg-background px-3"><option value="">Describe a meal</option>{recipes.map((recipe) => <option key={recipe.id} value={recipe.id}>{recipe.title}</option>)}</select></label>{loading && <p role="status" className="text-xs text-muted-foreground">Loading recipes…</p>}{error && <div><p role="alert" className="text-xs text-destructive">{error}</p><Button type="button" variant="ghost" size="sm" onClick={() => { setLoading(true); setError(""); setAttempt((value) => value + 1); }}>Reload recipes</Button></div>}{!recipeId && <label className="block text-sm">What’s for this meal?<Input name="title" required maxLength={160} placeholder="Leftovers and a green salad" className="mt-2" /></label>}<label className="block text-sm">Servings (optional)<Input name="servings" type="number" step="any" min={0.125} max={1000} placeholder={recipeId ? "Recipe servings" : "As needed"} className="mt-2 max-w-48" /></label><label className="block text-sm">Note (optional)<Textarea name="note" maxLength={2000} className="mt-2" placeholder="A little prep for tomorrow…" /></label><div className="flex gap-2"><Button type="submit" disabled={busy || loading}>Save meal</Button><Button variant="ghost" type="button" disabled={busy} onClick={onCancel}>Cancel</Button></div></form>;
}
