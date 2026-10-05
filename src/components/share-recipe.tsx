"use client";
import { useState } from "react";
import { Check, Copy, Link as LinkIcon, LoaderCircle, Share2 } from "lucide-react";
import { api } from "@/lib/client-http";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "./ui/dialog";

type Share = { id: string; createdAt: string; versionId: string };
export function ShareRecipe({ recipeId, versionId, versionNumber, coverPhotoId }: { recipeId: string; versionId: string; versionNumber: number; coverPhotoId: string | null }) {
  const [links, setLinks] = useState<Share[]>([]), [created, setCreated] = useState<{ id: string; url: string } | null>(null), [error, setError] = useState(""), [busy, setBusy] = useState(false), [loading, setLoading] = useState(false), [copied, setCopied] = useState(false), [revoking, setRevoking] = useState<string | null>(null);
  return <Dialog onOpenChange={async (open) => {
    if (!open) return;
    setError(""); setCopied(false); setRevoking(null); setLoading(true);
    try { setLinks(await api<Share[]>(`/api/recipes/${recipeId}/shares`)); }
    catch (error) { setError(error instanceof Error ? error.message : "Couldn’t load share links."); }
    finally { setLoading(false); }
  }}><DialogTrigger asChild><Button variant="outline" size="sm"><Share2 />Share</Button></DialogTrigger>
    <DialogContent className="max-h-[90dvh] overflow-y-auto"><DialogHeader><DialogTitle>Share this recipe.</DialogTitle><DialogDescription>Anyone with the link can read this saved version and its cover photo. Your notes and history stay private.</DialogDescription></DialogHeader>
      <div className="rounded-xl border bg-muted/30 p-4"><p className="text-sm font-medium">Version {versionNumber}</p><p className="mt-2 text-sm leading-relaxed text-muted-foreground">Changes you make later won’t change this link. You can revoke access at any time.</p><Button className="mt-4" disabled={busy || loading} onClick={async () => {
        setBusy(true); setError(""); setCopied(false);
        try {
          const result = await api<{ id: string; createdAt: string; token: string; versionId: string }>(`/api/recipes/${recipeId}/shares`, { body: { expectedVersionId: versionId, expectedCoverPhotoId: coverPhotoId } });
          setCreated({ id: result.id, url: `${window.location.origin}/share/${result.token}` });
          setLinks((current) => [{ id: result.id, createdAt: result.createdAt, versionId: result.versionId }, ...current]);
        } catch (error) { setError(error instanceof Error ? error.message : "Couldn’t create a share link."); }
        finally { setBusy(false); }
      }}>{busy && !revoking ? <LoaderCircle className="animate-spin" /> : <LinkIcon />}Create link</Button></div>
      {created && <div className="space-y-3"><label className="block text-sm font-medium">Share link<Input readOnly value={created.url} className="mt-2 text-xs" onFocus={(event) => event.target.select()} /></label><Button variant="outline" onClick={async () => {
        try { await navigator.clipboard.writeText(created.url); setCopied(true); }
        catch { setError("Copy isn’t available in this browser. Select the link above to copy it manually."); }
      }}>{copied ? <Check /> : <Copy />}{copied ? "Copied" : "Copy link"}</Button><p className="text-xs leading-relaxed text-muted-foreground">Copy this link now. For privacy, its full address won’t be shown again after you leave this page.</p></div>}
      <section aria-labelledby="share-links-heading"><h3 id="share-links-heading" className="text-sm font-medium">Active links</h3>{loading ? <p role="status" className="mt-3 text-sm text-muted-foreground">Loading links…</p> : !links.length ? <p className="mt-3 text-sm text-muted-foreground">No links yet. This recipe is private.</p> : <ul className="mt-2 divide-y">{links.map((link) => <li key={link.id} className="py-3"><div className="flex items-center justify-between gap-3"><div><p className="text-sm">{new Date(link.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</p><p className="mt-1 text-xs text-muted-foreground">{link.versionId === versionId ? "Current recipe version" : "Earlier recipe version"}</p></div><Button variant="ghost" size="sm" disabled={busy} onClick={() => setRevoking(link.id)}>Revoke link</Button></div>{revoking === link.id && <div className="mt-3 rounded-lg bg-muted p-3"><p className="text-sm">Stop everyone from using this link?</p><div className="mt-3 flex gap-2"><Button size="sm" disabled={busy} onClick={async () => {
        setBusy(true); setError("");
        try { await api(`/api/shares/${link.id}`, { method: "DELETE" }); setLinks((current) => current.filter((item) => item.id !== link.id)); if (created?.id === link.id) setCreated(null); setRevoking(null); }
        catch (error) { setError(error instanceof Error ? error.message : "Couldn’t revoke this link."); }
        finally { setBusy(false); }
      }}>Confirm revoke</Button><Button size="sm" variant="ghost" disabled={busy} onClick={() => setRevoking(null)}>Cancel</Button></div></div>}</li>)}</ul>}</section>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    </DialogContent>
  </Dialog>;
}
