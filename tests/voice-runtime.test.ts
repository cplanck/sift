import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { APICallError, isToolUIPart, simulateReadableStream } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { connectDatabase } from "@/db/connection";
import { conversationTurns, recipes, usageLimits, users } from "@/db/schema";
import { DomainError } from "@/domain/errors";
import { assistantResponse, assistantVoiceResponse, type AssistantVoiceOptions } from "@/ai/assistant-runtime";
import { createVoiceStreamResponse, type VoiceStreamResult } from "@/ai/voice-stream";
import { abortConversationTurn, beginConversationTurn, createConversation, finishConversationTurn, getConversation, runToolMutation } from "@/services/conversations";
import { addRecipeNote, createRecipe, getRecipe, listRecipeNotes, listVersions } from "@/services/recipes";
import { ensurePersonalWorkspace, type Actor } from "@/services/workspaces";
import { testDatabaseUrl } from "./database";

type ModelStream = Awaited<ReturnType<MockLanguageModelV4["doStream"]>>;
type ModelChunk = ModelStream["stream"] extends ReadableStream<infer Chunk> ? Chunk : never;
type VoiceEnd = Parameters<NonNullable<AssistantVoiceOptions["onVoiceEnd"]>>[0];
const usage = { inputTokens: { total: 12, noCache: 12, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 5, text: 5, reasoning: 0 } };
const finish = (reason: "stop" | "tool-calls"): ModelChunk => ({ type: "finish", finishReason: { unified: reason, raw: undefined }, usage });
const toolCall = (toolName: string, input: object, toolCallId = randomUUID()): ModelChunk[] => [{ type: "stream-start", warnings: [] }, { type: "tool-call", toolName, toolCallId, input: JSON.stringify(input) }, finish("tool-calls")];
const textReply = (text: string): ModelChunk[] => [{ type: "stream-start", warnings: [] }, { type: "text-start", id: "text" }, { type: "text-delta", id: "text", delta: text }, { type: "text-end", id: "text" }, finish("stop")];
const modelWith = (...steps: ModelChunk[][]) => new MockLanguageModelV4({ doStream: steps.map((chunks) => ({ stream: simulateReadableStream({ chunks, initialDelayInMs: null, chunkDelayInMs: null }) })) });
const { db, pool } = connectDatabase(testDatabaseUrl);
const userIds = [randomUUID(), randomUUID()];
let actorA: Actor, actorB: Actor;
const content = { title: "Voice test stew", servings: 4, ingredientSections: [{ name: "Stew", items: [{ text: "2 cups broth" }] }], instructionSections: [{ name: "", steps: ["Simmer gently."] }] };
async function assistantQuota(actor: Actor, count?: number) {
  const window = Math.floor(Date.now() / 3600_000), key = `${actor.userId}:assistant:${window}`;
  if (count !== undefined) await db.insert(usageLimits).values({ key, userId: actor.userId, count, expiresAt: new Date((window + 1) * 3600_000) })
    .onConflictDoUpdate({ target: usageLimits.key, set: { count } });
  const [limit] = await db.select().from(usageLimits).where(eq(usageLimits.key, key));
  return limit?.count ?? 0;
}
function message(conversationId: string, text: string, recipe?: { id: string; version: { id: string } }) {
  return { conversationId, requestId: randomUUID(), context: recipe ? { route: `/recipes/${recipe.id}`, activeRecipeId: recipe.id, activeRecipeVersionId: recipe.version.id } : { route: "/library" }, message: { id: randomUUID(), text } };
}
function spoken(raw: string) {
  return raw.split("\n").filter((line) => line.startsWith("data: ") && line !== "data: [DONE]").map((line) => JSON.parse(line.slice(6))).flatMap((chunk) => chunk.choices.map((choice: { delta: { content?: string } }) => choice.delta.content ?? "")).join("");
}
beforeAll(async () => {
  await db.insert(users).values(userIds.map((id) => ({ id, email: `${id}@example.test`, name: "Voice runtime test cook" })));
  [actorA, actorB] = await Promise.all(userIds.map(async (userId) => ({ userId, workspaceId: await ensurePersonalWorkspace(db, userId) })));
});
beforeEach(async () => { await db.delete(usageLimits).where(inArray(usageLimits.userId, userIds)); });
afterAll(async () => {
  await db.update(recipes).set({ currentVersionId: null }).where(inArray(recipes.workspaceId, [actorA.workspaceId, actorB.workspaceId]));
  await db.delete(users).where(inArray(users.id, userIds));
  await pool.end();
});

