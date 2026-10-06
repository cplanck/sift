"use client";
import { useState } from "react";
import { Copy, FileText, Share2 } from "lucide-react";
import { artifactToText, type ArtifactDetail } from "@/domain/artifact";
import { groceryToMarkdown } from "@/domain/grocery";
import { Button } from "./ui/button";

export function ArtifactActions({ artifact, compact = false }: { artifact: ArtifactDetail; compact?: boolean }) {
  const [message, setMessage] = useState(""), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  async function share(copy: boolean, markdown = false) {
    setBusy(true); setError(""); setMessage("");
    try {
      const text = markdown ? groceryToMarkdown(artifact) : artifactToText(artifact);
      if (!copy && navigator.share) { await navigator.share({ title: artifact.title, text }); setMessage("Shared."); }
      else if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(text); setMessage(markdown ? "Copied what you still need as a Markdown checklist." : copy ? "Copied." : "Copied. Paste it into the app you want to share with."); }
      else setError("Sharing isn’t available in this browser. Select and copy the text from this page.");
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError")) setError("Couldn’t share this text. Check your browser permissions and try again.");
    } finally { setBusy(false); }
  }
  return <div className="space-y-2"><div className="flex flex-wrap gap-2"><Button size={compact ? "sm" : "default"} variant="outline" disabled={busy} onClick={() => share(true)}><Copy />Copy text</Button>{artifact.kind === "grocery" && <Button size={compact ? "sm" : "default"} variant="outline" disabled={busy} onClick={() => share(true, true)}><FileText />Copy Markdown</Button>}<Button size={compact ? "sm" : "default"} variant="outline" disabled={busy} onClick={() => share(false)}><Share2 />Share text</Button></div>{message && <p role="status" className="text-xs leading-relaxed text-muted-foreground">{message}</p>}{error && <p role="alert" className="text-xs leading-relaxed text-destructive">{error}</p>}</div>;
}
