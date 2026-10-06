import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import { inArray } from "drizzle-orm";
import { connectDatabase } from "@/db/connection";
import { aiUsage, conversations, conversationToolCalls, conversationTurns, users, workspaceMembers } from "@/db/schema";
import { getAgentUsage } from "@/services/agent-usage";
import { ensurePersonalWorkspace, type Actor } from "@/services/workspaces";
import { testDatabaseUrl } from "./database";

const { db, pool } = connectDatabase(testDatabaseUrl);
const userIds = [randomUUID(), randomUUID()];
let owner: Actor, teammate: Actor;
const conversationId = randomUUID(), privateConversationId = randomUUID(), runId = randomUUID();
beforeAll(async () => {
  await db.insert(users).values(userIds.map(id => ({ id, name: "Usage test", email: `${id}@example.test` })));
  owner = { userId: userIds[0], workspaceId: await ensurePersonalWorkspace(db, userIds[0]) };
  teammate = { userId: userIds[1], workspaceId: owner.workspaceId };
  await db.insert(workspaceMembers).values(teammate);
  await db.insert(conversations).values([
    { id: conversationId, workspaceId: owner.workspaceId, createdByUserId: owner.userId, title: "Owner chat" },
    { id: privateConversationId, workspaceId: owner.workspaceId, createdByUserId: teammate.userId, title: "Private teammate chat" },
  ]);
  const otherRun = randomUUID(), startedAt = new Date(Date.now() - 20000);
  await db.insert(conversationTurns).values([
    { id: runId, conversationId, requestId: randomUUID(), status: "completed", createdAt: startedAt, finishedAt: new Date(startedAt.getTime() + 12000) },
    { id: otherRun, conversationId: privateConversationId, requestId: randomUUID(), status: "completed" },
  ]);
  await db.insert(aiUsage).values([
    { workspaceId: owner.workspaceId, userId: owner.userId, conversationId, runId, idempotencyKey: randomUUID(), model: "model-a", credentialSource: "app", inputTokens: 100, outputTokens: 20, costUsd: "0.0012" },
    { workspaceId: owner.workspaceId, userId: owner.userId, conversationId, runId, idempotencyKey: randomUUID(), model: "model-b", credentialSource: "user" },
    { workspaceId: owner.workspaceId, userId: teammate.userId, conversationId: privateConversationId, runId: otherRun, idempotencyKey: randomUUID(), model: "private-model", credentialSource: "app", costUsd: "999" },
  ]);
  await db.insert(conversationToolCalls).values([1, 2, 3].map(i => ({ conversationId, runId, toolCallId: `action-${i}`, toolName: "updateRecipe", result: { ok: true } })));
});
afterAll(async () => { await db.delete(users).where(inArray(users.id, userIds)); await pool.end(); });

it("aggregates model calls and saved actions without multiplying costs, and isolates account data", async () => {
  const report = await getAgentUsage(db, owner, { days: "all" });
  expect(report.totals).toMatchObject({ runs: 1, calls: 2, actions: 3, inputTokens: 100, outputTokens: 20, unpriced: 1, unreported: 1 });
  expect(Number(report.totals.cost)).toBe(0.0012);
  expect(report.runs[0]).toMatchObject({ id: runId, title: "Owner chat", duration: 12, calls: 2, actions: 3 });
  expect(report.runs[0].models.sort()).toEqual(["model-a", "model-b"]);
  const privateReport = await getAgentUsage(db, teammate, { days: "all" });
  expect(privateReport.runs.map(run => run.title)).toEqual(["Private teammate chat"]);
  await expect(getAgentUsage(db, { ...owner, userId: randomUUID() }, {})).rejects.toMatchObject({ code: "NOT_FOUND" });
});

it("filters dates and treats a run without a live lease as interrupted", async () => {
  await db.insert(conversationTurns).values([
    { conversationId, requestId: randomUUID(), status: "failed", createdAt: new Date(Date.now() - 40 * 86400000) },
    { conversationId, requestId: randomUUID(), status: "running" },
  ]);
  expect((await getAgentUsage(db, owner, { days: "7", status: "failed" })).totals.runs).toBe(0);
  expect((await getAgentUsage(db, owner, { days: "all", status: "failed" })).totals.runs).toBe(1);
  const report = await getAgentUsage(db, owner, { status: "interrupted" });
  expect(report.runs).toHaveLength(1);
  expect(report.runs[0]).toMatchObject({ status: "interrupted", calls: 0, cost: null, duration: null });
});

it("paginates and clamps stale pages while sorting unknown costs last", async () => {
  await db.insert(conversationTurns).values(Array.from({ length: 26 }, () => ({ conversationId, requestId: randomUUID(), status: "completed" as const })));
  const first = await getAgentUsage(db, owner, { days: "all", status: "completed", sort: "cost" });
  expect(first.runs).toHaveLength(25); expect(first.pageCount).toBe(2);
  expect(first.runs[0].id).toBe(runId);
  const last = await getAgentUsage(db, owner, { days: "all", status: "completed", page: 999 });
  expect(last.filters.page).toBe(2); expect(last.runs).toHaveLength(2);
});
