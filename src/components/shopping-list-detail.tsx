"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Archive, ArchiveRestore, ArrowDownUp, ArrowLeft, Check, ChevronDown, Copy, MoreHorizontal, Pencil, Plus, ShoppingBasket, Trash2, X } from "lucide-react";
import { artifactToText, type ArtifactDetail, type RemovedGroceryItem } from "@/domain/artifact";
import type { RecipeSummary } from "@/domain/recipe";
import { groceryToMarkdown, shoppingRecipes } from "@/domain/grocery";
import { useArtifact } from "./use-artifact";
import { selectShoppingList, useShoppingLists } from "./use-shopping-lists";
import { ShoppingStoreMode } from "./shopping-store-mode";
import { ShoppingListDialog } from "./shopping-list-dialog";
import { RecipeThumbnail } from "./recipe-thumbnail";
import { useAssistantPage } from "./assistant-shell";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "./ui/dialog";
import { Textarea } from "./ui/textarea";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "./ui/dropdown-menu";
import styles from "./shopping.module.css";

type ShoppingRecipeCover = Pick<RecipeSummary, "id" | "coverPhotoId" | "coverSelection" | "coverImage" | "stockPhoto" | "tags">;

export function ShoppingListDetail({ initial, covers = [] }: { initial: ArtifactDetail; covers?: ShoppingRecipeCover[] }) {
  const { artifact, busy, error, mutate } = useArtifact(initial, true);
  const { lists } = useShoppingLists();
  const [dialog, setDialog] = useState<"create" | "rename" | "delete" | null>(null), [adding, setAdding] = useState(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null), [copyError, setCopyError] = useState<string | null>(null);
  const [storeMode, setStoreMode] = useState(false);
  const [sortByCategory, setSortByCategory] = useState(false);
  const [editing, setEditing] = useState<{ id: string; text: string; category?: string | null } | null>(null);
  const [filter, setFilter] = useState<string | null>(null);
  const [undoToasts, setUndoToasts] = useState<{ id: string; message: string; items: RemovedGroceryItem[] }[]>([]);
  const router = useRouter();
  useAssistantPage({ route: `/artifacts/${artifact.id}`, activeArtifactId: artifact.id, title: artifact.title });
  useEffect(() => { if (!initial.archivedAt) selectShoppingList(initial.id); }, [initial.id, initial.archivedAt]);
  if (artifact.content.kind !== "grocery") return null;
  const recipes = shoppingRecipes(artifact.content), items = artifact.content.groups.flatMap((group) => group.items);
  const activeFilter = recipes.some((recipe) => recipe.recipeId === filter) ? filter : null;
  const filteredItems = activeFilter ? items.filter((item) => (item.sources ?? (item.source ? [item.source] : [])).some((source) => source.recipeId === activeFilter)) : items;
  const visibleItems = sortByCategory ? [...filteredItems].sort((a, b) => !a.category ? b.category ? 1 : 0 : !b.category ? -1 : a.category.localeCompare(b.category, undefined, { sensitivity: "base" })) : filteredItems;
  const categoryOptions = [...new Set([...items.flatMap((item) => item.category ? [item.category] : []), "Produce", "Dairy & eggs", "Meat & seafood", "Pantry", "Frozen", "Bakery", "Household"])];
  const visibleChecked = visibleItems.filter((item) => item.checked);
  const copyKey = artifact.revision + ":" + (activeFilter ?? "all") + ":" + sortByCategory;
  const content = artifact.content;
  const archived = !!content.archivedAt, locked = busy || archived;
  async function copyList(markdown = false) {
    setCopyError(null);
    const visibleIds = new Set(visibleItems.map((item) => item.id));
    const copyGroups = sortByCategory ? visibleItems.reduce<typeof content.groups>((groups, item) => {
      const name = item.category || "Uncategorized", last = groups.at(-1);
      if (last?.name === name) last.items.push(item); else groups.push({ id: item.id, name, items: [item] });
      return groups;
    }, []) : content.groups.map((group) => ({ ...group, items: group.items.filter((item) => visibleIds.has(item.id)) }));
    const selection = { ...artifact, content: { ...content, groups: copyGroups } };
    try { await navigator.clipboard.writeText(markdown ? groceryToMarkdown(selection, { includeChecked: true }) : artifactToText(selection)); setCopiedKey(copyKey); }
    catch { setCopyError("Couldn’t copy the list. Please try again."); }
  }
  async function removeItems(itemIds: string[], clearChecked = false) {
    const removed = content.groups.flatMap((group, groupIndex) => group.items.flatMap((item, index) => itemIds.includes(item.id) ? [{ groupId: group.id, groupName: group.name, groupIndex, index, item }] : []));
    const saved = await mutate(clearChecked ? { action: "clearChecked", itemIds } : { action: "removeItem", itemId: itemIds[0] }, (value) => value.content.kind === "grocery" ? { ...value, content: { ...value.content, groups: value.content.groups.map((group) => ({ ...group, items: group.items.filter((item) => !itemIds.includes(item.id)) })) } } : value);
    if (saved) setUndoToasts((toasts) => [...toasts, { id: crypto.randomUUID(), items: removed, message: clearChecked ? removed.length + (removed.length === 1 ? " item cleared" : " items cleared") : "Item removed" }]);
  }
  const notifications = undoToasts.length > 0 && <div className={styles.toastStack} aria-label="Shopping list notifications">{undoToasts.map((toast) => <div className={styles.undoToast} key={toast.id}>
      <span role="status">{toast.message}</span>
      <Button variant="ghost" size="sm" disabled={locked} onClick={async () => { if (await mutate({ action: "restoreItems", items: toast.items })) setUndoToasts((toasts) => toasts.filter((entry) => entry.id !== toast.id)); }}>Undo</Button>
      <Button variant="ghost" size="icon" className="size-8" aria-label="Dismiss notification" onClick={() => setUndoToasts((toasts) => toasts.filter((entry) => entry.id !== toast.id))}><X size={14} /></Button>
    </div>)}</div>;
  return <main id="main" className={styles.detail}>
    <Link href="/library?mode=shop" className={styles.backLink}><ArrowLeft size={15} />Shopping lists</Link>
    <header className={styles.detailHeader}><div><div className="flex items-center gap-2"><h1>{artifact.title}</h1><DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" size="icon" aria-label="Switch shopping list"><ChevronDown /></Button></DropdownMenuTrigger><DropdownMenuContent>{lists.map((list) => <DropdownMenuItem key={list.id} onSelect={() => { selectShoppingList(list.id); router.push(`/artifacts/${list.id}`); }}><span className="flex-1">{list.title}</span>{list.id === artifact.id && <Check />}</DropdownMenuItem>)}<DropdownMenuSeparator /><DropdownMenuItem onSelect={() => setDialog("create")}><Plus />New list</DropdownMenuItem></DropdownMenuContent></DropdownMenu></div></div>
      <DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" size="icon" disabled={busy} aria-label="Shopping list options"><MoreHorizontal /></Button></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuItem onSelect={() => setDialog("rename")}><Pencil />Rename</DropdownMenuItem><DropdownMenuItem variant="destructive" onSelect={() => setDialog("delete")}><Trash2 />Delete list</DropdownMenuItem></DropdownMenuContent></DropdownMenu>
    </header>
    {archived && <div className={styles.archiveNotice}><span><Archive size={16} />Archived list</span></div>}
    {error && <p role="alert" className="mb-5 text-sm text-destructive">{error}</p>}
    <div className={styles.detailToolbar} aria-label="Shopping list actions">
      <div className={styles.toolbarPrimary}><Button variant="outline" className="rounded-full" size="sm" disabled={archived} onClick={() => setStoreMode(true)}><ShoppingBasket size={15} />Store mode</Button><div className={styles.copyControl}><Button className={styles.copyButton} disabled={busy || !visibleItems.length} onClick={() => { void copyList(); }}>{copiedKey === copyKey ? <Check /> : <Copy />}{copiedKey === copyKey ? "Copied" : "Copy list"}</Button><DropdownMenu><DropdownMenuTrigger asChild><Button className={styles.copyMenu} disabled={busy || !visibleItems.length} aria-label="Copy format"><ChevronDown size={15} /></Button></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuItem onSelect={() => { void copyList(); }}>Plain text</DropdownMenuItem><DropdownMenuItem onSelect={() => { void copyList(true); }}>Markdown</DropdownMenuItem></DropdownMenuContent></DropdownMenu></div></div>
      <div className={styles.toolbarSecondary}><Button variant="ghost" className="rounded-full" size="sm" disabled={locked} aria-expanded={adding} onClick={() => setAdding(!adding)}><Plus />Add items</Button><Button variant="ghost" size="sm" disabled={busy} onClick={() => { void mutate({ action: "archive", archived: !archived }); }}>{archived ? <ArchiveRestore size={15} /> : <Archive size={15} />}{archived ? "Restore list" : "Archive list"}</Button>
            {visibleChecked.length > 0 && !archived && <Button variant="ghost" disabled={locked} onClick={() => { void removeItems(visibleChecked.map((item) => item.id), true); }}>Clear checked</Button>}</div>
      <span role="status" className="sr-only">{copiedKey === copyKey ? "Shopping list copied" : ""}</span>
    </div>
          {copyError && <p role="alert" className="mt-3 text-sm text-destructive">{copyError}</p>}

        {adding && <form className={styles.manualForm} onSubmit={async (event) => { event.preventDefault(); const form = event.currentTarget; const data = new FormData(form), category = String(data.get("category") ?? "").trim() || null; const items = String(data.get("items") ?? "").split("\n").map((text) => text.trim()).filter(Boolean).map((text) => ({ text, category })); if (await mutate({ action: "addItems", groupName: "", items })) { form.reset(); setAdding(false); setFilter(null); } }}><label className="text-sm">Items, one per line<Textarea name="items" required maxLength={20000} placeholder={"Milk\nPaper towels"} className="my-3" /></label><label className="mb-4 block text-sm">Category (optional)<select name="category" defaultValue="" disabled={locked} className={styles.categorySelect}><option value="">Uncategorized</option>{categoryOptions.map((category) => <option key={category} value={category}>{category}</option>)}</select></label><div className="flex gap-2"><Button size="sm" disabled={locked}>Save items</Button><Button variant="ghost" type="button" onClick={() => setAdding(false)}>Cancel</Button></div></form>}
    <div className={styles.detailSections}>
      <section className={styles.recipes} aria-label="Filter by recipe">
        {!recipes.length && <p className="py-5 text-sm leading-7 text-muted-foreground">Find something you’d like to cook, then add it to this list from the recipe.</p>}
        <div className={styles.recipeTiles}>{recipes.map((recipe) => {
          const cover = covers.find((entry) => entry.id === recipe.recipeId);
          return <article className={styles.recipe} key={recipe.recipeId} data-selected={activeFilter === recipe.recipeId}>
          <button type="button" aria-label={`Filter by ${recipe.title}`} aria-pressed={activeFilter === recipe.recipeId} className={styles.recipeFilter} onClick={() => setFilter(activeFilter === recipe.recipeId ? null : recipe.recipeId)}>
            <RecipeThumbnail className={styles.recipeImage} recipeId={recipe.recipeId} title={recipe.title} photoId={cover?.coverPhotoId} coverSelection={cover?.coverSelection} coverImage={cover?.coverImage} stockPhoto={cover?.stockPhoto} tags={cover?.tags} sizes="64px" />
            <span>{recipe.title}</span>
          </button>
          <Button variant="secondary" size="icon" className={styles.removeRecipe} disabled={locked} aria-label={`Remove ${recipe.title} from list`} onClick={() => mutate({ action: "removeRecipe", recipeId: recipe.recipeId })}><X size={15} /></Button>

        </article>;
        })}</div>
      </section>
      <section className={styles.ingredients} aria-label="Shopping items"><div className={styles.ingredientsHeading}><div className="flex flex-wrap items-center gap-2"><h2>What you need</h2>{activeFilter && <Button variant="ghost" size="sm" onClick={() => setFilter(null)}>Show all<X size={13} /></Button>}</div></div>

        {visibleItems.length ? <>
          <table className={styles.itemTable}>
            <caption className="sr-only">Shopping items</caption>
            <thead><tr><th scope="col">Item</th><th scope="col" className={styles.categoryColumn} aria-sort={sortByCategory ? "ascending" : "none"}><button className={styles.categorySort} aria-label={sortByCategory ? "Restore list order" : "Sort by category"} onClick={() => setSortByCategory(!sortByCategory)}>Category<ArrowDownUp size={13} /></button></th><th scope="col" className={styles.sourceColumn}>Recipe</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>{visibleItems.map((item) => {
              const recipeIds = [...new Set((item.sources ?? (item.source ? [item.source] : [])).map((source) => source.recipeId))];
              return <tr key={item.id} data-checked={item.checked}>
                <td><label className={styles.itemLabel}><input type="checkbox" checked={item.checked} disabled={locked} onChange={(event) => {
                  const checked = event.target.checked;
                  void mutate({ action: "checkItem", itemId: item.id, checked }, (value) => value.content.kind === "grocery" ? { ...value, content: { ...value.content, groups: value.content.groups.map((group) => ({ ...group, items: group.items.map((entry) => entry.id === item.id ? { ...entry, checked } : entry) })) } } : value);
                }} /><span>{item.text}</span></label></td>
                <td className={styles.categoryColumn}><button className={styles.editCategory} disabled={locked} aria-label={`Edit ${item.text}`} onClick={() => setEditing(item)}>{item.category || "—"}<Pencil size={12} /></button></td>
                <td className={styles.sourceColumn}>{recipeIds.length ? recipeIds.map((id) => recipes.find((recipe) => recipe.recipeId === id)?.title ?? "Saved recipe").join(" · ") : "—"}</td>
                <td><Button variant="ghost" size="icon" disabled={locked} aria-label={`Remove ${item.text}`} className="text-muted-foreground" onClick={() => { void removeItems([item.id]); }}><X size={15} /></Button></td>
              </tr>;
            })}</tbody>
          </table>
        </> : <p className="py-8 text-sm text-muted-foreground">{activeFilter ? "No items for this recipe." : "No items yet."}</p>}

      </section>
    </div>
    {editing && <Dialog open onOpenChange={(open) => { if (!open && !busy) setEditing(null); }}><DialogContent className="rounded-2xl sm:max-w-sm" showCloseButton={!busy}>
      <DialogHeader><DialogTitle>Edit item</DialogTitle><DialogDescription className="sr-only">Change this shopping item and its optional category.</DialogDescription></DialogHeader>
      <form className="space-y-5" onSubmit={async (event) => {
        event.preventDefault(); const form = new FormData(event.currentTarget);
        const text = String(form.get("text") ?? "").trim(), category = String(form.get("category") ?? "").trim() || null;
        if (await mutate({ action: "updateItem", itemId: editing.id, ...(text !== editing.text ? { text } : {}), category })) setEditing(null);
      }}>
        <label className="block text-sm">Item<Input className="mt-2" name="text" defaultValue={editing.text} required maxLength={1000} disabled={locked} /></label>
        <label className="block text-sm">Category (optional)<Input className="mt-2" name="category" defaultValue={editing.category ?? ""} maxLength={60} list="shopping-categories" placeholder="e.g. Produce" disabled={locked} /></label>
        <datalist id="shopping-categories">{categoryOptions.map((category) => <option key={category} value={category} />)}</datalist>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <DialogFooter><Button variant="ghost" type="button" disabled={locked} onClick={() => setEditing(null)}>Cancel</Button><Button disabled={locked}>Save item</Button></DialogFooter>
      </form>
    </DialogContent></Dialog>}
    {!storeMode && notifications}
    {storeMode && <ShoppingStoreMode artifact={artifact} busy={busy} error={error} mutate={mutate} notifications={notifications} onClear={(ids) => { void removeItems(ids, true); }} onExit={() => setStoreMode(false)} />}
    {dialog && <ShoppingListDialog key={dialog} mode={dialog} list={dialog === "create" ? undefined : artifact} onClose={() => setDialog(null)} onSaved={(saved) => { if (dialog === "delete") router.push("/library?mode=shop"); else if (dialog === "create" && saved) router.push(`/artifacts/${saved.id}`); else router.refresh(); }} />}
  </main>;
}
