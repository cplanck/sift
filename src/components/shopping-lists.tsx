"use client";
import Link from "next/link";
import { useState } from "react";
import { Archive, ArchiveRestore, Check, MoreHorizontal, Pencil, Plus, ShoppingBasket, Trash2 } from "lucide-react";
import { api } from "@/lib/client-http";
import type { ArtifactSummary } from "@/domain/artifact";
import { Button } from "./ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "./ui/dropdown-menu";
import { ShoppingListDialog } from "./shopping-list-dialog";
import { shoppingListChanged, useShoppingLists } from "./use-shopping-lists";
import styles from "./shopping.module.css";

export function ShoppingLists({ initial }: { initial: ArtifactSummary[] }) {
  const { lists, archivedLists, active, select, error, refresh } = useShoppingLists(initial);
  const [dialog, setDialog] = useState<{ mode: "create" | "rename" | "delete"; list?: ArtifactSummary } | null>(null);
  const [showArchived, setShowArchived] = useState(false), [saving, setSaving] = useState(false), [saveError, setSaveError] = useState("");
  const visibleLists = showArchived ? archivedLists : lists;
  async function archive(list: ArtifactSummary, archived: boolean) {
    setSaving(true); setSaveError("");
    try { await api(`/api/artifacts/${list.id}/actions`, { body: { action: "archive", archived, expectedRevision: list.revision } }); shoppingListChanged(list.id); await refresh(); }
    catch (error) { setSaveError(error instanceof Error ? error.message : "Couldn’t update the list."); await refresh(); }
    finally { setSaving(false); }
  }
  return <section aria-label="Shopping lists">
    <div className={styles.listHeading}><h1>Shopping lists</h1>{(lists.length > 0 || archivedLists.length > 0) && <Button variant="outline" className="rounded-full" onClick={() => setDialog({ mode: "create" })}><Plus />New list</Button>}</div>
    <div className={styles.listTabs} aria-label="Shopping list status"><button aria-pressed={!showArchived} onClick={() => setShowArchived(false)}>Active</button><button aria-pressed={showArchived} onClick={() => setShowArchived(true)}>Archived</button></div>
    {saveError && <p role="alert" className="mb-5 text-sm text-destructive">{saveError}</p>}
    {error && <p role="alert" className="mb-5 text-sm text-destructive">{error}<button className="ml-2 underline" onClick={() => void refresh()}>Retry</button></p>}
    {visibleLists.length ? <div className={styles.cards}>{visibleLists.map((list) => <article key={list.id} className={styles.card} data-active={active?.id === list.id} aria-label={`${list.title} shopping list`}>
      <Link href={`/artifacts/${list.id}`} onClick={() => { if (!list.archivedAt) select(list.id); }}><ShoppingBasket size={23} strokeWidth={1.4} /><div><h3>{list.title}</h3><p>{list.recipeIds?.length ?? 0} {(list.recipeIds?.length ?? 0) === 1 ? "recipe" : "recipes"}</p></div></Link>
      <div className={styles.cardMenu}><DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" size="icon" disabled={saving} aria-label={`Options for ${list.title}`}><MoreHorizontal /></Button></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuItem onSelect={() => void archive(list, !list.archivedAt)}>{list.archivedAt ? <ArchiveRestore /> : <Archive />}{list.archivedAt ? "Restore list" : "Archive list"}</DropdownMenuItem><DropdownMenuItem onSelect={() => setDialog({ mode: "rename", list })}><Pencil />Rename</DropdownMenuItem><DropdownMenuItem variant="destructive" onSelect={() => setDialog({ mode: "delete", list })}><Trash2 />Delete list</DropdownMenuItem></DropdownMenuContent></DropdownMenu></div>
      <div className={styles.cardFooter}>{list.archivedAt ? <Button variant="ghost" disabled={saving} onClick={() => void archive(list, false)}><ArchiveRestore size={14} />Restore list</Button> : <Button variant="ghost" aria-pressed={active?.id === list.id} onClick={() => select(list.id)}>{active?.id === list.id ? <><Check size={14} />Current list</> : "Use this list"}</Button>}</div>
    </article>)}</div> : <div className={styles.empty}><ShoppingBasket size={34} strokeWidth={1.2} /><h2>{showArchived ? "No archived lists." : "No shopping lists yet."}</h2>{!showArchived && <><p>Create a list to add recipes and other items.</p><Button className="rounded-full" onClick={() => setDialog({ mode: "create" })}><Plus />Create your first list</Button></>}</div>}
    {dialog && <ShoppingListDialog key={`${dialog.mode}-${dialog.list?.id}`} {...dialog} onClose={() => setDialog(null)} onSaved={() => void refresh()} />}
  </section>;
}
