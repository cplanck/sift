import { and, eq } from "drizzle-orm";
import { z } from "zod";
import type { LanguageModelUsage } from "ai";
import type { Database } from "@/db/connection";
import { aiUsage, conversations, conversationTurns, recipeImports } from "@/db/schema";
import { DomainError } from "@/domain/errors";
import { assertMembership, type Actor } from "./workspaces";

function tokenCount(value: unknown) { return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= 2_147_483_647 ? value : null; }
function object(value: unknown): Record<string, unknown> { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
export function reportedGatewayCost(metadata: unknown): string | null {
  const cost = object(object(metadata).gateway).cost;
  const raw = typeof cost === "number" && Number.isFinite(cost) ? cost.toFixed(10) : typeof cost === "string" ? cost.trim().replace(/^\$/, "") : "";
  // Missing, malformed and estimated costs never become a zero-dollar charge.
  return /^\d{1,10}(?:\.\d{1,10})?$/.test(raw) ? raw : null;
}
export async function recordModelUsage(db: Database, actor: Actor, input: {
  idempotencyKey: string; conversationId?: string; runId?: string; importId?: string;
  model: string; credentialSource: "user" | "app"; usage?: Partial<LanguageModelUsage>; providerMetadata?: unknown;
}) {
  await assertMembership(db, actor);
  z.object({ idempotencyKey: z.string().min(1).max(300), model: z.string().min(1).max(200), conversationId: z.uuid().optional(), runId: z.uuid().optional(), importId: z.uuid().optional(), credentialSource: z.enum(["user", "app"]) }).parse(input);
  if (input.conversationId) {
    const [conversation] = await db.select({ id: conversations.id }).from(conversations).where(and(eq(conversations.id, input.conversationId), eq(conversations.workspaceId, actor.workspaceId), eq(conversations.createdByUserId, actor.userId)));
    if (!conversation) throw new DomainError("NOT_FOUND", "Conversation not found.");
  }
  if (input.runId) {
    if (!input.conversationId) throw new DomainError("INVALID_INPUT", "Usage requires its conversation.");
    const [run] = await db.select({ id: conversationTurns.id }).from(conversationTurns).where(and(eq(conversationTurns.id, input.runId), eq(conversationTurns.conversationId, input.conversationId)));
    if (!run) throw new DomainError("NOT_FOUND", "Conversation turn not found.");
  }
  if (input.importId) {
    const [record] = await db.select({ id: recipeImports.id }).from(recipeImports).where(and(eq(recipeImports.id, input.importId), eq(recipeImports.workspaceId, actor.workspaceId), eq(recipeImports.createdByUserId, actor.userId)));
    if (!record) throw new DomainError("NOT_FOUND", "Import not found.");
  }
  const gateway = object(object(input.providerMetadata).gateway);
  const generationId = typeof gateway.generationId === "string" && /^[a-zA-Z0-9_-]{1,200}$/.test(gateway.generationId) ? gateway.generationId : null;
  const reported = {
    ...(input.usage ? { inputTokens: tokenCount(input.usage.inputTokens), outputTokens: tokenCount(input.usage.outputTokens), totalTokens: tokenCount(input.usage.totalTokens) } : {}),
    ...(input.providerMetadata ? { costUsd: reportedGatewayCost(input.providerMetadata), generationId } : {}),
  };
  await db.insert(aiUsage).values({ workspaceId: actor.workspaceId, userId: actor.userId, idempotencyKey: `${actor.workspaceId}:${actor.userId}:${input.idempotencyKey}`, conversationId: input.conversationId, runId: input.runId, importId: input.importId, model: input.model, credentialSource: input.credentialSource, ...reported })
    .onConflictDoUpdate({ target: aiUsage.idempotencyKey, set: { ...reported, updatedAt: new Date() } });
}
export async function getUsageSummary(db: Database, actor: Actor, conversationId?: string) {
  await assertMembership(db, actor);
  if (conversationId) {
    if (!z.uuid().safeParse(conversationId).success) throw new DomainError("NOT_FOUND", "Conversation not found.");
    const [conversation] = await db.select({ id: conversations.id }).from(conversations).where(and(eq(conversations.id, conversationId), eq(conversations.workspaceId, actor.workspaceId), eq(conversations.createdByUserId, actor.userId)));
    if (!conversation) throw new DomainError("NOT_FOUND", "Conversation not found.");
  }
  const rows = await db.select({ inputTokens: aiUsage.inputTokens, outputTokens: aiUsage.outputTokens, costUsd: aiUsage.costUsd, model: aiUsage.model, credentialSource: aiUsage.credentialSource }).from(aiUsage)
    .where(and(eq(aiUsage.workspaceId, actor.workspaceId), eq(aiUsage.userId, actor.userId), ...(conversationId ? [eq(aiUsage.conversationId, z.uuid().parse(conversationId))] : [])));
  // Integer ten-billionths keep USD addition exact at the ledger's precision.
  let costUnits = 0n, knownCosts = 0;
  for (const row of rows) if (row.costUsd !== null) { const [whole, fraction = ""] = row.costUsd.split("."); costUnits += BigInt(whole) * 10_000_000_000n + BigInt(fraction.padEnd(10, "0")); knownCosts++; }
  const reportedCostUsd = knownCosts ? `${costUnits / 10_000_000_000n}.${(costUnits % 10_000_000_000n).toString().padStart(10, "0")}` : null;
  return { calls: rows.length, inputTokens: rows.reduce((sum, row) => sum + (row.inputTokens ?? 0), 0), outputTokens: rows.reduce((sum, row) => sum + (row.outputTokens ?? 0), 0), reportedCostUsd, unpricedCalls: rows.length - knownCosts, models: [...new Set(rows.map((row) => row.model))], userKeyCalls: rows.filter((row) => row.credentialSource === "user").length, appKeyCalls: rows.filter((row) => row.credentialSource === "app").length };
}
