"use client";
import { CalendarCheck, CalendarPlus } from "lucide-react";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/client-http";
import { cn } from "@/lib/utils";
import { Button } from "./ui/button";

export function PlanButton({ id, initial, className }: { id: string; initial: boolean; className?: string }) {
  const [planned, setPlanned] = useState(initial), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const router = useRouter();
  return <div className="space-y-2"><Button variant="outline" aria-pressed={planned} disabled={busy} title={planned ? "Remove from your plan" : "Add to your plan to build a shopping list"} className={cn("h-12 w-full rounded-full px-6", planned && "border-foreground/40 bg-muted", className)} onClick={async () => {
    const next = !planned; setPlanned(next); setBusy(true); setError("");
    try { await api(`/api/recipes/${id}/actions`, { body: { action: "plan", planned: next } }); router.refresh(); }
    catch (error) { setPlanned(!next); setError(error instanceof Error ? error.message : "Your plan wasn’t updated. Try again."); }
    finally { setBusy(false); }
  }}>{planned ? <CalendarCheck /> : <CalendarPlus />}{planned ? "Planned" : "Plan"}</Button>{error && <p role="alert" className="text-sm text-destructive">{error}</p>}</div>;
}
