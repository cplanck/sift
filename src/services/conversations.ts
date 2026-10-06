import { and, desc, eq, sql } from "drizzle-orm";
import { isToolUIPart, type UIMessage } from "ai";
import { z } from "zod";
import type { Database, Executor } from "@/db/connection";
import { conversations, conversationToolCalls, conversationTurns } from "@/db/schema";
import { assistantRequestSchema, type AssistantRequest } from "@/domain/assistant";
import { assistantModelOptions } from "@/ai/models";
import { DomainError } from "@/domain/errors";
import { assertMembership, type Actor } from "./workspaces";
import { getUsageSummary } from "./ai-usage";
import { assertChatPhoto } from "./photos";

const scope = (actor: Actor, id: string) => and(eq(conversations.id, id), eq(conversations.workspaceId, actor.workspaceId), eq(conversations.createdByUserId, actor.userId));
// Covers the assistant route's 300s maximum; a crashed run frees itself after this.
const runLeaseMs = 300_000;
export const chatPhotoUrl = (photoId: string) => `/api/photos/${photoId}`;
const isBusy = (row: typeof conversations.$inferSelect) => !!row.activeRunId && !!row.leaseExpiresAt && row.leaseExpiresAt.getTime() > Date.now();
const titleSchema = z.object({ title: z.string().trim().min(1).max(120) }).strict();
const modelSchema = z.object({
  modelId: z.enum(assistantModelOptions.map((model) => model.id)).nullable(),
  expectedModelId: z.string().min(1).max(200).nullable(),
}).strict();
const hasPendingApproval = (messages: UIMessage[]) => messages.some((message) => message.parts.some((part) => isToolUIPart(part) && part.state === "approval-requested"));
const interrupted = "The previous reply was interrupted. Some changes may have been saved; review your saved changes before asking again.";

export type StartedConversationTurn = { runId: string; messages: UIMessage[]; modelId: string | null };

async function scopedConversation(db: Executor, actor: Actor, id: string) {
  await assertMembership(db, actor);
  if (!z.uuid().safeParse(id).success) throw new DomainError("NOT_FOUND", "Conversation not found.");
  const [row] = await db.select().from(conversations).where(scope(actor, id));
  if (!row) throw new DomainError("NOT_FOUND", "Conversation not found.");
  return row;
}
export async function listConversations(db: Database, actor: Actor) {
  await assertMembership(db, actor);
  return db.select({ id: conversations.id, title: conversations.title, modelId: conversations.modelId, createdAt: conversations.createdAt, updatedAt: conversations.updatedAt }).from(conversations)
    .where(and(eq(conversations.workspaceId, actor.workspaceId), eq(conversations.createdByUserId, actor.userId))).orderBy(desc(conversations.updatedAt));
}
export async function getConversation(db: Database, actor: Actor, id: string) {
  await assertMembership(db, actor);
  if (!z.uuid().safeParse(id).success) throw new DomainError("NOT_FOUND", "Conversation not found.");
  const latestTurn = db.select({ id: conversationTurns.id, status: conversationTurns.status }).from(conversationTurns)
    .where(eq(conversationTurns.conversationId, conversations.id))
    .orderBy(desc(conversationTurns.createdAt), desc(conversationTurns.id)).limit(1).as("last_turn");
  // Read the error, active lease and latest turn in one database snapshot. A
  // concurrent barge-in must not combine an old error with a newer turn status.
  const [saved] = await db.select({ row: conversations, lastTurn: { id: latestTurn.id, status: latestTurn.status } }).from(conversations)
    .leftJoinLateral(latestTurn, sql`true`).where(scope(actor, id));
  if (!saved) throw new DomainError("NOT_FOUND", "Conversation not found.");
  const { row, lastTurn } = saved;
  const busy = isBusy(row);
  // The mutation journal survives even a process crash between a tool commit and
  // stream persistence, so a reload can show what actually changed.
  const receipts = await db.select({ toolName: conversationToolCalls.toolName, result: conversationToolCalls.result, createdAt: conversationToolCalls.createdAt }).from(conversationToolCalls)
    .where(eq(conversationToolCalls.conversationId, row.id)).orderBy(desc(conversationToolCalls.createdAt)).limit(20);
  const usage = await getUsageSummary(db, actor, row.id);
  return { id: row.id, title: row.title, modelId: row.modelId, messages: row.messages, lastError: row.activeRunId && !busy ? interrupted : row.lastError, lastTurn, busy, receipts, usage, createdAt: row.createdAt, updatedAt: row.updatedAt };
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
export async function setConversationModel(db: Database, actor: Actor, id: string, input: unknown) {
  const data = modelSchema.parse(input);
  return db.transaction(async (tx) => {
    await scopedConversation(tx, actor, id);
    const [row] = await tx.select().from(conversations).where(scope(actor, id)).for("update");
    if (!row) throw new DomainError("NOT_FOUND", "Conversation not found.");
    if (isBusy(row)) throw new DomainError("CONFLICT", "Wait for the current reply before changing models.");
    if (hasPendingApproval(row.messages)) throw new DomainError("CONFLICT", "Approve or decline the pending action before changing models.");
    if (row.modelId !== data.expectedModelId) throw new DomainError("CONFLICT", "The model changed in another window. Reload the conversation before choosing again.");
    // Invalidate an expired run so its late stream cannot save a pending
    // approval after the user has switched to a different model.
    if (row.activeRunId) await tx.update(conversationTurns).set({ status: "failed", finishedAt: new Date() }).where(and(eq(conversationTurns.id, row.activeRunId), eq(conversationTurns.conversationId, row.id)));
    await tx.update(conversations).set({
      modelId: data.modelId, updatedAt: new Date(),
      ...(row.activeRunId ? { activeRunId: null, leaseExpiresAt: null, lastError: interrupted } : {}),
    }).where(scope(actor, id));
    return getConversation(tx, actor, id);
  });
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

export async function beginConversationTurn(db: Database, actor: Actor, input: AssistantRequest): Promise<StartedConversationTurn> {
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
      const photoParts = [];
      for (const photoId of new Set(data.message.photoIds)) {
        await assertChatPhoto(tx, actor, photoId);
        photoParts.push({ type: "file" as const, mediaType: "image/webp", url: chatPhotoUrl(photoId) });
      }
      messages.push({ id: data.message.id, role: "user", parts: [...photoParts, ...(data.message.text ? [{ type: "text" as const, text: data.message.text }] : [])] });
    } else {
      let found = false;
      messages = messages.map((message) => ({ ...message, parts: message.parts.map((part) => {
        if (!isToolUIPart(part) || part.state !== "approval-requested" || part.approval.id !== data.approval.id) return part;
        found = true;
        return { ...part, state: "approval-responded" as const, approval: { ...part.approval, approved: data.approval.approved } };
      }) }));
      if (!found) throw new DomainError("INVALID_INPUT", "This action is no longer awaiting approval. Reload the conversation.");
    }
    // Transaction start time can precede a newer turn that acquired this lock
    // first. Record reservation order after the lock, not PostgreSQL now().
    const [turn] = await tx.insert(conversationTurns).values({ conversationId: row.id, requestId: data.requestId, status: "running", createdAt: sql`clock_timestamp()` }).returning({ id: conversationTurns.id });
    await tx.update(conversations).set({ messages, activeRunId: turn.id, leaseExpiresAt: new Date(Date.now() + runLeaseMs), lastError: null, updatedAt: new Date(), ...(row.title === "New conversation" && "message" in data ? { title: (data.message.text || "Photo").slice(0, 80) } : {}) }).where(scope(actor, row.id));
    return { runId: turn.id, messages, modelId: row.modelId };
  });
}

