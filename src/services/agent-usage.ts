import { sql } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "@/db/connection";
import { assertMembership, type Actor } from "./workspaces";

export const agentUsageFilterSchema = z.object({
  days: z.enum(["7", "30", "90", "all"]).catch("30"),
  status: z.enum(["all", "completed", "failed", "aborted", "running", "interrupted"]).catch("all"),
  sort: z.enum(["newest", "cost"]).catch("newest"),
  page: z.coerce.number().int().min(1).max(100000).catch(1),
});
export type AgentUsageFilters = z.infer<typeof agentUsageFilterSchema>;
export type AgentUsageRun = {
  id: string; requestId: string; title: string; status: string; startedAt: string; finishedAt: string | null;
  calls: number; actions: number; inputTokens: number; outputTokens: number; unpriced: number; unreported: number;
  cost: string | null; models: string[]; duration: number | null;
};
type Totals = { runs: number; calls: number; actions: number; inputTokens: number; outputTokens: number; unpriced: number; unreported: number; cost: string | null };

export async function getAgentUsage(db: Database, actor: Actor, input: unknown) {
  await assertMembership(db, actor);
  const filters = agentUsageFilterSchema.parse(input);
  // Scope both the conversation and usage ledger before joining; no other
  // user's conversation titles, request IDs, or spend enter this report.
  const base = sql`with scoped_runs as (
    select t.id, t.request_id, c.title, t.created_at, t.finished_at,
      case when t.status = 'running' and not (c.active_run_id = t.id and c.lease_expires_at > now()) then 'interrupted'
        when t.status = 'running' and (c.active_run_id is null or c.lease_expires_at is null) then 'interrupted' else t.status end as status
    from conversation_turns t join conversations c on c.id = t.conversation_id
    where c.workspace_id = ${actor.workspaceId} and c.created_by_user_id = ${actor.userId}
      ${filters.days === "all" ? sql`` : sql`and t.created_at >= now() - (${Number(filters.days)} * interval '1 day')`}
  ), usage_by_run as (
    select u.run_id, count(*)::int as calls, sum(u.cost_usd) as cost,
      coalesce(sum(u.input_tokens), 0)::bigint as input_tokens, coalesce(sum(u.output_tokens), 0)::bigint as output_tokens,
      count(*) filter (where u.cost_usd is null)::int as unpriced,
      count(*) filter (where u.input_tokens is null or u.output_tokens is null)::int as unreported,
      array_agg(distinct u.model) as models
    from ai_usage u join scoped_runs r on r.id = u.run_id
    where u.workspace_id = ${actor.workspaceId} and u.user_id = ${actor.userId} group by u.run_id
  ), actions_by_run as (
    select a.run_id, count(*)::int as actions from conversation_tool_calls a join scoped_runs r on r.id = a.run_id group by a.run_id
  ), report as (
    select r.*, coalesce(u.calls, 0) as calls, u.cost, coalesce(u.input_tokens, 0) as input_tokens,
      coalesce(u.output_tokens, 0) as output_tokens, coalesce(u.unpriced, 0) as unpriced, coalesce(u.unreported, 0) as unreported,
      coalesce(u.models, array[]::text[]) as models, coalesce(a.actions, 0) as actions
    from scoped_runs r left join usage_by_run u on u.run_id = r.id left join actions_by_run a on a.run_id = r.id
    where ${filters.status === "all" ? sql`true` : sql`r.status = ${filters.status}`}
  )`;
  const totalsResult = await db.execute<Totals>(sql`${base} select count(*)::int as runs, coalesce(sum(calls), 0)::int as calls,
    coalesce(sum(actions), 0)::int as actions, coalesce(sum(input_tokens), 0)::float8 as "inputTokens",
    coalesce(sum(output_tokens), 0)::float8 as "outputTokens", coalesce(sum(unpriced), 0)::int as unpriced,
    coalesce(sum(unreported), 0)::int as unreported, sum(cost)::text as cost from report`);
  const totals = totalsResult.rows[0];
  const pageSize = 25, pageCount = Math.max(1, Math.ceil(totals.runs / pageSize));
  const page = Math.min(filters.page, pageCount);
  const result = await db.execute<AgentUsageRun>(sql`${base} select id, request_id as "requestId", title, status,
    created_at::text as "startedAt", finished_at::text as "finishedAt", calls, actions, cost::text,
    input_tokens::float8 as "inputTokens", output_tokens::float8 as "outputTokens", unpriced, unreported, models,
    case when finished_at is not null then greatest(0, extract(epoch from finished_at - created_at))::float8 else null end as duration
    from report order by ${filters.sort === "cost" ? sql`cost desc nulls last,` : sql``} created_at desc, id desc limit ${pageSize} offset ${(page - 1) * pageSize}`);
  return { filters: { ...filters, page }, totals, runs: result.rows, pageSize, pageCount };
}
