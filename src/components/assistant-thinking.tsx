export function AssistantThinking({ label = "Thinking…" }: { label?: string }) {
  return <div role="status" className="flex items-center gap-2.5 py-2 text-xs text-muted-foreground"><span aria-hidden="true" className="sift-thinking flex h-4 items-center gap-[3px]"><i /><i /><i /></span><span>{label}</span></div>;
}
