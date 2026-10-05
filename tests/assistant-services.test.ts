import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import type { UIMessage } from "ai";
import { connectDatabase } from "@/db/connection";
import { aiUsage, conversations, conversationToolCalls, gatewayCredentials, recipes, users, workspaceMembers } from "@/db/schema";
import { assistantRequestSchema } from "@/domain/assistant";
import { parsePastedRecipe } from "@/domain/import";
import { decryptCredential, encryptCredential } from "@/lib/credential-crypto";
import { beginConversationTurn, createConversation, deleteConversation, finishConversationTurn, getConversation, listConversations, renameConversation, runToolMutation } from "@/services/conversations";
import { deleteGatewayCredential, getGatewayCredentialStatus, resolveGatewayCredential, saveGatewayCredential } from "@/services/credentials";
import { getUsageSummary, recordModelUsage, reportedGatewayCost } from "@/services/ai-usage";
import { addRecipeNote, createRecipe, listRecipeNotes } from "@/services/recipes";
import { ensurePersonalWorkspace, type Actor } from "@/services/workspaces";
import { testDatabaseUrl } from "./database";

const { db, pool } = connectDatabase(testDatabaseUrl);
const userIds = [randomUUID(), randomUUID(), randomUUID()];
let a: Actor, b: Actor, teammate: Actor;
const content = parsePastedRecipe("Soup\nIngredients\n2 cups broth\nInstructions\nHeat the broth.")!;
const messageInput = (conversationId: string) => ({ conversationId, requestId: randomUUID(), context: { route: "/library" }, message: { id: randomUUID(), text: "Find a soup recipe." } });

