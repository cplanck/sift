import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { and, desc, eq, inArray } from "drizzle-orm";
import { isToolUIPart, type LanguageModel } from "ai";
import { z } from "zod";
import type { Database, Executor } from "@/db/connection";
import { conversations, conversationToolCalls, conversationTurns, sessions, users, voiceSessions, voiceTurns } from "@/db/schema";
import { DomainError } from "@/domain/errors";
import type { ClientPageContext } from "@/domain/assistant";
import { voiceCallbackSchema, voiceHeartbeatSeconds, voiceSessionMinutes, voiceStartSchema, voiceUpdateSchema, type VoiceSessionInfo } from "@/domain/voice";
import { resolveAssistantContext } from "@/ai/context";
import { assistantVoiceResponse } from "@/ai/assistant-runtime";
import { prepareAssistantModel } from "@/ai/models";
import { createVoiceStreamResponse } from "@/ai/voice-stream";
import { createElevenVoiceToken } from "@/voice/elevenlabs";
import { abortConversationTurn, getConversation, recordConversationNotice } from "./conversations";
import { assertLimitAvailable, consumeLimit } from "./rate-limit";
import { resolveGatewayCredential } from "./credentials";
import { assertMembership, type Actor } from "./workspaces";

type Session = typeof voiceSessions.$inferSelect;
const endedMessage = "This voice connection has ended. Start voice again, or continue in text.";
const revisedSavedMessage = "I heard your clarification. Part of that request is already saved, so I haven’t repeated or undone it. Review the saved changes in Sift before asking for any further changes.";
const revisedApprovalMessage = "I heard your clarification. The earlier action still needs your review. Approve or decline its confirmation in Sift before continuing; I haven’t changed that action.";
const revisedReviewedMessage = "I heard your clarification. That request already has a reviewed action, so I haven’t repeated it. Review the conversation in Sift before asking for any further changes.";
const actorFor = (row: Session): Actor => ({ userId: row.userId, workspaceId: row.workspaceId });
const scope = (actor: Actor, id: string) => and(eq(voiceSessions.id, id), eq(voiceSessions.userId, actor.userId), eq(voiceSessions.workspaceId, actor.workspaceId));
const snapshot = (row: Session): VoiceSessionInfo => ({ id: row.id, conversationId: row.conversationId, providerConversationId: row.providerConversationId, status: row.status, revision: row.revision, expiresAt: row.expiresAt.toISOString() });

