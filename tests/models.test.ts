import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq, inArray } from "drizzle-orm";
import type { UIMessage } from "ai";
import { connectDatabase } from "@/db/connection";
import { conversations, users, workspaceMembers } from "@/db/schema";
import { assistantResponse } from "@/ai/assistant-runtime";
import { assistantModelOptions, gatewayModel, getAssistantModels, prepareAssistantModel } from "@/ai/models";
import { beginConversationTurn, createConversation, finishConversationTurn, getConversation, listConversations, setConversationModel } from "@/services/conversations";
import { ensurePersonalWorkspace, type Actor } from "@/services/workspaces";
import { testDatabaseUrl } from "./database";

// Only the external model boundary is replaced: selection, the native SDK loop,
// persistence, authorization, and usage accounting use the real application.
const gatewayCalls = vi.hoisted(() => [] as string[]);
vi.mock("@ai-sdk/gateway", async () => {
  const { MockLanguageModelV4 } = await import("ai/test");
  const { simulateReadableStream } = await import("ai");
  return { createGateway: () => (modelId: string) => {
    gatewayCalls.push(modelId);
    return new MockLanguageModelV4({ modelId, doStream: {
      stream: simulateReadableStream({ initialDelayInMs: null, chunkDelayInMs: null, chunks: [
        { type: "stream-start", warnings: [] },
        { type: "text-start", id: "reply" },
        { type: "text-delta", id: "reply", delta: "I can help with dinner." },
        { type: "text-end", id: "reply" },
        { type: "finish", finishReason: { unified: "stop", raw: undefined }, usage: { inputTokens: { total: 12, noCache: 12, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 5, text: 5, reasoning: 0 } }, providerMetadata: { gateway: { cost: "0.000125" } } },
      ] }),
    } });
  } };
});

const { db, pool } = connectDatabase(testDatabaseUrl);
const userIds = [randomUUID(), randomUUID(), randomUUID()];
let a: Actor, b: Actor, teammate: Actor;
const haiku = "anthropic/claude-haiku-4.5", opus = "anthropic/claude-opus-5.5";
const message = (conversationId: string) => ({ conversationId, requestId: randomUUID(), context: { route: "/library" }, message: { id: randomUUID(), text: "Help with dinner." } });
const pendingApproval = (): UIMessage => ({ id: randomUUID(), role: "assistant", parts: [{ type: "tool-archiveRecipe", toolCallId: randomUUID(), state: "approval-requested", input: { recipeId: randomUUID(), expectedVersionId: randomUUID() }, approval: { id: randomUUID() } }] });

beforeAll(async () => {
  await db.insert(users).values(userIds.map((id) => ({ id, name: "Model selection test", email: `${id}@example.test` })));
  const [wa, wb] = await Promise.all(userIds.slice(0, 2).map((id) => ensurePersonalWorkspace(db, id)));
  a = { userId: userIds[0], workspaceId: wa }; b = { userId: userIds[1], workspaceId: wb }; teammate = { userId: userIds[2], workspaceId: wa };
  await db.insert(workspaceMembers).values({ userId: teammate.userId, workspaceId: wa });
});
beforeEach(() => {
  vi.stubEnv("AI_GATEWAY_API_KEY", "model-test-key-never-sent");
  vi.stubEnv("AI_MODEL", "");
  gatewayCalls.length = 0;
});
afterEach(() => { vi.unstubAllEnvs(); });
afterAll(async () => {
  await db.delete(users).where(inArray(users.id, userIds));
  await pool.end();
});