beforeAll(async () => {
  vi.stubEnv("CREDENTIAL_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
  vi.stubEnv("AI_GATEWAY_API_KEY", "app-test-key-never-sent");
  await db.insert(users).values(userIds.map((id) => ({ id, name: "Assistant test cook", email: `${id}@example.test` })));
  const [wa, wb] = await Promise.all(userIds.slice(0, 2).map((id) => ensurePersonalWorkspace(db, id)));
  a = { userId: userIds[0], workspaceId: wa }; b = { userId: userIds[1], workspaceId: wb }; teammate = { userId: userIds[2], workspaceId: wa };
  await db.insert(workspaceMembers).values({ userId: teammate.userId, workspaceId: wa });
});
afterAll(async () => {
  vi.unstubAllEnvs();
  await db.update(recipes).set({ currentVersionId: null }).where(inArray(recipes.workspaceId, [a.workspaceId, b.workspaceId]));
  await db.delete(users).where(inArray(users.id, userIds));
  await pool.end();
});

describe("server-owned conversations and mutation journal", () => {
  it("rejects client histories, forged actors, and mixed approval/text inputs", () => {
    const request = messageInput(randomUUID());
    expect(assistantRequestSchema.safeParse(request).success).toBe(true);
    for (const extra of [{ messages: [] }, { userId: a.userId }, { workspaceId: a.workspaceId }, { approval: { id: "forged", approved: true } }]) {
      expect(assistantRequestSchema.safeParse({ ...request, ...extra }).success).toBe(false);
    }
  });

  it("keeps conversations private to their creator even within one workspace", async () => {
    const conversation = await createConversation(db, a);
    for (const actor of [b, teammate, { ...a, workspaceId: b.workspaceId }]) {
      await expect(getConversation(db, actor, conversation.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(renameConversation(db, actor, conversation.id, { title: "intrusion" })).rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(deleteConversation(db, actor, conversation.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    }
    expect((await listConversations(db, teammate)).map((row) => row.id)).not.toContain(conversation.id);
    expect((await renameConversation(db, a, conversation.id, { title: "Weeknight ideas" })).title).toBe("Weeknight ideas");
    await deleteConversation(db, a, conversation.id);
    await expect(getConversation(db, a, conversation.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("serializes turns and rejects request replay without losing persisted history", async () => {
    const conversation = await createConversation(db, a), request = messageInput(conversation.id);
    const starts = await Promise.allSettled([beginConversationTurn(db, a, request), beginConversationTurn(db, a, messageInput(conversation.id))]);
    expect(starts.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const run = starts.find((result) => result.status === "fulfilled")!;
    if (run.status !== "fulfilled") throw new Error("Expected a reserved turn");
    await expect(deleteConversation(db, a, conversation.id)).rejects.toMatchObject({ code: "CONFLICT" });
    const response: UIMessage = { id: randomUUID(), role: "assistant", parts: [{ type: "text", text: "Here is a recipe idea." }] };
    await finishConversationTurn(db, a, conversation.id, run.value.runId, [...run.value.messages, response], "completed");
    const saved = await getConversation(db, a, conversation.id);
    expect(saved.busy).toBe(false); expect(saved.messages.at(-1)).toEqual(response);
    // Replay whichever request actually won the race.
    if (starts[0].status === "fulfilled") await expect(beginConversationTurn(db, a, request)).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("rejects forged/stale approvals and uses the original stored tool arguments", async () => {
    const conversation = await createConversation(db, a);
    const run = await beginConversationTurn(db, a, messageInput(conversation.id));
    const recipeId = randomUUID(), expectedVersionId = randomUUID();
    const approvalMessage: UIMessage = { id: randomUUID(), role: "assistant", parts: [{ type: "tool-archiveRecipe", toolCallId: "archive-1", state: "approval-requested", input: { recipeId, expectedVersionId }, approval: { id: "approval-1" } }] };
    await finishConversationTurn(db, a, conversation.id, run.runId, [...run.messages, approvalMessage], "completed");
    const approval = { conversationId: conversation.id, requestId: randomUUID(), context: { route: "/library" }, approval: { id: "wrong", approved: true } };
    await expect(beginConversationTurn(db, a, approval)).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(beginConversationTurn(db, a, messageInput(conversation.id))).rejects.toMatchObject({ code: "CONFLICT" });
    const approved = await beginConversationTurn(db, a, { ...approval, approval: { id: "approval-1", approved: false } });
    expect(approved.messages.at(-1)?.parts[0]).toMatchObject({ state: "approval-responded", input: { recipeId, expectedVersionId }, approval: { id: "approval-1", approved: false } });
    await finishConversationTurn(db, a, conversation.id, approved.runId, approved.messages, "completed");
    await expect(beginConversationTurn(db, a, { ...approval, requestId: randomUUID(), approval: { id: "approval-1", approved: true } })).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it("commits a repeated tool call once and rolls back failed tool writes atomically", async () => {
    const recipe = await createRecipe(db, a, { content, source: { type: "manual" }, status: "active" });
    const conversation = await createConversation(db, a), request = messageInput(conversation.id);
    const run = await beginConversationTurn(db, a, request);
    const call = { conversationId: conversation.id, runId: run.runId, toolCallId: "note-1", toolName: "addRecipeNote" };
    const results = await Promise.all([1, 2].map(() => runToolMutation(db, a, call, (tx) => addRecipeNote(tx, a, recipe.id, { body: "More lemon next time." }))));
    expect(results[0].id).toBe(results[1].id);
    expect(await listRecipeNotes(db, a, recipe.id)).toHaveLength(1);
    await expect(runToolMutation(db, a, { ...call, toolCallId: "rollback" }, async (tx) => { await addRecipeNote(tx, a, recipe.id, { body: "Must roll back" }); throw new Error("Simulated failed operation"); })).rejects.toThrow("Simulated failed operation");
    expect(await listRecipeNotes(db, a, recipe.id)).toHaveLength(1);
    expect(await db.select().from(conversationToolCalls).where(and(eq(conversationToolCalls.conversationId, conversation.id), eq(conversationToolCalls.toolCallId, "rollback")))).toHaveLength(0);
    await finishConversationTurn(db, a, conversation.id, run.runId, run.messages, "failed", "The response was interrupted.");
    const saved = await getConversation(db, a, conversation.id);
    expect(saved.receipts).toHaveLength(1); expect(saved.lastError).toBe("The response was interrupted.");
    await expect(beginConversationTurn(db, a, request)).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("expires interrupted runs and prevents late streams from overwriting a newer turn", async () => {
    const conversation = await createConversation(db, a);
    const old = await beginConversationTurn(db, a, messageInput(conversation.id));
    await db.update(conversations).set({ leaseExpiresAt: new Date(Date.now() - 1000) }).where(eq(conversations.id, conversation.id));
    expect((await getConversation(db, a, conversation.id)).lastError).toContain("interrupted");
    const next = await beginConversationTurn(db, a, messageInput(conversation.id));
    await finishConversationTurn(db, a, conversation.id, old.runId, [], "completed");
    expect((await getConversation(db, a, conversation.id)).messages).toHaveLength(2);
    await expect(runToolMutation(db, a, { conversationId: conversation.id, runId: old.runId, toolCallId: "late", toolName: "note" }, async () => ({ ok: true }))).rejects.toMatchObject({ code: "CONFLICT" });
    await finishConversationTurn(db, a, conversation.id, next.runId, next.messages, "completed");
  });
});

describe("encrypted user Gateway credentials", () => {
  it("uses randomized authenticated encryption bound to user and rejects tampering", () => {
    const secret = "test-gateway-secret-do-not-log";
    const first = encryptCredential(a.userId, secret), second = encryptCredential(a.userId, secret);
    expect(first).not.toBe(second); expect(first).not.toContain(secret);
    expect(decryptCredential(a.userId, first)).toBe(secret);
    expect(() => decryptCredential(b.userId, first)).toThrow("CREDENTIAL_ENCRYPTION_KEY");
    const segments = first.split("."); const bytes = Buffer.from(segments[3], "base64"); bytes[0] ^= 1; segments[3] = bytes.toString("base64");
    expect(() => decryptCredential(a.userId, segments.join("."))).toThrow("CREDENTIAL_ENCRYPTION_KEY");
  });

  it("stores only ciphertext and masked hints, with ownership independent of workspace", async () => {
    const secret = "test-personal-gateway-secret-1234";
    const status = await saveGatewayCredential(db, a.userId, { key: secret });
    expect(status).toMatchObject({ configured: true, hint: "•••• 1234", appConfigured: true, encryptionConfigured: true });
    expect(JSON.stringify(status)).not.toContain(secret);
    const [stored] = await db.select().from(gatewayCredentials).where(eq(gatewayCredentials.userId, a.userId));
    expect(JSON.stringify(stored)).not.toContain(secret);
    expect(await resolveGatewayCredential(db, a.userId)).toBe(secret);
    expect(await resolveGatewayCredential(db, teammate.userId)).toBeUndefined();
    expect((await getGatewayCredentialStatus(db, teammate.userId)).configured).toBe(false);
    expect((await deleteGatewayCredential(db, a.userId)).configured).toBe(false);
    expect(await resolveGatewayCredential(db, a.userId)).toBeUndefined(); // Runtime uses application key fallback.
  });
});

describe("provider-reported usage and cost ledger", () => {
  it("keeps absent/malformed costs unknown and accepts actual reported decimal costs", () => {
    for (const metadata of [undefined, {}, { gateway: { cost: "unknown" } }, { gateway: { cost: -1 } }, { gateway: { cost: Infinity } }]) expect(reportedGatewayCost(metadata)).toBeNull();
    expect(reportedGatewayCost({ gateway: { cost: "0.000125" } })).toBe("0.000125");
    expect(reportedGatewayCost({ gateway: { cost: 0 } })).toBe("0.0000000000");
  });

  it("records every model call once, sums exact USD and preserves unknown interrupted costs", async () => {
    const conversation = await createConversation(db, a), run = await beginConversationTurn(db, a, messageInput(conversation.id));
    const base = { conversationId: conversation.id, runId: run.runId, model: "anthropic/test-model", credentialSource: "app" as const };
    await recordModelUsage(db, a, { ...base, idempotencyKey: `${run.runId}:1` });
    expect((await getUsageSummary(db, a, conversation.id)).reportedCostUsd).toBeNull();
    const first = { ...base, idempotencyKey: `${run.runId}:1`, usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 }, providerMetadata: { gateway: { cost: "0.1", generationId: "gen_1", requestBody: "must-not-be-stored" } } };
    await recordModelUsage(db, a, first); await recordModelUsage(db, a, first);
    await recordModelUsage(db, a, { ...base, idempotencyKey: `${run.runId}:2`, usage: { inputTokens: 12, outputTokens: 7 }, providerMetadata: { gateway: { cost: "0.2", generationId: "gen_2" } } });
    await recordModelUsage(db, a, { ...base, idempotencyKey: `${run.runId}:3` });
    await finishConversationTurn(db, a, conversation.id, run.runId, run.messages, "failed");
    expect(await getUsageSummary(db, a, conversation.id)).toMatchObject({ calls: 3, inputTokens: 22, outputTokens: 12, reportedCostUsd: "0.3000000000", unpricedCalls: 1, appKeyCalls: 3 });
    const rows = await db.select().from(aiUsage).where(eq(aiUsage.conversationId, conversation.id));
    expect(rows).toHaveLength(3); expect(JSON.stringify(rows)).not.toContain("must-not-be-stored");
    await expect(getUsageSummary(db, teammate, conversation.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(recordModelUsage(db, b, { ...base, idempotencyKey: "intrusion" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await deleteConversation(db, a, conversation.id);
    // Usage survives deleting a chat, so conversation cleanup cannot erase costs.
    expect(await db.select().from(aiUsage).where(eq(aiUsage.userId, a.userId))).toHaveLength(3);
  });
});
