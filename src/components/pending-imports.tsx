"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowRight, FileText, LoaderCircle } from "lucide-react";
import type { listPendingImports } from "@/services/imports";
import { api } from "@/lib/client-http";

type PendingImports = Awaited<ReturnType<typeof listPendingImports>>;
export function PendingImports({ initial }: { initial: PendingImports }) {
  const [imports, setImports] = useState(initial);
  useEffect(() => {
    if (!initial.length) return;
    const controller = new AbortController();
    const timer = setInterval(async () => {
      try { const records = await api<PendingImports>("/api/imports", { signal: controller.signal }); if (!controller.signal.aborted) setImports(records); }
      catch { /* Existing durable records remain available during reconnect. */ }
    }, 7000);
    return () => { clearInterval(timer); controller.abort(); };
  }, [initial]);
  if (!imports.length) return null;
  return <section aria-labelledby="imports-heading" className="mb-8 rounded-2xl border bg-muted/25 p-4 sm:p-5"><h2 id="imports-heading" className="mb-2 text-sm font-medium">Your imports</h2><div className="divide-y">{imports.map((record) => <Link key={record.id} href={`/imports/${record.id}`} className="flex min-h-14 items-center gap-3 py-3 text-sm">
    {["queued", "processing"].includes(record.status) ? <LoaderCircle className="size-4 shrink-0 animate-spin text-muted-foreground" /> : <FileText className="size-4 shrink-0 text-muted-foreground" />}<div className="min-w-0 flex-1"><span>{record.kind === "paste" ? "Pasted recipe" : record.kind === "url" ? "Recipe from a URL" : "Recipe from a photo"}</span><p className="mt-1 text-xs text-muted-foreground">{record.status === "review" ? "Ready to review" : record.status === "failed" ? "Needs your attention" : record.status === "processing" ? "Reading recipe…" : "Waiting to import…"}</p></div><ArrowRight className="size-4 text-muted-foreground" /></Link>)}</div></section>;
}