function contextTarget(context: ClientPageContext) {
  const route = context.route.split(/[?#]/, 1)[0];
  const query = new URLSearchParams(context.route.split("?", 2)[1]?.split("#", 1)[0]);
  // A current-version refresh on the same page may be the active tool's own
  // edit. It is not navigation; versioned writes already enforce their CAS.
  return JSON.stringify([route, context.activeCookingSessionId ?? query.get("cook") ?? null]);
}

async function assertAuthSession(db: Executor, actor: Actor, authSessionId: string | null) {
  await assertMembership(db, actor);
  if (!authSessionId) throw new DomainError("UNAUTHENTICATED", endedMessage);
  const [session] = await db.select().from(sessions).where(and(eq(sessions.id, authSessionId), eq(sessions.userId, actor.userId)));
  if (!session || session.expiresAt <= new Date()) throw new DomainError("UNAUTHENTICATED", endedMessage);
  return session;
}
async function assertLive(db: Executor, row: Session, allowPreparing = false) {
  if ((!allowPreparing && row.status !== "ready") || (allowPreparing && !["ready", "preparing"].includes(row.status))
    || !row.conversationId || row.expiresAt <= new Date() || row.leaseExpiresAt <= new Date()) throw new DomainError("UNAUTHENTICATED", endedMessage);
  await assertAuthSession(db, actorFor(row), row.authSessionId);
}
async function endLocked(db: Database, row: Session, status: "ended" | "failed" = "ended") {
  if (row.activeRunId && row.conversationId) await abortConversationTurn(db, actorFor(row), row.conversationId, row.activeRunId);
  await db.update(voiceTurns).set({ status: "aborted", finishedAt: new Date() }).where(and(eq(voiceTurns.voiceSessionId, row.id), eq(voiceTurns.status, "running")));
  const [saved] = await db.update(voiceSessions).set({ status, endedAt: row.endedAt ?? new Date(), activeRunId: null, updatedAt: new Date() }).where(eq(voiceSessions.id, row.id)).returning();
  return snapshot(saved);
}

export async function startVoiceSession(db: Database, actor: Actor, authSessionId: string, input: unknown, options: {
  /** Test-only provider boundary dependency; never accepted in HTTP input. */
  issueToken?: typeof createElevenVoiceToken;
} = {}) {
  const data = voiceStartSchema.parse(input);
  const session = await assertAuthSession(db, actor, authSessionId);
  await resolveAssistantContext(db, actor, data.context);
  const conversation = await getConversation(db, actor, data.conversationId);
  if (conversation.busy) throw new DomainError("CONFLICT", "Wait for Sift’s current reply before starting voice.");
  if (conversation.messages.some((message) => message.parts.some((part) => isToolUIPart(part) && part.state === "approval-requested"))) throw new DomainError("CONFLICT", "Approve or decline the pending action before starting voice.");
  // Speech must not start a billable provider session if the shared assistant
  // cannot answer. This resolves configuration only; it makes no model call.
  prepareAssistantModel(await resolveGatewayCredential(db, actor.userId));
  await assertLimitAvailable(db, actor, "assistant", 60);
  await consumeLimit(db, actor, "voice", 20);
  const expiresAt = new Date(Math.min(session.expiresAt.getTime(), Date.now() + voiceSessionMinutes * 60_000));
  const row = await db.transaction(async (tx) => {
    // Serialize starts for this user, including starts in different tabs/conversations.
    await tx.select({ id: users.id }).from(users).where(eq(users.id, actor.userId)).for("update");
    const previous = await tx.select().from(voiceSessions).where(and(eq(voiceSessions.userId, actor.userId), inArray(voiceSessions.status, ["preparing", "ready"]))).for("update");
    for (const old of previous) await endLocked(tx, old);
    const [created] = await tx.insert(voiceSessions).values({ workspaceId: actor.workspaceId, userId: actor.userId, authSessionId,
      conversationId: data.conversationId, context: data.context, expiresAt, leaseExpiresAt: new Date(Date.now() + voiceHeartbeatSeconds * 1000) }).returning();
    return created;
  });
  try {
    const token = await (options.issueToken ?? createElevenVoiceToken)();
    return await db.transaction(async (tx) => {
      const [current] = await tx.select().from(voiceSessions).where(scope(actor, row.id)).for("update");
      if (!current) throw new DomainError("UNAUTHENTICATED", endedMessage);
      await assertLive(tx, current, true);
      if (current.status !== "preparing") throw new DomainError("CONFLICT", endedMessage);
      const [saved] = await tx.update(voiceSessions).set({ providerConversationId: token.providerConversationId, agentId: token.agentId, status: "ready", updatedAt: new Date() }).where(eq(voiceSessions.id, row.id)).returning();
      // Provider credentials are never persisted. Only this short-lived connection token leaves the server.
      return { ...snapshot(saved), conversationToken: token.conversationToken };
    });
  } catch (error) {
    await db.update(voiceSessions).set({ status: "failed", endedAt: new Date(), updatedAt: new Date() }).where(and(eq(voiceSessions.id, row.id), eq(voiceSessions.status, "preparing")));
    throw error;
  }
}

export async function updateVoiceSession(db: Database, actor: Actor, id: string, input: unknown) {
  z.uuid().parse(id);
  const data = voiceUpdateSchema.parse(input);
  // A heartbeat can arrive before the page reloads an edit made by voice.
  // Resolve the current server version just as the next callback will; cooking
  // remains pinned through its authorized cooking-session ID.
  const context = { ...data.context };
  delete context.activeRecipeVersionId;
  await resolveAssistantContext(db, actor, context);
  return db.transaction(async (tx) => {
    const [row] = await tx.select().from(voiceSessions).where(scope(actor, id)).for("update");
    if (!row) throw new DomainError("NOT_FOUND", "Voice connection not found.");
    await assertLive(tx, row);
    if (row.revision !== data.expectedRevision) throw new DomainError("CONFLICT", "The voice context changed. Reconnect voice before continuing.");
    const targetChanged = contextTarget(row.context) !== contextTarget(data.context);
    if (targetChanged && row.activeRunId) {
      await abortConversationTurn(tx, actor, row.conversationId!, row.activeRunId);
      await tx.update(voiceTurns).set({ status: "aborted", finishedAt: new Date() }).where(and(eq(voiceTurns.voiceSessionId, row.id), eq(voiceTurns.runId, row.activeRunId), eq(voiceTurns.status, "running")));
    }
    const [saved] = await tx.update(voiceSessions).set({ context: data.context, revision: row.revision + 1,
      ...(targetChanged ? { activeRunId: null } : {}),
      leaseExpiresAt: new Date(Math.min(row.expiresAt.getTime(), Date.now() + voiceHeartbeatSeconds * 1000)), updatedAt: new Date() }).where(eq(voiceSessions.id, id)).returning();
    return snapshot(saved);
  });
}
export async function endVoiceSession(db: Database, actor: Actor, id: string) {
  z.uuid().parse(id);
  await assertMembership(db, actor);
  return db.transaction(async (tx) => {
    const [row] = await tx.select().from(voiceSessions).where(scope(actor, id)).for("update");
    if (!row) throw new DomainError("NOT_FOUND", "Voice connection not found.");
    return endLocked(tx, row);
  });
}

const fingerprint = (messages: string[]) => createHash("sha256").update(JSON.stringify(messages)).digest("hex");
export function parseVoiceTurn(input: unknown, ordinal: string | null) {
  if (!ordinal || !/^\d{1,6}$/.test(ordinal)) throw new DomainError("INVALID_INPUT", "The voice turn identifier is missing.");
  const data = voiceCallbackSchema.parse(input);
  const userMessages = data.messages.filter((message) => message.role === "user").map((message) => typeof message.content === "string" ? message.content.trim()
    : Array.isArray(message.content) ? message.content.map((part) => part.text).join("\n").trim() : "");
  if (!userMessages.length || userMessages.some((text) => !text || text.length > 8000)) throw new DomainError("INVALID_INPUT", "Say something to begin the voice conversation.");
  return { userMessages, text: userMessages.at(-1)!, fingerprint: fingerprint(userMessages), providerTurn: Number(ordinal) };
}
function replayResponse(text: string, responseId: string) {
  return createVoiceStreamResponse({ responseId, getOutcome: () => "completed", stream: new ReadableStream({ start(controller) {
    controller.enqueue({ type: "text-delta", id: responseId, delta: text }); controller.close();
  } }) });
}

export async function respondToVoice(db: Database, providerConversationId: string, ordinal: string | null, input: unknown, options: {
  model?: LanguageModel; abortSignal?: AbortSignal; waitUntil?: (task: Promise<void>) => void;
} = {}) {
  if (!/^[a-zA-Z0-9_-]{1,200}$/.test(providerConversationId)) throw new DomainError("UNAUTHENTICATED", endedMessage);
  const parsed = parseVoiceTurn(input, ordinal);
  const [row] = await db.select().from(voiceSessions).where(eq(voiceSessions.providerConversationId, providerConversationId));
  if (!row) throw new DomainError("UNAUTHENTICATED", endedMessage);
  await assertLive(db, row);
  const actor = actorFor(row);
  const [previous] = await db.select().from(voiceTurns).where(and(eq(voiceTurns.voiceSessionId, row.id), eq(voiceTurns.fingerprint, parsed.fingerprint)));
  if (previous) {
    return db.transaction(async (tx) => {
      const [current] = await tx.select().from(voiceSessions).where(eq(voiceSessions.id, row.id)).for("update");
      if (!current) throw new DomainError("UNAUTHENTICATED", endedMessage);
      await assertLive(tx, current);
      const [saved] = await tx.select().from(voiceTurns).where(eq(voiceTurns.id, previous.id));
      if (!saved || saved.fingerprint !== current.lastFingerprint || saved.userCount !== current.lastUserCount || saved.status === "aborted") {
        throw new DomainError("CONFLICT", "That voice reply was interrupted or superseded. Check the conversation before continuing.");
      }
      if (saved.responseText !== null && saved.status !== "running") return replayResponse(saved.responseText, saved.id);
      throw new DomainError("CONFLICT", "That voice request was already received. Check the conversation before repeating it.");
    });
  }
  const requestId = randomUUID();
  const context = { ...row.context };
  // The route is already authorized and stored by Sift. Refresh its canonical
  // version per turn; a previous voice edit may precede the browser refresh.
  // Cooking still resolves its immutable version through the retained session ID.
  delete context.activeRecipeVersionId;
  // This server ID also links the accepted transcription to its voice turn.
  const request = { conversationId: row.conversationId!, requestId, context, message: { id: requestId, text: parsed.text } };
  return assistantVoiceResponse(db, actor, request, {
    ...options,
    beginTurn: (begin) => db.transaction(async (tx) => {
      const [current] = await tx.select().from(voiceSessions).where(eq(voiceSessions.id, row.id)).for("update");
      if (!current) throw new DomainError("UNAUTHENTICATED", endedMessage);
      await assertLive(tx, current);
      if (current.revision !== row.revision) throw new DomainError("CONFLICT", "The page changed while voice was starting a reply. Try again.");
      // Recheck under the reservation lock: simultaneous retries may both have
      // missed the initial lookup, but only one can create a model run.
      const [duplicate] = await tx.select().from(voiceTurns).where(and(eq(voiceTurns.voiceSessionId, current.id), eq(voiceTurns.fingerprint, parsed.fingerprint)));
      if (duplicate) {
        if (duplicate.fingerprint === current.lastFingerprint && duplicate.status !== "running" && duplicate.status !== "aborted" && duplicate.responseText !== null) return replayResponse(duplicate.responseText, duplicate.id);
        throw new DomainError("CONFLICT", "That voice request was already received. Check the conversation before repeating it.");
      }
      const revising = parsed.userMessages.length === current.lastUserCount && !!current.lastFingerprint;
      if (parsed.userMessages.length < current.lastUserCount || parsed.providerTurn < current.lastProviderTurn
        || (!revising && current.lastFingerprint && fingerprint(parsed.userMessages.slice(0, current.lastUserCount)) !== current.lastFingerprint)) {
        throw new DomainError("CONFLICT", "This voice request is out of order. Reconnect voice to continue safely.");
      }
      if (revising) {
        const [previous] = await tx.select().from(voiceTurns).where(and(eq(voiceTurns.voiceSessionId, current.id), eq(voiceTurns.fingerprint, current.lastFingerprint!)));
        const [conversation] = await tx.select().from(conversations).where(and(eq(conversations.id, current.conversationId!), eq(conversations.createdByUserId, actor.userId), eq(conversations.workspaceId, actor.workspaceId))).for("update");
        const [latest] = await tx.select({ id: conversationTurns.id }).from(conversationTurns).where(eq(conversationTurns.conversationId, current.conversationId!))
          .orderBy(desc(conversationTurns.createdAt), desc(conversationTurns.id)).limit(1);
        const previousUser = conversation?.messages.findLast((message) => message.role === "user");
        // Older sessions used a separate user-message ID. Their last saved user
        // text is usable only while its exact mapped voice run remains latest.
        const previousText = previousUser?.parts.filter((part) => part.type === "text").map((part) => part.text).join("\n");
        if (!previous?.runId || !conversation || !previousUser || !previousText || latest?.id !== previous.runId
          || fingerprint([...parsed.userMessages.slice(0, -1), previousText]) !== current.lastFingerprint
          || (conversation.activeRunId && conversation.activeRunId !== current.activeRunId)) {
          throw new DomainError("CONFLICT", "This voice request is out of order. Reconnect voice to continue safely.");
        }
        if (current.activeRunId) await abortConversationTurn(tx, actor, current.conversationId!, current.activeRunId);
        // The conversation lock is also the tool journal's commit boundary.
        // Check the entire revision chain, not just the most recent attempt.
        const [committed] = await tx.select({ id: conversationToolCalls.id }).from(conversationToolCalls)
          .innerJoin(voiceTurns, eq(voiceTurns.runId, conversationToolCalls.runId))
          .where(and(eq(voiceTurns.voiceSessionId, current.id), eq(voiceTurns.userCount, current.lastUserCount))).limit(1);
        const pendingApproval = conversation.messages.some((message) => message.parts.some((part) => isToolUIPart(part) && part.state === "approval-requested"));
        const priorUserIndex = conversation.messages.findIndex((message) => message.id === previousUser.id);
        const protectedApproval = conversation.messages.slice(priorUserIndex).some((message) => message.parts.some((part) => isToolUIPart(part) && "approval" in part && !!part.approval));
        await tx.update(voiceTurns).set({ status: "aborted", finishedAt: new Date() }).where(and(eq(voiceTurns.voiceSessionId, current.id), eq(voiceTurns.status, "running")));
        if (committed || pendingApproval || protectedApproval) {
          const text = pendingApproval ? revisedApprovalMessage : protectedApproval ? revisedReviewedMessage : revisedSavedMessage;
          const notice = await recordConversationNotice(tx, actor, request, text);
          await tx.insert(voiceTurns).values({ id: requestId, voiceSessionId: current.id, fingerprint: parsed.fingerprint, providerTurn: parsed.providerTurn,
            userCount: parsed.userMessages.length, runId: notice.runId, status: "completed", responseText: text, requiresApproval: pendingApproval, finishedAt: new Date() });
          await tx.update(voiceSessions).set({ activeRunId: null, lastUserCount: parsed.userMessages.length, lastProviderTurn: parsed.providerTurn, lastFingerprint: parsed.fingerprint, updatedAt: new Date() }).where(eq(voiceSessions.id, current.id));
          return replayResponse(text, requestId);
        }
        // Replace only the superseded transcription. Keep partial assistant and
        // read-only tool history; ordinary begin appends the full revised input.
        await tx.update(conversations).set({ messages: conversation.messages.filter((message) => message.id !== previousUser.id), updatedAt: new Date() }).where(eq(conversations.id, conversation.id));
      }
      if (!revising && current.activeRunId) await abortConversationTurn(tx, actor, current.conversationId!, current.activeRunId);
      await tx.update(voiceTurns).set({ status: "aborted", finishedAt: new Date() }).where(and(eq(voiceTurns.voiceSessionId, row.id), eq(voiceTurns.status, "running")));
      await tx.insert(voiceTurns).values({ id: requestId, voiceSessionId: row.id, fingerprint: parsed.fingerprint, providerTurn: parsed.providerTurn, userCount: parsed.userMessages.length, status: "running" });
      const run = await begin(tx);
      await tx.update(voiceTurns).set({ runId: run.runId }).where(eq(voiceTurns.id, requestId));
      await tx.update(voiceSessions).set({ activeRunId: run.runId, lastUserCount: parsed.userMessages.length, lastProviderTurn: parsed.providerTurn, lastFingerprint: parsed.fingerprint, updatedAt: new Date() }).where(eq(voiceSessions.id, row.id));
      return run;
    }),
    assertActive: async (runId) => {
      const [current] = await db.select().from(voiceSessions).where(eq(voiceSessions.id, row.id));
      if (!current) throw new DomainError("UNAUTHENTICATED", endedMessage);
      await assertLive(db, current);
      if (current.activeRunId !== runId) throw new DomainError("CONFLICT", "This voice reply was interrupted.");
    },
    onVoiceEnd: async ({ runId, text, outcome, requiresApproval }) => {
      await db.transaction(async (tx) => {
        const [current] = await tx.select().from(voiceSessions).where(eq(voiceSessions.id, row.id)).for("update");
        if (!current) return;
        const stillActive = current.activeRunId === runId;
        await tx.update(voiceTurns).set({ responseText: text.slice(0, 64000), status: stillActive ? outcome : "aborted", requiresApproval, finishedAt: new Date() }).where(eq(voiceTurns.id, requestId));
        if (stillActive) await tx.update(voiceSessions).set({ activeRunId: null, updatedAt: new Date() }).where(eq(voiceSessions.id, row.id));
      });
    },
  }).catch(async (error: unknown) => {
    if (!(error instanceof DomainError) || error.code !== "RATE_LIMITED") throw error;
    // Admission rolled back without changing the transcript or interrupting an
    // existing run. Explain the safe, actionable limit through speech/captions
    // instead of making ElevenLabs retry a 429 and disconnect the microphone.
    // No model call or new durable assistant turn is created for this notice.
    const [current] = await db.select().from(voiceSessions).where(eq(voiceSessions.id, row.id));
    if (!current) throw new DomainError("UNAUTHENTICATED", endedMessage);
    await assertLive(db, current);
    return replayResponse(error.message, requestId);
  });
}

export async function recordVoiceUsage(db: Database, usage: {
  providerConversationId: string; agentId: string; status: string; durationSeconds: number | null; costUsd: string | null; credits: number | null;
}) {
  z.object({ providerConversationId: z.string().max(200), agentId: z.string().max(200), status: z.enum(["initiated", "in-progress", "processing", "done", "failed"]),
    durationSeconds: z.number().int().min(0).max(86400).nullable(), credits: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).nullable(),
    costUsd: z.string().regex(/^\d{1,10}(?:\.\d{1,10})?$/).nullable() }).parse(usage);
  await db.transaction(async (tx) => {
    const [row] = await tx.select().from(voiceSessions).where(eq(voiceSessions.providerConversationId, usage.providerConversationId)).for("update");
    if (!row) return; // The workspace webhook may report an unrelated ElevenLabs agent.
    if (row.agentId !== usage.agentId) throw new DomainError("INVALID_INPUT", "The voice usage identity does not match.");
    // Delayed provisional events cannot erase a final bill or known charges.
    if (["done", "failed"].includes(row.usageStatus ?? "") && !["done", "failed"].includes(usage.status)) return;
    await tx.update(voiceSessions).set({ durationSeconds: usage.durationSeconds ?? row.durationSeconds, costUsd: usage.costUsd ?? row.costUsd,
      credits: usage.credits ?? row.credits, usageStatus: usage.status, updatedAt: new Date() }).where(eq(voiceSessions.id, row.id));
  });
}