describe("conversation model selection", () => {
  it("offers a curated Anthropic registry and keeps the administrator default explicit", () => {
    expect(getAssistantModels()).toMatchObject({ defaultId: "anthropic/claude-sonnet-5.5", options: assistantModelOptions });
    expect(assistantModelOptions.map((option) => option.id)).toEqual([haiku, "anthropic/claude-sonnet-4.5", "anthropic/claude-sonnet-5.5", opus]);
    expect(prepareAssistantModel()(null).modelId).toBe("anthropic/claude-sonnet-5.5");
    expect(gatewayModel("extraction").modelId).toBe("anthropic/claude-sonnet-4.5");
    vi.stubEnv("AI_MODEL", "anthropic/configured-model");
    expect(getAssistantModels().defaultId).toBe("anthropic/configured-model");
    const chooseModel = prepareAssistantModel();
    expect(chooseModel(null).modelId).toBe("anthropic/configured-model");
    expect(chooseModel(haiku).modelId).toBe(haiku);
  });

  it("persists a selection and reset without discarding conversation history", async () => {
    const conversation = await createConversation(db, a);
    expect(conversation.modelId).toBeNull();
    const selected = await setConversationModel(db, a, conversation.id, { modelId: haiku, expectedModelId: null });
    expect(selected.modelId).toBe(haiku);
    expect((await listConversations(db, a)).find((item) => item.id === conversation.id)?.modelId).toBe(haiku);
    const run = await beginConversationTurn(db, a, message(conversation.id));
    expect(run.modelId).toBe(haiku);
    await finishConversationTurn(db, a, conversation.id, run.runId, run.messages, "completed");
    const reset = await setConversationModel(db, a, conversation.id, { modelId: null, expectedModelId: haiku });
    expect(reset.modelId).toBeNull();
    expect(reset.messages).toEqual(run.messages);
  });

  it("rejects unlisted models, forged fields, and stale selections", async () => {
    const conversation = await createConversation(db, a);
    for (const input of [
      { modelId: "openai/other-model", expectedModelId: null },
      { modelId: "anthropic/unlisted-model", expectedModelId: null },
      { modelId: haiku },
      { modelId: haiku, expectedModelId: null, workspaceId: b.workspaceId },
    ]) await expect(setConversationModel(db, a, conversation.id, input)).rejects.toBeDefined();
    expect((await getConversation(db, a, conversation.id)).modelId).toBeNull();
    await setConversationModel(db, a, conversation.id, { modelId: haiku, expectedModelId: null });
    await expect(setConversationModel(db, a, conversation.id, { modelId: opus, expectedModelId: null })).rejects.toMatchObject({ code: "CONFLICT" });
    expect((await getConversation(db, a, conversation.id)).modelId).toBe(haiku);
  });

  it("requires creator ownership and authorized workspace membership", async () => {
    const conversation = await createConversation(db, a);
    for (const actor of [b, teammate, { ...a, workspaceId: b.workspaceId }]) {
      await expect(setConversationModel(db, actor, conversation.id, { modelId: haiku, expectedModelId: null })).rejects.toMatchObject({ code: "NOT_FOUND" });
    }
    await expect(setConversationModel(db, a, "not-an-id", { modelId: haiku, expectedModelId: null })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await getConversation(db, a, conversation.id)).modelId).toBeNull();
  });

  it("serializes conflicting model changes instead of overwriting another window", async () => {
    const conversation = await createConversation(db, a);
    const changes = await Promise.allSettled([haiku, opus].map((modelId) => setConversationModel(db, a, conversation.id, { modelId, expectedModelId: null })));
    expect(changes.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(changes.find((result) => result.status === "rejected")).toMatchObject({ reason: { code: "CONFLICT" } });
    const winner = changes.find((result) => result.status === "fulfilled");
    if (winner?.status !== "fulfilled") throw new Error("Expected one model selection");
    expect((await getConversation(db, a, conversation.id)).modelId).toBe(winner.value.modelId);
  });

  it("blocks changes during an active reply or while an approval awaits a decision", async () => {
    const conversation = await createConversation(db, a);
    const run = await beginConversationTurn(db, a, message(conversation.id));
    expect(run.modelId).toBeNull();
    await expect(setConversationModel(db, a, conversation.id, { modelId: haiku, expectedModelId: null })).rejects.toMatchObject({ code: "CONFLICT", message: expect.stringContaining("current reply") });
    await finishConversationTurn(db, a, conversation.id, run.runId, [...run.messages, pendingApproval()], "completed");
    await expect(setConversationModel(db, a, conversation.id, { modelId: haiku, expectedModelId: null })).rejects.toMatchObject({ code: "CONFLICT", message: expect.stringContaining("pending action") });
    expect((await getConversation(db, a, conversation.id)).modelId).toBeNull();
  });

  it("invalidates an expired run so a late stream cannot introduce an approval after switching", async () => {
    const conversation = await createConversation(db, a);
    const old = await beginConversationTurn(db, a, message(conversation.id));
    await db.update(conversations).set({ leaseExpiresAt: new Date(Date.now() - 1_000) }).where(eq(conversations.id, conversation.id));
    const selected = await setConversationModel(db, a, conversation.id, { modelId: haiku, expectedModelId: null });
    expect(selected.lastError).toContain("interrupted");
    await finishConversationTurn(db, a, conversation.id, old.runId, [...old.messages, pendingApproval()], "completed");
    const saved = await getConversation(db, a, conversation.id);
    expect(saved.messages).toEqual(old.messages);
    expect(saved.modelId).toBe(haiku);
    const next = await beginConversationTurn(db, a, message(conversation.id));
    expect(next.modelId).toBe(haiku);
    await finishConversationTurn(db, a, conversation.id, next.runId, next.messages, "completed");
  });

  it("uses the stored selection in the native runtime and records the actual model and charge", async () => {
    const conversation = await createConversation(db, a);
    await setConversationModel(db, a, conversation.id, { modelId: haiku, expectedModelId: null });
    await (await assistantResponse(db, a, message(conversation.id))).text();
    expect(gatewayCalls).toEqual([haiku]);
    const saved = await getConversation(db, a, conversation.id);
    expect(saved.lastError).toBeNull();
    expect(saved.usage).toMatchObject({ calls: 1, inputTokens: 12, outputTokens: 5, reportedCostUsd: "0.0001250000", models: [haiku] });
    await setConversationModel(db, a, conversation.id, { modelId: null, expectedModelId: haiku });
    vi.stubEnv("AI_MODEL", "anthropic/claude-sonnet-5.5");
    await (await assistantResponse(db, a, message(conversation.id))).text();
    expect(gatewayCalls).toEqual([haiku, "anthropic/claude-sonnet-5.5"]);
    expect((await getConversation(db, a, conversation.id)).messages.filter((item) => item.role === "user")).toHaveLength(2);
  });

  it("checks missing Gateway credentials before saving a message or reserving a turn", async () => {
    const conversation = await createConversation(db, a);
    await setConversationModel(db, a, conversation.id, { modelId: haiku, expectedModelId: null });
    vi.stubEnv("AI_GATEWAY_API_KEY", "");
    await expect(assistantResponse(db, a, message(conversation.id))).rejects.toMatchObject({ name: "ConfigurationError", keys: ["AI_GATEWAY_API_KEY"] });
    const saved = await getConversation(db, a, conversation.id);
    expect(saved.messages).toEqual([]);
    expect(saved.busy).toBe(false);
    expect(saved.usage.calls).toBe(0);
    expect(gatewayCalls).toEqual([]);
  });
});
