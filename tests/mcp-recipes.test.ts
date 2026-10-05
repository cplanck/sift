import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, inArray, like } from "drizzle-orm";
import { CLIENT_CAPABILITIES_META_KEY, PROTOCOL_VERSION_META_KEY } from "@modelcontextprotocol/server";
import { connectDatabase } from "@/db/connection";
import { recipeImports, recipes, usageLimits, users, workspaceMembers } from "@/db/schema";
import { recipeContentSchema } from "@/domain/recipe";
import { handleAuthenticatedMcpRequest } from "@/mcp/server";
import { approveImport, getImport } from "@/services/imports";
import type { McpPrincipal } from "@/services/mcp-connections";
import { createMcpRecipe, getMcpRecipe, searchMcpRecipes, updateMcpRecipe } from "@/services/mcp-recipes";
import { createRecipe, getRecipe, listVersions, setRecipeStatus } from "@/services/recipes";
import { ensurePersonalWorkspace, type Actor } from "@/services/workspaces";
import { testDatabaseUrl } from "./database";

const { db, pool } = connectDatabase(testDatabaseUrl);
const userIds = [randomUUID(), randomUUID(), randomUUID()];
let actorA: Actor, actorB: Actor, fellowCook: Actor;
const client = { clientId: "sift-test-external-client", clientName: "External recipe assistant" };
const content = recipeContentSchema.parse({ title: "MCP pour-over coffee", servings: 1,
  ingredientSections: [{ name: "Coffee", items: [{ text: "20 g medium-ground coffee" }, { text: "320 g water" }] }],
  instructionSections: [{ name: "Brew", steps: ["Rinse the paper filter.", "Bloom with 40 g water for 30 seconds, then pour the remaining water slowly."] }],
});
const principal = (scopes = ["recipes:read", "recipes:write"], actor = actorA): McpPrincipal => ({ actor, scopes, ...client, consentId: randomUUID(), sessionId: randomUUID() });
beforeAll(async () => {
  await db.insert(users).values(userIds.map((id) => ({ id, email: `${id}@example.test`, name: "MCP domain cook" })));
  [actorA, actorB] = await Promise.all(userIds.slice(0, 2).map(async (userId) => ({ userId, workspaceId: await ensurePersonalWorkspace(db, userId) })));
  fellowCook = { userId: userIds[2], workspaceId: actorA.workspaceId };
  await db.insert(workspaceMembers).values({ ...fellowCook, role: "member" });
});
afterAll(async () => {
  await db.update(recipes).set({ currentVersionId: null }).where(inArray(recipes.workspaceId, [actorA.workspaceId, actorB.workspaceId]));
  await db.delete(users).where(inArray(users.id, userIds));
  await pool.end();
});

