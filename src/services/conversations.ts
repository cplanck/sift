import { and, desc, eq } from "drizzle-orm";
import { isToolUIPart, type UIMessage } from "ai";
import { z } from "zod";
import type { Database, Executor } from "@/db/connection";
import { conversations, conversationToolCalls, conversationTurns } from "@/db/schema";
import { assistantRequestSchema, type AssistantRequest } from "@/domain/assistant";
import { DomainError } from "@/domain/errors";
import { assertMembership, type Actor } from "./workspaces";
import { getUsageSummary } from "./ai-usage";

const scope = (actor: Actor, id: string) => and(eq(conversations.id, id), eq(conversations.workspaceId, actor.workspaceId), eq(conversations.createdByUserId, actor.userId));
const isBusy = (row: typeof conversations.$inferSelect) => !!row.activeRunId && !!row.leaseExpiresAt && row.leaseExpiresAt.getTime() > Date.now();
const titleSchema = z.object({ title: z.string().trim().min(1).max(120) }).strict();
const interrupted = "The previous reply was interrupted. Some changes may have been saved; review the recipe before asking again.";

async function scopedConversation(db: Executor, actor: Actor, id: string) {
  await assertMembership(db, actor);
  if (!z.uuid().safeParse(id).success) throw new DomainError("NOT_FOUND", "Conversation not found.");
  const [row] = await db.select().from(conversations).where(scope(actor, id));
  if (!row) throw new DomainError("NOT_FOUND", "Conversation not found.");
  return row;
}
export async function listConversations(db: Database, actor: Actor) {
  await assertMembership(db, actor);
  return db.select({ id: conversations.id, title: conversations.title, createdAt: conversations.createdAt, updatedAt: conversations.updatedAt }).from(conversations)
    .where(and(eq(conversations.workspaceId, actor.workspaceId), eq(conversations.createdByUserId, actor.userId))).orderBy(desc(conversations.updatedAt));
}
export async function getConversation(db: Database, actor: Actor, id: string) {
  const row = await scopedConversation(db, actor, id);
  const busy = isBusy(row);
  // The mutation journal survives even a process crash between a tool commit and
  // stream persistence, so a reload can show what actually changed.
  const receipts = await db.select({ toolName: conversationToolCalls.toolName, result: conversationToolCalls.result, createdAt: conversationToolCalls.createdAt }).from(conversationToolCalls)
    .where(eq(conversationToolCalls.conversationId, row.id)).orderBy(desc(conversationToolCalls.createdAt)).limit(20);
  const usage = await getUsageSummary(db, actor, row.id);
  return { id: row.id, title: row.title, messages: row.messages, lastError: row.activeRunId && !busy ? interrupted : row.lastError, busy, receipts, usage, createdAt: row.createdAt, updatedAt: row.updatedAt };
}
export async function createConversation(db: Database, actor: Actor, input: unknown = {}) {
  const data = titleSchema.partial().parse(input);
  await assertMembership(db, actor);
  const [row] = await db.insert(conversations).values({ workspaceId: actor.workspaceId, createdByUserId: actor.userId, title: data.title ?? "New conversation" }).returning({ id: conversations.id });
  return getConversation(db, actor, row.id);
}
export async function renameConversation(db: Database, actor: Actor, id: string, input: unknown) {
  const { title } = titleSchema.parse(input);
  await scopedConversation(db, actor, id);
  await db.update(conversations).set({ title, updatedAt: new Date() }).where(scope(actor, id));
  return getConversation(db, actor, id);
}
export async function deleteConversation(db: Database, actor: Actor, id: string) {
  return db.transaction(async (tx) => {
    await scopedConversation(tx, actor, id);
    const [row] = await tx.select().from(conversations).where(scope(actor, id)).for("update");
    if (!row) throw new DomainError("NOT_FOUND", "Conversation not found.");
    if (isBusy(row)) throw new DomainError("CONFLICT", "Wait for the current reply before deleting this conversation.");
    await tx.delete(conversations).where(scope(actor, id));
    return { id };
  });
}

