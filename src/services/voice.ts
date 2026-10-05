import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { isToolUIPart, type LanguageModel } from "ai";
import { z } from "zod";
import type { Database, Executor } from "@/db/connection";
import { sessions, users, voiceSessions, voiceTurns } from "@/db/schema";
import { DomainError } from "@/domain/errors";
import type { ClientPageContext } from "@/domain/assistant";
import { voiceCallbackSchema, voiceHeartbeatSeconds, voiceSessionMinutes, voiceStartSchema, voiceUpdateSchema, type VoiceSessionInfo } from "@/domain/voice";
import { resolveAssistantContext } from "@/ai/context";
import { assistantVoiceResponse } from "@/ai/assistant-runtime";
import { prepareAssistantModel } from "@/ai/models";
import { createVoiceStreamResponse } from "@/ai/voice-stream";
import { createElevenVoiceToken } from "@/voice/elevenlabs";
import { abortConversationTurn, getConversation } from "./conversations";
import { consumeLimit } from "./rate-limit";
import { resolveGatewayCredential } from "./credentials";
import { assertMembership, type Actor } from "./workspaces";

type Session = typeof voiceSessions.$inferSelect;
const endedMessage = "This voice connection has ended. Start voice again, or continue in text.";
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
    if (previous.fingerprint !== row.lastFingerprint || previous.userCount !== row.lastUserCount || previous.status === "aborted") {
      throw new DomainError("CONFLICT", "That voice reply was interrupted or superseded. Check the conversation before continuing.");
    }
    if (previous.responseText !== null && previous.status !== "running") return replayResponse(previous.responseText, previous.id);
    throw new DomainError("CONFLICT", "That voice request was already received. Check the conversation before repeating it.");
  }
  const requestId = randomUUID();
  const context = { ...row.context };
  // The route is already authorized and stored by Sift. Refresh its canonical
  // version per turn; a previous voice edit may precede the browser refresh.
  // Cooking still resolves its immutable version through the retained session ID.
  delete context.activeRecipeVersionId;
  return assistantVoiceResponse(db, actor, { conversationId: row.conversationId!, requestId, context, message: { id: randomUUID(), text: parsed.text } }, {
    ...options,
    beginTurn: (begin) => db.transaction(async (tx) => {
      const [current] = await tx.select().from(voiceSessions).where(eq(voiceSessions.id, row.id)).for("update");
      if (!current) throw new DomainError("UNAUTHENTICATED", endedMessage);
      await assertLive(tx, current);
      if (current.revision !== row.revision) throw new DomainError("CONFLICT", "The page changed while voice was starting a reply. Try again.");
      if (parsed.userMessages.length <= current.lastUserCount || parsed.providerTurn < current.lastProviderTurn
        || (current.lastFingerprint && fingerprint(parsed.userMessages.slice(0, current.lastUserCount)) !== current.lastFingerprint)) {
        throw new DomainError("CONFLICT", "This voice request is out of order. Reconnect voice to continue safely.");
      }
      if (current.activeRunId) await abortConversationTurn(tx, actor, current.conversationId!, current.activeRunId);
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
