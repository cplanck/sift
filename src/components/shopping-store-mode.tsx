"use client";
import { useState, type ReactNode } from "react";
import { ArrowLeft } from "lucide-react";
import type { ArtifactDetail } from "@/domain/artifact";
import type { ArtifactAction } from "./use-artifact";
import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "./ui/dialog";
import styles from "./shopping.module.css";

type Props = {
  artifact: ArtifactDetail; busy: boolean; error: string; notifications: ReactNode;
  mutate: (action: ArtifactAction, optimistic?: (value: ArtifactDetail) => ArtifactDetail) => Promise<boolean>;
  onClear: (ids: string[]) => void; onExit: () => void;
};

export function ShoppingStoreMode({ artifact, busy, error, notifications, mutate, onClear, onExit }: Props) {
  const [category, setCategory] = useState<string | null>(null);
  if (artifact.content.kind !== "grocery") return null;
  const items = artifact.content.groups.flatMap((group) => group.items);
  const categories = [...new Set(items.map((item) => item.category || ""))].sort((a, b) => !a ? 1 : !b ? -1 : a.localeCompare(b));
  const visible = category === null ? items : items.filter((item) => (item.category || "") === category);
  const remaining = visible.filter((item) => !item.checked).length;
  const checked = visible.filter((item) => item.checked), archived = !!artifact.content.archivedAt;
  return <Dialog open onOpenChange={(open) => { if (!open) onExit(); }}>
    <DialogContent className={`${styles.storeScreen} inset-0 top-0 left-0 max-w-none translate-x-0 translate-y-0 rounded-none border-0 p-0 sm:max-w-none data-[state=open]:animate-none data-[state=closed]:animate-none`} showCloseButton={false}>
      <div className={styles.storeFrame}>
        <header className={styles.storeHeader}>
          <Button variant="ghost" onClick={onExit}><ArrowLeft size={17} />List view</Button>
          <span>Store mode</span>
        </header>
        <div className={styles.storeTitle}><DialogTitle>{artifact.title}</DialogTitle><DialogDescription>{archived ? "Archived list" : `${remaining} remaining${category !== null ? ` · ${category || "Uncategorized"}` : ""}`}</DialogDescription></div>
        <nav className={styles.storeCategories} aria-label="Shopping categories">
          <button aria-pressed={category === null} onClick={() => setCategory(null)}>All</button>
          {categories.map((name) => <button key={name} aria-pressed={category === name} onClick={() => setCategory(name)}>{name || "Uncategorized"}</button>)}
        </nav>
        {error && <p role="alert" className="px-5 pb-3 text-sm text-destructive">{error}</p>}
        <div className={styles.storeItems}>
          {visible.length ? <ul aria-label="Store checklist">{visible.map((item) => <li key={item.id} data-checked={item.checked}>
            <label><input type="checkbox" checked={item.checked} disabled={busy || archived} onChange={(event) => {
              const checked = event.target.checked;
              void mutate({ action: "checkItem", itemId: item.id, checked }, (value) => value.content.kind === "grocery" ? { ...value, content: { ...value.content, groups: value.content.groups.map((group) => ({ ...group, items: group.items.map((entry) => entry.id === item.id ? { ...entry, checked } : entry) })) } } : value);
            }} /><span>{item.text}</span></label>
          </li>)}</ul> : <p className={styles.storeEmpty}>{items.length ? "No items in this category." : "No items in this list."}</p>}
        </div>
        {checked.length > 0 && !archived && <footer className={styles.storeFooter}><Button variant="outline" disabled={busy} onClick={() => onClear(checked.map((item) => item.id))}>Clear checked</Button></footer>}
      </div>
      {notifications}
    </DialogContent>
  </Dialog>;
}
