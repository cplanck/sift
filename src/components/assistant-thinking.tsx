"use client";
import { useEffect, useState } from "react";

/** Live activity line: shimmering label that admits when work is taking a while. */
export function AssistantActivity({ label = "Thinking…", icon }: { label?: string; icon?: React.ReactNode }) {
  const [slow, setSlow] = useState(false);
  useEffect(() => { const timer = setTimeout(() => setSlow(true), 12_000); return () => clearTimeout(timer); }, []);
  return <div role="status" className="flex min-h-7 items-center gap-2.5 text-[13px]">
    {icon ?? <span aria-hidden="true" className="sift-thinking flex h-4 items-center gap-[3px]"><i /><i /><i /></span>}
    <span className="sift-shimmer">{label}</span>
    {slow && <span className="text-xs text-muted-foreground/70">Still working…</span>}
  </div>;
}

export function AssistantThinking({ label = "Thinking…" }: { label?: string }) {
  return <AssistantActivity label={label} />;
}
