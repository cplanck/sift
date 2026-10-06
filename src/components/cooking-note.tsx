import type { CookingNote } from "@/domain/cooking";

export function CookingNoteView({ note }: { note: CookingNote }) {
  return <div className="space-y-2 text-sm leading-relaxed">
    <p className="whitespace-pre-wrap break-words">{note.organizedBody ?? note.body}</p>
    {(note.cleanupStatus === "queued" || note.cleanupStatus === "processing") && <p className="text-xs text-muted-foreground" role="status">Notes saved · Sift is organizing them.</p>}
    {note.cleanupStatus === "failed" && <p className="text-xs text-muted-foreground">Sift couldn’t organize these notes. Your original is saved.</p>}
    {note.organizedBody && <details className="text-xs text-muted-foreground"><summary className="cursor-pointer py-1">Original notes</summary><p className="mt-2 whitespace-pre-wrap break-words leading-relaxed">{note.body}</p></details>}
  </div>;
}