describe("MCP recipe operations through the shared PostgreSQL domain", () => {
  it("creates exactly one reviewable import for concurrent retries and preserves trusted source provenance", async () => {
    const input = { requestId: randomUUID(), content, sourceName: "My original coffee notes", sourceUrl: "https://example.com/coffee" };
    const [first, repeated] = await Promise.all([createMcpRecipe(db, actorA, client, input), createMcpRecipe(db, actorA, client, input)]);
    expect(first).toMatchObject({ recipeId: repeated.recipeId, importId: repeated.importId, status: "draft", importStatus: "review", reviewRequired: true, versionNumber: 1 });
    expect(new URL(first.reviewUrl).pathname).toBe(`/imports/${first.importId}`);
    const record = await getImport(db, actorA, first.importId), recipe = await getRecipe(db, actorA, first.recipeId);
    expect(record).toMatchObject({ kind: "mcp", status: "review", createdByUserId: actorA.userId, workspaceId: actorA.workspaceId });
    expect(recipe.source).toMatchObject({ type: "mcp", name: `${client.clientName} via MCP · My original coffee notes`, url: input.sourceUrl });
    expect(JSON.parse(recipe.source.rawText!)).toEqual({ transport: "mcp", client, request: input });
    expect(await listVersions(db, actorA, first.recipeId)).toHaveLength(1);
    await expect(createMcpRecipe(db, actorA, client, { ...input, content: { ...content, title: "Different content" } })).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(updateMcpRecipe(db, actorA, { recipeId: first.recipeId, expectedVersionId: first.versionId, content, changeSummary: "Attempt approval bypass" })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await approveImport(db, fellowCook, first.importId, { content, expectedVersionId: first.versionId });
    const approvedRetry = await createMcpRecipe(db, actorA, client, input);
    expect(approvedRetry).toMatchObject({ recipeId: first.recipeId, importStatus: "saved", status: "active", reviewRequired: false, versionNumber: 2 });
    expect(await listVersions(db, actorA, first.recipeId)).toHaveLength(2);
    const otherClient = await createMcpRecipe(db, actorA, { ...client, clientId: "a-different-connection" }, input);
    expect(otherClient.importId).not.toBe(first.importId);
  });

  it("rejects foreign workspace reads, writes and forged membership without leaking provenance", async () => {
    const privateRecipe = await createRecipe(db, actorB, { content: { ...content, title: "Private other cookbook" } });
    await expect(getMcpRecipe(db, actorA, { recipeId: privateRecipe.id })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(updateMcpRecipe(db, actorA, { recipeId: privateRecipe.id, expectedVersionId: privateRecipe.version.id, content, changeSummary: "Forbidden" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    const forged = { ...actorA, workspaceId: actorB.workspaceId };
    await expect(createMcpRecipe(db, forged, client, { requestId: randomUUID(), content })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(searchMcpRecipes(db, forged, {})).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await searchMcpRecipes(db, actorA, { query: "Private other cookbook" })).recipes).toEqual([]);
    expect(await listVersions(db, actorB, privateRecipe.id)).toHaveLength(1);
  });

  it("creates immutable versions and rejects concurrent or repeated stale updates", async () => {
    const saved = await createRecipe(db, actorA, { content });
    const before = await getMcpRecipe(db, actorA, { recipeId: saved.id });
    expect(before).toMatchObject({ fullContentAvailable: true, versionId: saved.version.id, content });
    const attempts = await Promise.allSettled(["Bloom for 35 seconds", "Bloom for 40 seconds"].map((title) => updateMcpRecipe(db, actorA, { recipeId: saved.id, expectedVersionId: saved.version.id, content: { ...content, title }, changeSummary: title })));
    expect(attempts.filter((attempt) => attempt.status === "fulfilled")).toHaveLength(1);
    expect(attempts.find((attempt) => attempt.status === "rejected")).toMatchObject({ reason: { code: "CONFLICT" } });
    const versions = await listVersions(db, actorA, saved.id);
    expect(versions).toHaveLength(2);
    expect(versions[1].content).toEqual(content);
    await expect(getMcpRecipe(db, actorA, { recipeId: saved.id, expectedVersionId: saved.version.id, view: "instructions" })).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(updateMcpRecipe(db, actorA, { recipeId: saved.id, expectedVersionId: saved.version.id, content, changeSummary: "Retry stale write" })).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await listVersions(db, actorA, saved.id)).toHaveLength(2);
  });

  it("pages compact searches and excludes archived recipes by default", async () => {
    const saved = await Promise.all([0, 1, 2].map((index) => createRecipe(db, actorA, { content: { ...content, title: `Searchable MCP brew ${index}` } })));
    await setRecipeStatus(db, actorA, saved[2].id, "archived");
    const first = await searchMcpRecipes(db, actorA, { query: "Searchable MCP brew", limit: 1 });
    const second = await searchMcpRecipes(db, actorA, { query: "Searchable MCP brew", limit: 1, offset: first.nextOffset });
    expect(first).toMatchObject({ total: 2, nextOffset: 1 });
    expect(second).toMatchObject({ total: 2, nextOffset: null });
    expect(first.recipes[0].recipeId).not.toBe(second.recipes[0].recipeId);
    expect(first.recipes[0]).not.toHaveProperty("notesText");
    expect((await searchMcpRecipes(db, actorA, { query: "Searchable MCP brew", includeArchived: true })).total).toBe(3);
  });

  it("bounds large reads without truncating steps or stalling a continuation", async () => {
    const step = "\u0001".repeat(5000), name = "\u0001".repeat(150);
    const saved = await createRecipe(db, actorA, { content: { ...content, description: "\u0001".repeat(4000), instructionSections: [{ name, steps: [step, step, step] }] }, source: { type: "paste", rawText: "Private raw import source", url: `https://example.com/${"x".repeat(3000)}` } });
    const full = await getMcpRecipe(db, actorA, { recipeId: saved.id });
    expect(full).toMatchObject({ fullContentAvailable: false, source: { url: null, urlOmitted: true } });
    expect(JSON.stringify(full)).not.toContain("Private raw import source");
    const page = await getMcpRecipe(db, actorA, { recipeId: saved.id, view: "instructions", limit: 50, expectedVersionId: saved.version.id });
    expect(page).toMatchObject({ total: 3, nextOffset: 1, rows: [{ text: step, sectionName: name, index: 0 }] });
    expect(Buffer.byteLength(JSON.stringify(page))).toBeLessThan(100 * 1024);
    const next = await getMcpRecipe(db, actorA, { recipeId: saved.id, view: "instructions", offset: 1, expectedVersionId: saved.version.id });
    expect(next).toMatchObject({ nextOffset: 2, rows: [{ text: step, index: 1 }] });
  });

  it("rejects unknown authority fields, unsafe source URLs, and oversized writes atomically", async () => {
    const countBefore = await db.select({ id: recipeImports.id }).from(recipeImports).where(eq(recipeImports.workspaceId, actorA.workspaceId));
    const input = { requestId: randomUUID(), content };
    for (const invalid of [{ ...input, workspaceId: actorB.workspaceId }, { ...input, status: "active" }, { ...input, clientId: "forged" }, { ...input, sourceUrl: "javascript:alert(1)" }]) {
      await expect(createMcpRecipe(db, actorA, client, invalid)).rejects.toBeDefined();
    }
    await expect(createMcpRecipe(db, actorA, client, { ...input, content: { ...content, instructionSections: [{ name: "", steps: Array(20).fill("x".repeat(5000)) }] } })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    const countAfter = await db.select({ id: recipeImports.id }).from(recipeImports).where(eq(recipeImports.workspaceId, actorA.workspaceId));
    expect(countAfter).toHaveLength(countBefore.length);
    const saved = await createRecipe(db, actorA, { content });
    await expect(updateMcpRecipe(db, actorA, { recipeId: saved.id, expectedVersionId: saved.version.id, content, changeSummary: "Forbidden status injection", status: "archived" })).rejects.toBeDefined();
    expect(await listVersions(db, actorA, saved.id)).toHaveLength(1);
  });

  it("rechecks membership for previously valid external actors", async () => {
    const saved = await createRecipe(db, actorA, { content });
    expect((await getMcpRecipe(db, fellowCook, { recipeId: saved.id })).recipeId).toBe(saved.id);
    await db.delete(workspaceMembers).where(and(eq(workspaceMembers.workspaceId, fellowCook.workspaceId), eq(workspaceMembers.userId, fellowCook.userId)));
    await expect(getMcpRecipe(db, fellowCook, { recipeId: saved.id })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(createMcpRecipe(db, fellowCook, client, { requestId: randomUUID(), content })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

async function protocol(method: string, params: Record<string, unknown> = {}, identity = principal(), modern = false) {
  const envelope = modern ? { [PROTOCOL_VERSION_META_KEY]: "2026-07-28", [CLIENT_CAPABILITIES_META_KEY]: {} } : undefined;
  const request = new Request("http://localhost:3003/api/mcp", { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", Authorization: "Bearer verified-test-token", "MCP-Protocol-Version": modern ? "2026-07-28" : "2025-06-18", ...(modern ? { "Mcp-Method": method, ...(typeof params.name === "string" ? { "Mcp-Name": params.name } : {}) } : {}) },
    body: JSON.stringify({ jsonrpc: "2.0", id: randomUUID(), method, params: { ...params, ...(envelope ? { _meta: envelope } : {}) } }),
  });
  const response = await handleAuthenticatedMcpRequest(request, db, identity), raw = await response.text();
  const json = response.headers.get("content-type")?.includes("text/event-stream") ? JSON.parse(raw.split("\n").find((line) => line.startsWith("data: "))!.slice(6)) : JSON.parse(raw);
  return { response, json, raw };
}

describe("Official MCP SDK HTTP transport and scope enforcement", () => {
  it("negotiates Claude-compatible 2025 stateless requests and lists only four described tools", async () => {
    const initialized = await protocol("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test-external-client", version: "1" } });
    expect(initialized.response.status).toBe(200);
    expect(initialized.json.result.protocolVersion).toBe("2025-06-18");
    expect(initialized.response.headers.has("mcp-session-id")).toBe(false);
    const listed = await protocol("tools/list");
    expect(listed.json.result.tools.map((tool: { name: string }) => tool.name).sort()).toEqual(["create_recipe", "get_recipe", "search_recipes", "update_recipe"]);
    expect(listed.json.result.tools.find((tool: { name: string }) => tool.name === "create_recipe")).toMatchObject({ annotations: { readOnlyHint: false, destructiveHint: false }, inputSchema: { additionalProperties: false } });
    const created = await protocol("tools/call", { name: "create_recipe", arguments: { requestId: randomUUID(), content } });
    expect(created.json.result.structuredContent).toMatchObject({ status: "draft", reviewRequired: true });
    expect(created.raw).not.toContain("verified-test-token");
    const read = await protocol("tools/call", { name: "get_recipe", arguments: { recipeId: created.json.result.structuredContent.recipeId } });
    expect(read.json.result.structuredContent).toMatchObject({ fullContentAvailable: true, content });
  });

  it("supports the current per-request MCP envelope through the same tools", async () => {
    await createRecipe(db, actorA, { content });
    const response = await protocol("tools/call", { name: "search_recipes", arguments: { query: "MCP pour-over coffee", limit: 1 } }, principal(), true);
    expect(response.response.status, response.raw).toBe(200);
    expect(response.json.result.structuredContent.recipes).toHaveLength(1);
  });

  it("independently denies writes for read-only grants and reads for write-only grants", async () => {
    const deniedWrite = await protocol("tools/call", { name: "create_recipe", arguments: { requestId: randomUUID(), content } }, principal(["recipes:read"]));
    expect(deniedWrite.response.status).toBe(403);
    expect(deniedWrite.response.headers.get("www-authenticate")).toContain("insufficient_scope");
    expect(deniedWrite.response.headers.get("www-authenticate")).toContain("recipes:write");
    const deniedRead = await protocol("tools/call", { name: "search_recipes", arguments: {} }, principal(["recipes:write"]));
    expect(deniedRead.response.status).toBe(403);
    expect(deniedRead.response.headers.get("www-authenticate")).toContain("recipes:read");
  });

  it("returns safe scoped tool errors and rejects oversized protocol bodies", async () => {
    const forbidden = await createRecipe(db, actorB, { content });
    const failed = await protocol("tools/call", { name: "get_recipe", arguments: { recipeId: forbidden.id } });
    expect(failed.json.result).toMatchObject({ isError: true, structuredContent: { code: "NOT_FOUND", error: "Recipe not found." } });
    const request = new Request("http://localhost:3003/api/mcp", { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" }, body: JSON.stringify({ payload: "x".repeat(256 * 1024) }) });
    const oversized = await handleAuthenticatedMcpRequest(request, db, principal());
    expect(oversized.status).toBe(413);
    const invalid = await protocol("tools/call", { name: "create_recipe", arguments: { requestId: randomUUID(), content, workspaceId: actorB.workspaceId } });
    expect(invalid.json.result?.isError || invalid.json.error).toBeTruthy();
  });

  it("rate limits both the authenticated user and external client", async () => {
    await protocol("ping");
    const counters = await db.select().from(usageLimits).where(and(eq(usageLimits.userId, actorA.userId), like(usageLimits.key, `${actorA.userId}:mcp:%`)));
    expect(counters).toHaveLength(2);
    const clientCounter = counters.find((row) => row.key.split(":").length === 4)!;
    await db.update(usageLimits).set({ count: 120 }).where(eq(usageLimits.key, clientCounter.key));
    await expect(protocol("ping")).rejects.toMatchObject({ code: "RATE_LIMITED" });
    // Another client may use its own allowance, but not bypass the user total.
    const otherClient = { ...principal(), clientId: "other-rate-limited-client" };
    expect((await protocol("ping", {}, otherClient)).response.status).toBe(200);
    const total = counters.find((row) => row.key.split(":").length === 3)!;
    await db.update(usageLimits).set({ count: 240 }).where(eq(usageLimits.key, total.key));
    await expect(protocol("ping", {}, otherClient)).rejects.toMatchObject({ code: "RATE_LIMITED" });
  });
});
