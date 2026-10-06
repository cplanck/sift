import type { getUsageSummary } from "@/services/ai-usage";

export type UsageSummary = Awaited<ReturnType<typeof getUsageSummary>>;
function usd(value: string) {
  const [whole, fraction = ""] = value.split(".");
  const digits = fraction.padEnd(5, "0");
  if (BigInt(whole) === 0n && digits.slice(0, 4) === "0000" && /[1-9]/.test(fraction)) return "<$0.0001";
  const rounded = BigInt(whole) * 10_000n + BigInt(digits.slice(0, 4)) + (digits[4] >= "5" ? 1n : 0n);
  return `$${rounded / 10_000n}.${(rounded % 10_000n).toString().padStart(4, "0").replace(/0+$/, "").padEnd(2, "0")}`;
}
const exactCost = (value: string | null) => value === null ? undefined : `Provider-reported: $${value} USD`;
function modelLabel(model: string) {
  const match = /(?:^|\/)claude-(sonnet|haiku|opus)-([\d.]+)$/.exec(model);
  return match ? `${match[1][0].toUpperCase()}${match[1].slice(1)} ${match[2]}` : model;
}
function gatewayCost(usage: Pick<UsageSummary, "calls" | "reportedCostUsd" | "unpricedCalls">) {
  if (!usage.calls) return "No model calls";
  if (usage.reportedCostUsd === null) return "Awaiting cost";
  return `${usd(usage.reportedCostUsd)}${usage.unpricedCalls ? " subtotal" : ""}`;
}
const count = (value: number) => value.toLocaleString("en-US");

export function AiUsageDetails({ usage, title = "Conversation usage", cookbook = false, expanded = false }: {
  usage: UsageSummary; title?: string; cookbook?: boolean; expanded?: boolean;
}) {
  const body = <div className="space-y-4 text-xs text-muted-foreground">
    {cookbook && <p className="leading-relaxed">Model usage in this cookbook, including imports, cooking notes, and deleted chats.</p>}
    <dl className="grid grid-cols-2 gap-x-4 gap-y-3 rounded-xl border p-3">
      <div><dt>Gateway cost</dt><dd title={exactCost(usage.reportedCostUsd)} className="mt-1 font-medium tabular-nums text-foreground">{gatewayCost(usage)}</dd></div>
      <div><dt>Model calls</dt><dd className="mt-1 font-medium tabular-nums text-foreground">{count(usage.calls)}</dd></div>
      <div><dt>Input tokens</dt><dd className="mt-1 tabular-nums text-foreground">{count(usage.inputTokens)}</dd></div>
      <div><dt>Output tokens</dt><dd className="mt-1 tabular-nums text-foreground">{count(usage.outputTokens)}</dd></div>
    </dl>
    {(usage.unpricedCalls > 0 || usage.unreportedTokenCalls > 0) && <p className="leading-relaxed">
      {usage.unpricedCalls > 0 && `${count(usage.unpricedCalls)} ${usage.unpricedCalls === 1 ? "call awaiting" : "calls awaiting"} cost. `}
      {usage.unreportedTokenCalls > 0 && `${count(usage.unreportedTokenCalls)} ${usage.unreportedTokenCalls === 1 ? "call awaiting" : "calls awaiting"} token details.`}
    </p>}
    {!!usage.turns?.length && <details className="border-t pt-3">
      <summary className="cursor-pointer font-medium text-foreground">By turn</summary>
      <div className="mt-2 divide-y">
        {usage.turns.map((turn) => <section key={turn.runId} aria-label={`Turn ${turn.number}`} className="space-y-1 py-3">
          <div className="flex items-baseline justify-between gap-3"><p className="font-medium text-foreground">Turn {turn.number}{turn.status !== "completed" && <span className="ml-2 font-normal text-muted-foreground">{turn.status === "aborted" ? "Interrupted" : turn.status === "running" ? "Running" : "Failed"}</span>}</p><p title={exactCost(turn.reportedCostUsd)} className="shrink-0 tabular-nums text-foreground">{gatewayCost(turn)}</p></div>
          {turn.calls > 0 && <p title={`${count(turn.calls)} model ${turn.calls === 1 ? "call" : "calls"}`} className="break-words tabular-nums">{count(turn.inputTokens)} in · {count(turn.outputTokens)} out{turn.unreportedTokenCalls > 0 ? " reported" : ""}{turn.models.length > 0 ? ` · ${turn.models.map(modelLabel).join(", ")}` : ""}</p>}
          {turn.unpricedCalls > 0 && <p>{count(turn.unpricedCalls)} {turn.unpricedCalls === 1 ? "call awaiting" : "calls awaiting"} cost</p>}
          {turn.unreportedTokenCalls > 0 && <p>{count(turn.unreportedTokenCalls)} {turn.unreportedTokenCalls === 1 ? "call awaiting" : "calls awaiting"} token details</p>}
        </section>)}
      </div>
      {usage.totalTurns !== undefined && usage.totalTurns > usage.turns.length && <p className="mt-2">Latest {usage.turns.length} of {count(usage.totalTurns)} turns. Totals include every turn.</p>}
    </details>}
    {!!usage.unassignedCalls && <p>{count(usage.unassignedCalls)} earlier {usage.unassignedCalls === 1 ? "call is" : "calls are"} included in totals without a turn record.</p>}
    {usage.voice.sessions > 0 && <section aria-label="ElevenLabs voice usage" className="space-y-2 border-t pt-3">
      <div className="flex items-baseline justify-between gap-3"><p className="font-medium text-foreground">ElevenLabs voice</p><p title={exactCost(usage.voice.reportedCostUsd)} className="tabular-nums text-foreground">{usage.voice.reportedCostUsd === null ? "Awaiting cost" : `${usd(usage.voice.reportedCostUsd)}${usage.voice.unpricedSessions > 0 ? " subtotal" : ""}`}</p></div>
      <p className="tabular-nums">{count(usage.voice.sessions)} {usage.voice.sessions === 1 ? "session" : "sessions"} · {count(usage.voice.reportedDurationSeconds)} seconds reported{usage.voice.reportedCredits !== null ? ` · ${count(usage.voice.reportedCredits)} credits` : ""}</p>
      {usage.voice.unpricedSessions > 0 && <p>{count(usage.voice.unpricedSessions)} {usage.voice.unpricedSessions === 1 ? "session awaiting" : "sessions awaiting"} cost</p>}
      <p>Voice is billed per session, separately from model turns.</p>
    </section>}
    <p>Provider-reported USD, rounded for display.</p>
  </div>;
  return expanded ? body : <details className="text-xs text-muted-foreground">
    <summary title={exactCost(usage.reportedCostUsd)} className="cursor-pointer py-2">{title}{usage.reportedCostUsd !== null ? ` · ${gatewayCost(usage)}` : ""}</summary>
    <div className="pt-2">{body}</div>
  </details>;
}
