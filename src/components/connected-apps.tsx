"use client";
import { useEffect, useState } from "react";
import { LoaderCircle, Unplug } from "lucide-react";
import { api } from "@/lib/client-http";
import type { listMcpConnections } from "@/services/mcp-connections";
import { Button } from "./ui/button";

type Connections = Awaited<ReturnType<typeof listMcpConnections>>;
export const connectionPermissions: Record<string, { title: string; description: string }> = {
  "recipes:read": { title: "Read your recipes", description: "Search your cookbook and read your saved recipes." },
  "recipes:write": { title: "Add and update recipes", description: "Send recipes for your review and update saved recipes with version history." },
  offline_access: { title: "Stay connected", description: "Keep using this connection between visits. You can revoke access at any time." },
};
export function ConnectedApps({ open }: { open: boolean }) {
  const [connections, setConnections] = useState<Connections | null>(null), [error, setError] = useState(""), [attempt, setAttempt] = useState(0), [confirm, setConfirm] = useState<string | null>(null), [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    api<Connections>("/api/mcp-connections", { signal: controller.signal }).then((records) => { setConnections(records); setError(""); setConfirm(null); }).catch(() => { if (!controller.signal.aborted) setError("Couldn’t load your connected apps. Try again."); });
    return () => controller.abort();
  }, [open, attempt]);
  return <section aria-labelledby="connected-apps-heading" className="space-y-3 border-t pt-5"><h3 id="connected-apps-heading" className="text-sm font-medium">Connected apps</h3><p className="text-xs leading-relaxed text-muted-foreground">Apps you’ve allowed to use your cookbook through MCP. Revoke access whenever you need to.</p>{!connections && !error && <p role="status" className="flex items-center gap-2 text-xs text-muted-foreground"><LoaderCircle className="size-4 animate-spin" />Loading connected apps…</p>}{connections?.length === 0 && <p className="rounded-xl border p-4 text-sm text-muted-foreground">No apps connected yet.</p>}{connections && <ul className="space-y-3">{connections.map((connection) => <li key={connection.id} className="space-y-3 rounded-xl border p-4"><p className="break-words text-sm font-medium">{connection.name || "Unnamed app"}</p><p className="break-all text-xs text-muted-foreground">{connection.clientId}</p><ul className="space-y-1">{connection.scopes.map((scope) => <li key={scope} className="text-xs leading-relaxed text-muted-foreground">{connectionPermissions[scope]?.title ?? scope}</li>)}</ul>{confirm === connection.id ? <div className="space-y-3 border-t pt-3"><p className="text-xs leading-relaxed">Revoke this app’s access? It will need your permission to connect again.</p><div className="flex flex-wrap gap-2"><Button variant="outline" size="sm" disabled={busy} onClick={async () => {
    setBusy(true); setError("");
    try { await api(`/api/mcp-connections/${connection.id}`, { method: "DELETE" }); setConnections((records) => records?.filter((record) => record.id !== connection.id) ?? []); setConfirm(null); }
    catch (error) { setError(error instanceof Error ? error.message : "Couldn’t revoke access. Try again."); }
    finally { setBusy(false); }
  }}>Confirm revoke</Button><Button variant="ghost" size="sm" disabled={busy} onClick={() => setConfirm(null)}>Keep connection</Button></div></div> : <Button variant="ghost" size="sm" disabled={busy} onClick={() => setConfirm(connection.id)}><Unplug />Revoke access</Button>}</li>)}</ul>}{error && <div className="space-y-2"><p role="alert" className="text-xs text-destructive">{error}</p><Button variant="outline" size="sm" disabled={busy} onClick={() => setAttempt((value) => value + 1)}>Reload connected apps</Button></div>}</section>;
}