export async function beginConversationTurn(db: Database, actor: Actor, input: AssistantRequest) {
  const data = assistantRequestSchema.parse(input);
  return db.transaction(async (tx) => {
    await assertMembership(tx, actor);
    const [row] = await tx.select().from(conversations).where(scope(actor, data.conversationId)).for("update");
    if (!row) throw new DomainError("NOT_FOUND", "Conversation not found.");
    if (isBusy(row)) throw new DomainError("CONFLICT", "Sift is already replying in this conversation. Wait for that reply.");
    const [previous] = await tx.select({ id: conversationTurns.id }).from(conversationTurns).where(and(eq(conversationTurns.conversationId, row.id), eq(conversationTurns.requestId, data.requestId)));
    if (previous) throw new DomainError("CONFLICT", "This request was already received. Reload the conversation to see what was saved before asking again.");
    if (row.activeRunId) await tx.update(conversationTurns).set({ status: "failed", finishedAt: new Date() }).where(and(eq(conversationTurns.id, row.activeRunId), eq(conversationTurns.conversationId, row.id)));

    let messages = structuredClone(row.messages);
    const pending = messages.flatMap((message) => message.parts).filter((part) => isToolUIPart(part) && part.state === "approval-requested");
    if ("message" in data) {
      if (pending.length) throw new DomainError("CONFLICT", "Approve or decline the pending action before sending another message.");
      if (messages.length >= 200) throw new DomainError("INVALID_INPUT", "This conversation is full. Start a new conversation; your history will remain available.");
      if (messages.some((message) => message.id === data.message.id)) throw new DomainError("CONFLICT", "This message was already received. Reload the conversation.");
      messages.push({ id: data.message.id, role: "user", parts: [{ type: "text", text: data.message.text }] });
    } else {
      let found = false;
      messages = messages.map((message) => ({ ...message, parts: message.parts.map((part) => {
        if (!isToolUIPart(part) || part.state !== "approval-requested" || part.approval.id !== data.approval.id) return part;
        found = true;
        return { ...part, state: "approval-responded" as const, approval: { ...part.approval, approved: data.approval.approved } };
      }) }));
      if (!found) throw new DomainError("INVALID_INPUT", "This action is no longer awaiting approval. Reload the conversation.");
    }
    const [turn] = await tx.insert(conversationTurns).values({ conversationId: row.id, requestId: data.requestId, status: "running" }).returning({ id: conversationTurns.id });
    await tx.update(conversations).set({ messages, activeRunId: turn.id, leaseExpiresAt: new Date(Date.now() + 120_000), lastError: null, updatedAt: new Date(), ...(row.title === "New conversation" && "message" in data ? { title: data.message.text.slice(0, 80) } : {}) }).where(scope(actor, row.id));
    return { runId: turn.id, messages };
  });
}

export async function assertConversationRun(db: Executor, actor: Actor, conversationId: string, runId: string) {
  const row = await scopedConversation(db, actor, conversationId);
  if (row.activeRunId !== runId || !isBusy(row)) throw new DomainError("CONFLICT", "This reply is no longer active. Reload the conversation.");
}
export async function finishConversationTurn(db: Database, actor: Actor, conversationId: string, runId: string, messages: UIMessage[], outcome: "completed" | "failed" | "aborted", errorMessage?: string) {
  return db.transaction(async (tx) => {
    await assertMembership(tx, actor);
    const [row] = await tx.select().from(conversations).where(scope(actor, conversationId)).for("update");
    if (!row || row.activeRunId !== runId) return; // A newer run cannot be overwritten by a late stream.
    await tx.update(conversationTurns).set({ status: outcome, finishedAt: new Date() }).where(and(eq(conversationTurns.id, runId), eq(conversationTurns.conversationId, conversationId)));
    await tx.update(conversations).set({ messages, activeRunId: null, leaseExpiresAt: null, lastError: outcome === "completed" ? null : errorMessage ?? interrupted, updatedAt: new Date() }).where(scope(actor, conversationId));
  });
}

export async function runToolMutation<T>(db: Database, actor: Actor, call: { conversationId: string; runId: string; toolCallId: string; toolName: string }, action: (tx: Database) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await assertMembership(tx, actor);
    const [row] = await tx.select().from(conversations).where(scope(actor, call.conversationId)).for("update");
    if (!row || row.activeRunId !== call.runId || !isBusy(row)) throw new DomainError("CONFLICT", "This reply is no longer active. Reload the conversation.");
    const [recorded] = await tx.select().from(conversationToolCalls).where(and(eq(conversationToolCalls.conversationId, row.id), eq(conversationToolCalls.toolCallId, call.toolCallId)));
    if (recorded) {
      if (recorded.toolName !== call.toolName) throw new DomainError("CONFLICT", "This action was already handled differently.");
      return recorded.result as T;
    }
    const result = await action(tx);
    await tx.insert(conversationToolCalls).values({ conversationId: row.id, runId: call.runId, toolCallId: call.toolCallId, toolName: call.toolName, result });
    return result;
  });
}