export async function assertConversationRun(db: Executor, actor: Actor, conversationId: string, runId: string) {
  const row = await scopedConversation(db, actor, conversationId);
  if (row.activeRunId !== runId || !isBusy(row)) throw new DomainError("CONFLICT", "This reply is no longer active. Reload the conversation.");
}

// Trusted transport notices explain already-saved work without running a model
// or resolving any pending native approval. They share the canonical transcript.
export async function recordConversationNotice(db: Database, actor: Actor, input: AssistantRequest, reply: string) {
  const data = assistantRequestSchema.parse(input);
  if (!("message" in data)) throw new DomainError("INVALID_INPUT", "A notice requires its user message.");
  const text = z.string().trim().min(1).max(2000).parse(reply);
  return db.transaction(async (tx) => {
    await scopedConversation(tx, actor, data.conversationId);
    const [row] = await tx.select().from(conversations).where(scope(actor, data.conversationId)).for("update");
    if (!row) throw new DomainError("NOT_FOUND", "Conversation not found.");
    if (row.activeRunId) throw new DomainError("CONFLICT", "Wait for the current reply before continuing.");
    if (row.messages.length >= 200) throw new DomainError("INVALID_INPUT", "This conversation is full. Start a new conversation; your history will remain available.");
    const [previous] = await tx.select({ id: conversationTurns.id }).from(conversationTurns)
      .where(and(eq(conversationTurns.conversationId, row.id), eq(conversationTurns.requestId, data.requestId)));
    if (previous || row.messages.some((message) => message.id === data.message.id)) throw new DomainError("CONFLICT", "This request was already received.");
    const [turn] = await tx.insert(conversationTurns).values({ conversationId: row.id, requestId: data.requestId, status: "completed", createdAt: sql`clock_timestamp()`, finishedAt: new Date() }).returning({ id: conversationTurns.id });
    const notice: UIMessage[] = [
      { id: data.message.id, role: "user", parts: [{ type: "text", text: data.message.text }] },
      { id: crypto.randomUUID(), role: "assistant", parts: [{ type: "text", text }] },
    ];
    // The SDK resumes native approval from the final assistant/tool message.
    // Keep that proposal intact and last, with the clarification/notice before
    // it; appending a new user message after it would invalidate native resume.
    const approvalIndex = row.messages.findLastIndex((message) => message.parts.some((part) => isToolUIPart(part) && part.state === "approval-requested"));
    const insertion = approvalIndex < 0 ? row.messages.length : approvalIndex;
    const messages = [...row.messages.slice(0, insertion), ...notice, ...row.messages.slice(insertion)];
    await tx.update(conversations).set({ messages, lastError: null, updatedAt: new Date() }).where(scope(actor, row.id));
    return { runId: turn.id };
  });
}

// A voice disconnect/new utterance may cancel only the run its durable voice
// turn owns. The row lock shares the mutation journal's boundary: a mutation
// either committed before cancellation, or sees the fence and cannot execute.
export async function abortConversationTurn(db: Database, actor: Actor, conversationId: string, expectedRunId: string): Promise<boolean> {
  z.uuid().parse(expectedRunId);
  return db.transaction(async (tx) => {
    await scopedConversation(tx, actor, conversationId);
    const [row] = await tx.select().from(conversations).where(scope(actor, conversationId)).for("update");
    if (!row || row.activeRunId !== expectedRunId) return false;
    await tx.update(conversationTurns).set({ status: "aborted", finishedAt: new Date() }).where(and(eq(conversationTurns.id, expectedRunId), eq(conversationTurns.conversationId, conversationId)));
    await tx.update(conversations).set({ activeRunId: null, leaseExpiresAt: null, lastError: interrupted, updatedAt: new Date() }).where(scope(actor, conversationId));
    return true;
  });
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
