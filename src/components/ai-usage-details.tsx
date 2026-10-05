import type { getUsageSummary } from "@/services/ai-usage";

export type UsageSummary = Awaited<ReturnType<typeof getUsageSummary>>;
function usd(value: string) {
  const [whole, fraction = ""] = value.split(".");
  return `$${whole}.${fraction.replace(/0+$/, "").padEnd(2, "0")}`;
}
export function AiUsageDetails({ usage, title = "Conversation usage", cookbook = false }: { usage: UsageSummary; title?: string; cookbook?: boolean }) {
  return <details className="text-xs text-muted-foreground"><summary className="cursor-pointer py-2">{title}{usage.reportedCostUsd !== null ? ` · ${usd(usage.reportedCostUsd)}${usage.unpricedCalls ? " reported" : ""}` : ""}</summary>
    {cookbook && <p className="mb-3 mt-2 leading-relaxed">Your usage in this cookbook, including imports and conversations. Deleting a conversation keeps its recorded usage.</p>}
    <dl className="mt-2 space-y-2 rounded-xl border p-3"><div className="flex justify-between gap-3"><dt>Model calls</dt><dd>{usage.calls}</dd></div><div className="flex justify-between gap-3"><dt>Input tokens</dt><dd>{usage.inputTokens.toLocaleString("en-US")}</dd></div><div className="flex justify-between gap-3"><dt>Output tokens</dt><dd>{usage.outputTokens.toLocaleString("en-US")}</dd></div><div className="flex justify-between gap-3"><dt>{usage.unpricedCalls > 0 && usage.reportedCostUsd !== null ? "Known subtotal" : "Reported cost"}</dt><dd>{usage.reportedCostUsd === null ? "Not yet reported" : usd(usage.reportedCostUsd)}</dd></div>{usage.unpricedCalls > 0 && <div className="flex justify-between gap-3"><dt>Calls awaiting cost</dt><dd>{usage.unpricedCalls}</dd></div>}{usage.models.length > 0 && <div className="border-t pt-2"><dt>Models</dt><dd className="mt-1 break-words leading-relaxed">{usage.models.join(", ")}</dd></div>}</dl><p className="mt-2 leading-relaxed">Usage reflects details returned by the provider. Check your Gateway account for final billing.</p>
  </details>;
}
