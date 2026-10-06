"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Check, KeyRound, LoaderCircle, Trash2 } from "lucide-react";
import type { getGatewayCredentialStatus } from "@/services/credentials";
import { api } from "@/lib/client-http";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./ui/dialog";
import { AiUsageDetails, type UsageSummary } from "./ai-usage-details";
import { ConnectedApps } from "./connected-apps";

type CredentialStatus = Awaited<ReturnType<typeof getGatewayCredentialStatus>>;
export function GatewaySettings({ open, onOpenChange }: { open: boolean; onOpenChange: (value: boolean) => void }) {
  const [status, setStatus] = useState<CredentialStatus | null>(null), [error, setError] = useState(""), [busy, setBusy] = useState(false), [saved, setSaved] = useState(false), [confirmRemove, setConfirmRemove] = useState(false), [attempt, setAttempt] = useState(0);
  const [usage, setUsage] = useState<UsageSummary | null>(null), [usageError, setUsageError] = useState("");
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    api<CredentialStatus>("/api/credentials/gateway", { signal: controller.signal }).then((result) => { setStatus(result); setError(""); setSaved(false); setConfirmRemove(false); }).catch((error) => { if (!controller.signal.aborted) setError(error instanceof Error ? error.message : "Couldn’t load your settings."); });
    api<UsageSummary>("/api/usage", { signal: controller.signal }).then((result) => { setUsage(result); setUsageError(""); }).catch(() => { if (!controller.signal.aborted) setUsageError("Couldn’t load your recorded usage."); });
    return () => controller.abort();
  }, [open, attempt]);
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="max-h-[90dvh] overflow-y-auto"><DialogHeader><DialogTitle>Sift settings</DialogTitle><DialogDescription>Manage your assistant connection and connected apps.</DialogDescription></DialogHeader>
    <Button asChild variant="outline"><Link href="/settings" onClick={() => onOpenChange(false)}>Open usage dashboard</Link></Button>
    {!status ? <div className="py-6">{error ? <><p role="alert" className="text-sm text-destructive">{error}</p><Button className="mt-4" variant="outline" onClick={() => setAttempt((value) => value + 1)}>Try again</Button></> : <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><LoaderCircle className="size-4 animate-spin" />Loading your settings…</p>}</div> : <>
      <section className="rounded-xl border bg-muted/30 p-4"><h3 className="flex items-center gap-2 text-sm font-medium"><KeyRound className="size-4" />Assistant connection</h3><p className="mt-3 text-sm leading-relaxed text-muted-foreground">{status.configured ? `Your personal Gateway key is saved (${status.hint}). Sift uses it before the app’s connection.` : status.appConfigured ? "The app has a Gateway key configured. You can use it or add a personal key." : "Sift needs a Vercel AI Gateway key before it can answer. Add your own below, or ask the app owner to configure the app’s connection."}</p></section>
      {status.encryptionConfigured ? <form className="space-y-4" onSubmit={async (event) => {
        event.preventDefault(); const form = event.currentTarget; const key = String(new FormData(form).get("key") ?? ""); setBusy(true); setError(""); setSaved(false);
        try { setStatus(await api<CredentialStatus>("/api/credentials/gateway", { method: "PUT", body: { key } })); form.reset(); setSaved(true); setConfirmRemove(false); }
        catch (error) { setError(error instanceof Error ? error.message : "Couldn’t save this key."); }
        finally { setBusy(false); }
      }}><label className="block text-sm font-medium">{status.configured ? "Replace Gateway key" : "Personal Gateway key"}<Input type="password" name="key" required minLength={12} maxLength={1000} autoComplete="new-password" spellCheck={false} className="mt-2" placeholder="Paste your Vercel AI Gateway key" /></label><p className="text-xs leading-relaxed text-muted-foreground">Your key is encrypted and belongs to your account. Its full value is never shown again.</p><Button type="submit" disabled={busy}>{busy ? <LoaderCircle className="animate-spin" /> : saved ? <Check /> : <KeyRound />}{saved ? "Key saved" : "Save key"}</Button></form> : <p className="text-sm leading-relaxed text-muted-foreground">Personal keys aren’t enabled on this installation. The app owner needs to configure credential encryption.</p>}
      {status.configured && <div className="border-t pt-4">{confirmRemove ? <div className="space-y-3"><p className="text-sm">Remove your personal key? {status.appConfigured ? "Sift will use the app’s connection." : "The assistant will be unavailable until another key is configured."}</p><div className="flex gap-2"><Button variant="outline" disabled={busy} onClick={async () => {
        setBusy(true); setError("");
        try { setStatus(await api<CredentialStatus>("/api/credentials/gateway", { method: "DELETE" })); setConfirmRemove(false); setSaved(false); }
        catch (error) { setError(error instanceof Error ? error.message : "Couldn’t remove your key."); }
        finally { setBusy(false); }
      }}>Confirm removal</Button><Button variant="ghost" disabled={busy} onClick={() => setConfirmRemove(false)}>Cancel</Button></div></div> : <Button variant="ghost" disabled={busy} onClick={() => setConfirmRemove(true)}><Trash2 />Remove personal key</Button>}</div>}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <section className="border-t pt-3">{usage ? <AiUsageDetails usage={usage} title="Recorded AI usage" cookbook /> : <p className="text-xs text-muted-foreground">{usageError || "Loading recorded usage…"}</p>}{usageError && <Button variant="ghost" size="sm" className="mt-2" onClick={() => setAttempt((value) => value + 1)}>Reload usage</Button>}</section>
    </>}
    <ConnectedApps open={open} />
  </DialogContent></Dialog>;
}