describe("Voice transport over the shared native assistant runtime", () => {
  it("charges accepted text turns without charging duplicate requests or busy-conversation conflicts", async () => {
    const conversation = await createConversation(db, actorA), input = message(conversation.id, "An accepted text request.");
    await (await assistantResponse(db, actorA, input, { model: modelWith(textReply("The accepted answer.")) })).text();
    expect(await assistantQuota(actorA)).toBe(1);
    await assistantQuota(actorA, 59);
    const unused = modelWith(textReply("Must not run"));
    const before = await getConversation(db, actorA, conversation.id);
    for (let retry = 0; retry < 3; retry++) await expect(assistantResponse(db, actorA, input, { model: unused })).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await getConversation(db, actorA, conversation.id)).toEqual(before);
    const busy = await beginConversationTurn(db, actorA, message(conversation.id, "Another already reserved request."));
    const whileBusy = await getConversation(db, actorA, conversation.id);
    await expect(assistantResponse(db, actorA, message(conversation.id, "Must not append while busy."), { model: unused })).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await getConversation(db, actorA, conversation.id)).toEqual(whileBusy);
    expect(await assistantQuota(actorA)).toBe(59);
    expect(unused.doStreamCalls).toHaveLength(0);
    await finishConversationTurn(db, actorA, conversation.id, busy.runId, busy.messages, "completed");
    await (await assistantResponse(db, actorA, message(conversation.id, "The last available request."), { model: modelWith(textReply("The allowance remained available.")) })).text();
    expect(await assistantQuota(actorA)).toBe(60);
    expect(await getConversation(db, actorA, conversation.id)).toMatchObject({ busy: false, usage: { calls: 2 } });
  });

  it("rolls back text turn admission when the shared allowance is exhausted", async () => {
    const conversation = await createConversation(db, actorA), input = message(conversation.id, "Must not persist over quota.");
    await assistantQuota(actorA, 60);
    const before = await getConversation(db, actorA, conversation.id), model = modelWith(textReply("Must not run"));
    for (let retry = 0; retry < 2; retry++) await expect(assistantResponse(db, actorA, input, { model })).rejects.toMatchObject({ code: "RATE_LIMITED" });
    expect(await assistantQuota(actorA)).toBe(60);
    expect(await db.select().from(conversationTurns).where(eq(conversationTurns.conversationId, conversation.id))).toHaveLength(0);
    expect(await getConversation(db, actorA, conversation.id)).toEqual(before);
    expect(model.doStreamCalls).toHaveLength(0);
  });

  it("settles a reserved voice turn if native stream initialization fails", async () => {
    const conversation = await createConversation(db, actorA), input = message(conversation.id, "Initialize voice.");
    const model = modelWith(textReply("Must not run")), completed: VoiceEnd[] = [];
    await expect(assistantVoiceResponse(db, actorA, input, { model,
      // Exercise the real SDK's startup validation of an incompatible saved
      // tool payload, before any model stream exists to call its onEnd.
      beginTurn: async (begin) => {
        const run = await begin(db);
        return { ...run, messages: [...run.messages, { id: randomUUID(), role: "assistant", parts: [{ type: "tool-getRecipe", toolCallId: randomUUID(), state: "output-available", input: { recipeId: "private-invalid-history-value" }, output: { ok: true } }] }] };
      },
      onVoiceEnd: async (result) => { completed.push(result); },
    })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(completed).toEqual([expect.objectContaining({ requestId: input.requestId, outcome: "failed", requiresApproval: false })]);
    expect(completed[0].text).not.toContain("private-invalid-history-value");
    expect((await getConversation(db, actorA, conversation.id)).busy).toBe(false);
    expect(model.doStreamCalls).toHaveLength(0);
  });

  it("closes a failed source stream with safe speech and exactly one terminal callback", async () => {
    const completed: VoiceStreamResult[] = [], durable: Promise<void>[] = [];
    const response = createVoiceStreamResponse({ responseId: "source-failure-test", getOutcome: () => "failed",
      stream: new ReadableStream({ pull(controller) { controller.error(new Error("private-source-secret")); } }),
      onEnd: async (result) => { completed.push(result); }, waitUntil: (task) => { durable.push(task); },
    });
    const raw = await response.text(); await Promise.all(durable);
    expect(raw).toContain("data: [DONE]");
    expect(raw).not.toContain("private-source-secret");
    expect(completed).toEqual([{ text: spoken(raw), outcome: "failed", requiresApproval: false }]);
    expect(spoken(raw)).toContain("couldn’t finish");
  });

  it("uses authoritative text history and the same versioned tools, journal and usage without speaking structured parts", async () => {
    const recipe = await createRecipe(db, actorA, { content }), conversation = await createConversation(db, actorA);
    await (await assistantResponse(db, actorA, message(conversation.id, "Remember that I prefer mild food."), { model: modelWith(textReply("I will keep that in mind.")) })).text();
    const changed = { ...recipe.version.content, title: "Mild voice test stew" };
    const model = modelWith(toolCall("getRecipe", { recipeId: recipe.id }), toolCall("updateRecipe", { recipeId: recipe.id, expectedVersionId: recipe.version.id, content: changed, changeSummary: "Rename over voice" }), textReply("Renamed your stew. The old version is kept."));
    const completed: VoiceEnd[] = [];
    const response = await assistantVoiceResponse(db, actorA, message(conversation.id, "Rename this to Mild voice test stew.", recipe), { model, onVoiceEnd: async (result) => { completed.push(result); expect((await getConversation(db, actorA, conversation.id)).busy).toBe(false); } });
    const raw = await response.text();
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(raw).toContain("data: [DONE]");
    expect(spoken(raw)).toBe("Renamed your stew. The old version is kept.");
    expect(raw).not.toContain(recipe.id);
    expect(raw).not.toContain("tool-output");
    expect(raw).not.toContain("ingredientSections");
    expect(completed).toEqual([expect.objectContaining({ text: spoken(raw), outcome: "completed", requiresApproval: false })]);
    expect(JSON.stringify(model.doStreamCalls[0].prompt)).toContain("I prefer mild food");
    const saved = await getConversation(db, actorA, conversation.id);
    expect(saved.messages).toHaveLength(4);
    expect(saved.receipts).toEqual([expect.objectContaining({ toolName: "updateRecipe" })]);
    expect(saved.usage.calls).toBe(4);
    expect(saved.usage.models).toContain(model.modelId);
    expect(await listVersions(db, actorA, recipe.id)).toHaveLength(2);
  });

  it("persists a native approval and speaks only an on-screen confirmation prompt", async () => {
    const recipe = await createRecipe(db, actorA, { content }), conversation = await createConversation(db, actorA);
    let completed: VoiceEnd | undefined;
    const raw = await (await assistantVoiceResponse(db, actorA, message(conversation.id, "Archive this.", recipe), {
      model: modelWith(toolCall("archiveRecipe", { recipeId: recipe.id, expectedVersionId: recipe.version.id })), onVoiceEnd: async (result) => { completed = result; },
    })).text();
    expect(spoken(raw)).toContain("confirmation in Sift");
    expect(raw).not.toContain("approvalId");
    expect(completed).toMatchObject({ outcome: "completed", requiresApproval: true });
    expect((await getRecipe(db, actorA, recipe.id)).status).toBe("active");
    const saved = await getConversation(db, actorA, conversation.id);
    const pending = saved.messages.flatMap((item) => item.parts).find((part) => isToolUIPart(part) && part.state === "approval-requested");
    if (!pending || !isToolUIPart(pending) || pending.state !== "approval-requested") throw new Error("Expected native approval");
    await expect(assistantVoiceResponse(db, actorA, message(conversation.id, "Yes", recipe), { model: modelWith(textReply("Must not approve")) })).rejects.toMatchObject({ code: "CONFLICT" });
    await (await assistantResponse(db, actorA, { conversationId: conversation.id, requestId: randomUUID(), context: { route: "/library" }, approval: { id: pending.approval.id, approved: true } }, { model: modelWith(textReply("Archived.")) })).text();
    expect((await getRecipe(db, actorA, recipe.id)).status).toBe("archived");
  });

  it("lets a trusted voice lifecycle reserve the common turn atomically and roll it back", async () => {
    const conversation = await createConversation(db, actorA), input = message(conversation.id, "This must roll back.");
    const model = modelWith(textReply("Must not run"));
    await expect(assistantVoiceResponse(db, actorA, input, { model, beginTurn: (begin) => db.transaction(async (tx) => {
      const started = await begin(tx);
      expect(started.modelId).toBeNull();
      const [admitted] = await tx.select().from(usageLimits).where(eq(usageLimits.userId, actorA.userId));
      expect(admitted.count).toBe(1);
      throw new DomainError("CONFLICT", "The voice session ended while this turn was starting.");
    }) })).rejects.toMatchObject({ code: "CONFLICT" });
    expect((await getConversation(db, actorA, conversation.id)).messages).toEqual([]);
    expect(await assistantQuota(actorA)).toBe(0);
    expect(await db.select().from(usageLimits).where(eq(usageLimits.userId, actorA.userId))).toHaveLength(0);
    expect(await db.select().from(conversationTurns).where(eq(conversationTurns.conversationId, conversation.id))).toHaveLength(0);
    expect(model.doStreamCalls).toHaveLength(0);
    const guards: string[] = [];
    let runId: string | undefined;
    await (await assistantVoiceResponse(db, actorA, input, { model, beginTurn: (begin) => db.transaction(async (tx) => {
      const started = await begin(tx); runId = started.runId; return started;
    }), assertActive: async (id) => { guards.push(id); } })).text();
    expect(guards).toEqual([runId]);
    expect(await assistantQuota(actorA)).toBe(1);
  });

  it("fences only an expected voice-owned run and preserves committed actions across a later turn", async () => {
    const recipe = await createRecipe(db, actorA, { content }), conversation = await createConversation(db, actorA);
    const old = await beginConversationTurn(db, actorA, message(conversation.id, "Old voice turn"));
    await runToolMutation(db, actorA, { conversationId: conversation.id, runId: old.runId, toolCallId: randomUUID(), toolName: "addRecipeNote" }, (tx) => addRecipeNote(tx, actorA, recipe.id, { body: "Committed before interruption." }));
    await expect(abortConversationTurn(db, actorB, conversation.id, old.runId)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await abortConversationTurn(db, actorA, conversation.id, randomUUID())).toBe(false);
    expect((await getConversation(db, actorA, conversation.id)).busy).toBe(true);
    expect(await abortConversationTurn(db, actorA, conversation.id, old.runId)).toBe(true);
    await expect(runToolMutation(db, actorA, { conversationId: conversation.id, runId: old.runId, toolCallId: randomUUID(), toolName: "addRecipeNote" }, (tx) => addRecipeNote(tx, actorA, recipe.id, { body: "Must not happen after interruption." }))).rejects.toMatchObject({ code: "CONFLICT" });
    const newer = await beginConversationTurn(db, actorA, message(conversation.id, "New text turn"));
    expect(await abortConversationTurn(db, actorA, conversation.id, old.runId)).toBe(false);
    await finishConversationTurn(db, actorA, conversation.id, old.runId, old.messages, "completed");
    const saved = await getConversation(db, actorA, conversation.id);
    expect(saved.busy).toBe(true);
    expect(JSON.stringify(saved.messages)).toContain("New text turn");
    expect(saved.receipts).toHaveLength(1);
    expect((await listRecipeNotes(db, actorA, recipe.id)).map((note) => note.body)).toEqual(["Committed before interruption."]);
    await finishConversationTurn(db, actorA, conversation.id, newer.runId, newer.messages, "completed");
  });

  it("checks a durable voice fence before every model call, keeping earlier tool receipts", async () => {
    const recipe = await createRecipe(db, actorA, { content }), conversation = await createConversation(db, actorA);
    const model = modelWith(toolCall("addRecipeNote", { recipeId: recipe.id, body: "Committed before new utterance." }), textReply("Must not start another billed call"));
    let checks = 0, completed: VoiceEnd | undefined;
    await (await assistantVoiceResponse(db, actorA, message(conversation.id, "Remember this.", recipe), { model,
      assertActive: async () => { if (++checks > 2) throw new DomainError("CONFLICT", "The voice turn was superseded."); },
      onVoiceEnd: async (result) => { completed = result; },
    })).text();
    expect(model.doStreamCalls).toHaveLength(1);
    expect(completed?.outcome).toBe("failed");
    expect((await getConversation(db, actorA, conversation.id)).usage.calls).toBe(1);
    expect(await listRecipeNotes(db, actorA, recipe.id)).toHaveLength(1);
  });

  it("rechecks voice authorization before reads and writes proposed by a model already in flight", async () => {
    const recipe = await createRecipe(db, actorA, { content });
    for (const toolName of ["getRecipe", "addRecipeNote"]) {
      const conversation = await createConversation(db, actorA);
      const model = modelWith(toolCall(toolName, toolName === "getRecipe" ? { recipeId: recipe.id } : { recipeId: recipe.id, body: "Must not save after logout." }), textReply("Must not continue after logout"));
      let checks = 0;
      await (await assistantVoiceResponse(db, actorA, message(conversation.id, "Read or edit this recipe.", recipe), { model,
        assertActive: async () => { if (++checks > 1) throw new DomainError("UNAUTHENTICATED", "The voice session ended."); },
      })).text();
      expect(model.doStreamCalls).toHaveLength(1);
      const saved = await getConversation(db, actorA, conversation.id);
      const result = saved.messages.flatMap((entry) => entry.parts).find((part) => isToolUIPart(part) && part.state === "output-available");
      expect(result).toMatchObject({ output: { ok: false, code: "UNAUTHENTICATED" } });
      expect(saved.receipts).toHaveLength(0);
    }
    expect(await listRecipeNotes(db, actorA, recipe.id)).toHaveLength(0);
  });

  it("drains native persistence and reports completion when the speech consumer disconnects", async () => {
    const conversation = await createConversation(db, actorA);
    const model = new MockLanguageModelV4({ doStream: { stream: simulateReadableStream({ chunks: textReply("Saved voice transcript."), chunkDelayInMs: 5 }) } });
    let completion: Promise<void> | undefined, completed: VoiceEnd | undefined;
    const response = await assistantVoiceResponse(db, actorA, message(conversation.id, "Say something."), { model, waitUntil: (task) => { completion = task; }, onVoiceEnd: async (result) => { completed = result; } });
    const reader = response.body!.getReader(); await reader.read(); await reader.cancel(); await completion;
    expect(completed).toMatchObject({ text: "Saved voice transcript.", outcome: "completed" });
    const saved = await getConversation(db, actorA, conversation.id);
    expect(saved.busy).toBe(false);
    expect(JSON.stringify(saved.messages)).toContain("Saved voice transcript.");
  });

  it("passes explicit interruption into the SDK and settles the voice turn as aborted", async () => {
    const conversation = await createConversation(db, actorA), controller = new AbortController();
    const started = Promise.withResolvers<void>();
    const model = new MockLanguageModelV4({ doStream: async () => {
      started.resolve();
      return { stream: simulateReadableStream({ chunks: textReply("This long reply is interrupted."), initialDelayInMs: 30, chunkDelayInMs: 30 }) };
    } });
    let completed: VoiceEnd | undefined;
    const response = await assistantVoiceResponse(db, actorA, message(conversation.id, "Start speaking."), { model, abortSignal: controller.signal, onVoiceEnd: async (result) => { completed = result; } });
    await started.promise; controller.abort();
    const raw = await response.text();
    expect(spoken(raw)).toContain("stopped that reply");
    expect(completed?.outcome).toBe("aborted");
    expect((await getConversation(db, actorA, conversation.id)).busy).toBe(false);
  });

  it("speaks a safe billing error and never serializes provider secrets", async () => {
    const conversation = await createConversation(db, actorA), secret = "private-provider-secret-never-spoken";
    const model = modelWith([{ type: "stream-start", warnings: [] }, { type: "error", error: new APICallError({ message: secret, url: "https://gateway.example.test", requestBodyValues: { apiKey: secret }, responseBody: secret, statusCode: 402, isRetryable: false }) }]);
    let completed: VoiceEnd | undefined;
    const logs = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const raw = await (await assistantVoiceResponse(db, actorA, message(conversation.id, "Answer please."), { model, onVoiceEnd: async (result) => { completed = result; } })).text();
      expect(spoken(raw)).toContain("billing");
      expect(raw).not.toContain(secret);
      expect(completed).toMatchObject({ outcome: "failed", requiresApproval: false });
      expect(completed?.text).toBe(spoken(raw));
      expect((await getConversation(db, actorA, conversation.id)).lastError).toContain("billing");
      expect(JSON.stringify(logs.mock.calls)).not.toContain(secret);
    } finally { logs.mockRestore(); }
  });
});
