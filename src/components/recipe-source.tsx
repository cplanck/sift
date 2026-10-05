import { ExternalLink } from "lucide-react";
import type { RecipeSource } from "@/domain/recipe";

export function RecipeSourceInfo({ source, showOriginal = false }: { source: RecipeSource; showOriginal?: boolean }) {
  const labels = { manual: "Added by you", paste: "Imported from pasted text", url: "Imported from a website", image: "Imported from a recipe image", mcp: "Imported through MCP" };
  const url = source.url && /^https?:\/\//i.test(source.url) ? source.url : null;
  return <div className="space-y-2 text-sm text-muted-foreground"><p>{labels[source.type]}{source.importedAt && <> · {new Date(source.importedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })}</>}</p>
    {url ? <a href={url} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 max-w-full items-center gap-2 break-all underline underline-offset-4">{source.name || new URL(url).hostname}<ExternalLink className="size-3.5 shrink-0" /></a> : source.name && <p>{source.name}</p>}
    {showOriginal && source.rawText && <details><summary className="cursor-pointer py-2">Original text</summary><pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-muted p-4 font-sans text-xs leading-relaxed">{source.rawText}</pre></details>}
  </div>;
}
