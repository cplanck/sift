"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2, RefreshCw } from "lucide-react";
import { api } from "@/lib/client-http";
import { productionSyncResultSchema, syncLabels, type ProductionSyncResult } from "@/domain/production-sync";
import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "./ui/dialog";

export function ProductionSyncButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false), [busy, setBusy] = useState<"preview" | "apply" | null>(null), [error, setError] = useState("");
  const [result, setResult] = useState<ProductionSyncResult | null>(null);
  const changes = result ? Object.values(result.summary).reduce((count, row) => count + row.insert + row.update, 0) : 0;
  async function sync(apply: boolean) {
    setBusy(apply ? "apply" : "preview"); setError("");
    try {
      const next = productionSyncResultSchema.parse(await api("/api/dev/production-sync", { body: { apply } }));
      setResult(next);
      if (apply) router.refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Couldn’t sync. Try again."); }
    finally { setBusy(null); }
  }
  return <>
    <Button variant="ghost" aria-label="Sync from prod" className="w-full justify-start" onClick={() => { setOpen(true); setResult(null); void sync(false); }}><RefreshCw className="size-4 text-blue-500" />Sync from prod</Button>
    <Dialog open={open} onOpenChange={(next) => { if (!busy) setOpen(next); }}>
      <DialogContent className="max-h-[85dvh] overflow-y-auto rounded-2xl" showCloseButton={!busy}>
        <DialogHeader><DialogTitle>Sync from production</DialogTitle><DialogDescription>Bring your production content into this local cookbook. Local edits are preserved, and production stays read-only.</DialogDescription></DialogHeader>
        {busy && <div role="status" className="flex items-center gap-3 rounded-xl bg-muted/50 p-5 text-sm"><Loader2 className="size-5 animate-spin text-blue-500" />{busy === "apply" ? "Syncing your content…" : "Checking production for changes…"}</div>}
        {error && <p role="alert" className="rounded-xl bg-destructive/10 p-4 text-sm text-destructive">{error}</p>}
        {result && !busy && <>
          <p role="status" className="flex items-center gap-2 text-sm font-medium">{result.applied || !changes ? <Check className="size-4 text-blue-500" /> : <RefreshCw className="size-4" />}{result.applied ? "Sync complete." : changes ? `${changes} ${changes === 1 ? "change" : "changes"} ready to sync.` : result.conflicts.length ? "Nothing to sync automatically." : "Your local content is up to date."}</p>
          {changes > 0 && <div className="divide-y rounded-xl border">{Object.entries(result.summary).filter(([, row]) => row.insert + row.update > 0).map(([table, row]) => <div key={table} className="flex items-center justify-between gap-3 px-4 py-3 text-sm"><span>{syncLabels[table] ?? table}</span><span className="text-xs text-muted-foreground">{row.insert > 0 && `${row.insert} new`}{row.insert > 0 && row.update > 0 && " · "}{row.update > 0 && `${row.update} updated`}</span></div>)}</div>}
          {result.conflicts.length > 0 && <p className="rounded-xl bg-muted/60 p-4 text-sm text-muted-foreground">{result.conflicts.length} {result.conflicts.length === 1 ? "item has" : "items have"} local changes and will be kept as-is.</p>}
        </>}
        <DialogFooter><Button variant="ghost" disabled={!!busy} onClick={() => setOpen(false)}>Close</Button>{error ? <Button disabled={!!busy} onClick={() => void sync(false)}>Try again</Button> : result && !result.applied && changes > 0 && <Button disabled={!!busy} onClick={() => void sync(true)}><RefreshCw className="size-4" />Sync changes</Button>}</DialogFooter>
      </DialogContent>
    </Dialog>
  </>;
}
