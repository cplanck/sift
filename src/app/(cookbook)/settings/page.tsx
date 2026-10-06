import Link from "next/link";
import styles from "./settings.module.css";
import { AppHeader, pageFrame } from "@/components/app-header";
import { UserSettingsControls } from "@/components/user-settings-controls";
import { Button } from "@/components/ui/button";
import { database } from "@/db";
import { requireViewer } from "@/lib/auth";
import { agentUsageFilterSchema, getAgentUsage, type AgentUsageFilters } from "@/services/agent-usage";

export const metadata = { title: "User settings" };
const number = (value: number) => value.toLocaleString("en-US");
function money(value: string | null, calls: number) {
  if (value === null) return calls ? "Pending" : "—";
  const cost = Number(value);
  return cost > 0 && cost < 0.0001 ? "<$0.0001" : `$${cost.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`;
}
function href(filters: AgentUsageFilters, page: number) {
  return `/settings?${new URLSearchParams({ ...filters, page: String(page) })}`;
}
const statuses = { all: "All statuses", completed: "Completed", failed: "Failed", aborted: "Stopped", running: "Running", interrupted: "Interrupted" };
export default async function SettingsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const viewer = await requireViewer();
  const { filters, totals, runs, pageSize, pageCount } = await getAgentUsage(database(), viewer, agentUsageFilterSchema.parse(await searchParams));
  return <><AppHeader name={viewer.name} /><main id="main" className={`${pageFrame} pb-20 pt-6`}>
    <div className="mx-auto max-w-7xl space-y-8">
      <header className="flex flex-wrap items-end justify-between gap-5"><div><p className="text-xs uppercase tracking-widest text-muted-foreground">Your account</p><h1 className="mt-2 font-serif text-3xl sm:text-4xl">User settings</h1><p className="mt-3 break-words text-sm text-muted-foreground">{viewer.name} · {viewer.email}</p></div><UserSettingsControls /></header>
      <section aria-labelledby="usage-heading" className="space-y-5">
        <div><h2 id="usage-heading" className="text-xl font-medium">Agent usage</h2><p className="mt-2 text-sm leading-relaxed text-muted-foreground">Runs from your saved conversations in this cookbook. Each run can include several model calls.</p></div>
        <form key={JSON.stringify(filters)} action="/settings" className="grid grid-cols-2 items-end gap-3 sm:flex sm:flex-wrap [&_select]:w-full [&_select]:min-w-0">
          <label className="space-y-1.5 text-xs text-muted-foreground"><span className="block">Period</span><select name="days" defaultValue={filters.days} className="h-11 rounded-xl border bg-background px-3 text-sm text-foreground"><option value="7">Last 7 days</option><option value="30">Last 30 days</option><option value="90">Last 90 days</option><option value="all">All time</option></select></label>
          <label className="space-y-1.5 text-xs text-muted-foreground"><span className="block">Status</span><select name="status" defaultValue={filters.status} className="h-11 rounded-xl border bg-background px-3 text-sm text-foreground">{Object.entries(statuses).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label className="space-y-1.5 text-xs text-muted-foreground"><span className="block">Sort</span><select name="sort" defaultValue={filters.sort} className="h-11 rounded-xl border bg-background px-3 text-sm text-foreground"><option value="newest">Newest first</option><option value="cost">Highest cost</option></select></label>
          <Button type="submit" variant="outline" className="h-11">Apply</Button>
        </form>
        <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">{[
          [totals.unpriced ? "Reported cost · subtotal" : "Reported cost", money(totals.cost, totals.calls)],
          ["Runs", number(totals.runs)], ["Model calls", number(totals.calls)],
          [totals.unreported ? "Reported tokens · subtotal" : "Tokens", number(totals.inputTokens + totals.outputTokens)],
        ].map(([label, value]) => <div key={label} className="min-w-0 rounded-2xl border bg-muted/20 p-4 sm:p-5"><dt className="text-xs text-muted-foreground">{label}</dt><dd className="mt-2 break-words text-xl font-medium tabular-nums sm:text-2xl">{value}</dd></div>)}</dl>
        <div className={styles.usage}><table className={styles.table}><caption className="sr-only">Agent runs, model usage, and provider-reported costs</caption>
          <thead className="sticky top-0 z-[1] border-b bg-muted text-xs text-muted-foreground"><tr>{["Started (UTC)", "Conversation / run", "Status", "Calls", "Saved actions", "Input tokens", "Output tokens", "Duration", "Cost (USD)"].map((title) => <th key={title} scope="col" className="whitespace-nowrap px-4 py-3 font-medium">{title}</th>)}</tr></thead>
          <tbody className="divide-y">{runs.map((run) => <tr key={run.id} className="align-top hover:bg-muted/20">
            <td data-label="Started (UTC)" className="whitespace-nowrap px-4 py-4 text-xs text-muted-foreground">{new Date(run.startedAt).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZone: "UTC" })}</td>
            <td className="max-w-72 px-4 py-4"><details><summary className="cursor-pointer break-words font-medium">{run.title}</summary><div className="mt-2 space-y-2 break-all text-xs text-muted-foreground"><p>Run: {run.id}</p><p>Request: {run.requestId}</p><p className="break-words">{run.models.length ? run.models.join(", ") : "No model calls recorded"}</p></div></details></td>
            <td data-label="Status" className="px-4 py-4"><span className={`inline-flex rounded-full px-2.5 py-1 text-xs ${run.status === "failed" ? "bg-destructive/10 text-destructive" : run.status === "completed" ? "bg-selection text-selection-foreground" : "bg-muted text-muted-foreground"}`}>{statuses[run.status as keyof typeof statuses] ?? run.status}</span></td>
            <td data-label="Calls" className="px-4 py-4 tabular-nums">{number(run.calls)}</td><td data-label="Saved actions" className="px-4 py-4 tabular-nums">{number(run.actions)}</td>
            <td data-label="Input tokens" className="px-4 py-4 tabular-nums">{run.calls ? number(run.inputTokens) : "—"}{run.unreported > 0 && <span className="block text-[10px] text-muted-foreground">Partial</span>}</td>
            <td data-label="Output tokens" className="px-4 py-4 tabular-nums">{run.calls ? number(run.outputTokens) : "—"}{run.unreported > 0 && <span className="block text-[10px] text-muted-foreground">Partial</span>}</td>
            <td data-label="Duration" className="whitespace-nowrap px-4 py-4 tabular-nums">{run.duration === null ? "—" : run.duration < 60 ? `${run.duration.toFixed(1)}s` : `${Math.floor(run.duration / 60)}m ${Math.floor(run.duration % 60)}s`}</td>
            <td data-label="Cost (USD)" className="whitespace-nowrap px-4 py-4 font-medium tabular-nums" title={run.cost === null ? undefined : `$${run.cost} USD`}>{money(run.cost, run.calls)}{run.unpriced > 0 && <span className="block text-[10px] font-normal text-muted-foreground">{run.unpriced} awaiting cost</span>}</td>
          </tr>)}{runs.length === 0 && <tr><td colSpan={9} className="px-5 py-14 text-center text-muted-foreground">No agent runs in this period. Try a wider date range or start a conversation with Sift.</td></tr>}</tbody>
        </table></div>
        <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground"><p>{totals.runs ? `${number((filters.page - 1) * pageSize + 1)}–${number(Math.min(filters.page * pageSize, totals.runs))} of ${number(totals.runs)} runs` : "0 runs"}</p><nav aria-label="Usage pages" className="flex items-center gap-3">{filters.page > 1 && <Button variant="outline" size="sm" asChild><Link href={href(filters, filters.page - 1)}>Previous</Link></Button>}<span>Page {filters.page} of {pageCount}</span>{filters.page < pageCount && <Button variant="outline" size="sm" asChild><Link href={href(filters, filters.page + 1)}>Next</Link></Button>}</nav></div>
        <p className="max-w-3xl text-xs leading-relaxed text-muted-foreground">Provider-reported USD; pending costs are not counted as zero. {totals.unpriced > 0 ? `${number(totals.unpriced)} model calls await cost. ` : ""}This table excludes deleted conversations, recipe imports, cooking-note cleanup, image generation, and ElevenLabs voice charges. Overall model and voice totals are available in Sift settings.</p>
      </section>
    </div>
  </main></>;
}
