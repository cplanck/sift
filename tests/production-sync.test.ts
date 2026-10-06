import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { connectDatabase } from "@/db/connection";
import { conversations, conversationTurns, conversationToolCalls, aiUsage, photos, recipes, sessions, users, voiceSessions } from "@/db/schema";
import { ensurePersonalWorkspace, type Actor } from "@/services/workspaces";
import { createRecipe, updateRecipe, getRecipe, listVersions, addRecipeNote, listRecipeNotes, setFavorite } from "@/services/recipes";
import { createArtifact, getArtifact } from "@/services/artifacts";
import { startCookingSession, getCookingSession } from "@/services/cooking";
import { applyPlan, captureSnapshot, mappedId, planSync, readContent } from "../scripts/lib/production-sync.mjs";
import { testDatabaseUrl } from "./database";

const { db, pool } = connectDatabase(testDatabaseUrl);
const content = { title: "Source chili", servings: 4, ingredientSections: [{ name: "", items: [{ text: "½ tsp salt" }] }], instructionSections: [{ name: "", steps: ["Simmer gently."] }] };
const sourceEmail = `sync-source-${randomUUID()}@example.test`, targetEmail = `sync-local-${randomUUID()}@example.test`;
let source: Actor, target: Actor, stranger: Actor, sourceRecipeId: string, cookId: string, artifactId: string, conversationId: string, voiceId: string, keeperId: string;
let baseline: Record<string, string> = {};
const photoCopies: Array<{ source: string; target: string }> = [];
const snapshot = () => captureSnapshot(pool, pool, sourceEmail, targetEmail);
async function apply(next: Awaited<ReturnType<typeof snapshot>>) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const plan = planSync(next, await readContent(client, next.target, true), baseline);
    const records = await applyPlan(client, next, plan, async (original: { object_key: string }, copied: { object_key: string }) => { photoCopies.push({ source: original.object_key, target: copied.object_key }); });
    await client.query("COMMIT"); baseline = { ...baseline, ...records };
    return plan;
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}

beforeAll(async () => {
  const ids = [randomUUID(), randomUUID(), randomUUID()];
  await db.insert(users).values(ids.map((id, index) => ({ id, email: [sourceEmail, targetEmail, `sync-other-${id}@example.test`][index], name: "Sync fixture" })));
  [source, target, stranger] = await Promise.all(ids.map(async (userId) => ({ userId, workspaceId: await ensurePersonalWorkspace(db, userId) })));
  const first = await createRecipe(db, source, { content }); sourceRecipeId = first.id;
  cookId = (await startCookingSession(db, source, { recipeId: first.id, expectedVersionId: first.version.id })).id;
  const second = await updateRecipe(db, source, first.id, { content: { ...content, title: "Source chili v2" }, expectedVersionId: first.version.id, changeSummary: "Second version" });
  await addRecipeNote(db, source, first.id, { body: "A production observation" });
  await setFavorite(db, source, first.id, true);
  artifactId = (await createArtifact(db, source, { kind: "meal-plan", title: "Production dinners", entries: [{ meal: "Dinner", recipeId: first.id, versionId: first.version.id }] })).id;
  keeperId = (await createRecipe(db, target, { content: { ...content, title: "Local keeper" } })).id;
  await createRecipe(db, stranger, { content: { ...content, title: "Another account's private recipe" } });
  conversationId = randomUUID(); const turnId = randomUUID();
  await db.insert(conversations).values({ id: conversationId, workspaceId: source.workspaceId, createdByUserId: source.userId, title: "Production chat", activeRunId: turnId, leaseExpiresAt: new Date(Date.now() + 60000), messages: [{ id: randomUUID(), role: "assistant", parts: [{ type: "text", text: `Read [the recipe](/recipes/${first.id}).` }] }] });
  await db.insert(conversationTurns).values({ id: turnId, conversationId, requestId: randomUUID(), status: "running" });
  await db.insert(conversationToolCalls).values({ conversationId, runId: turnId, toolCallId: randomUUID(), toolName: "updateRecipe", result: { recipeId: first.id, versionId: second.id } });
  await db.insert(aiUsage).values({ idempotencyKey: `sync-fixture-${randomUUID()}`, workspaceId: source.workspaceId, userId: source.userId, conversationId, runId: turnId, model: "anthropic/claude-sonnet-4.5", credentialSource: "app", costUsd: "0.001" });
  const sessionId = randomUUID();
  await db.insert(sessions).values({ id: sessionId, userId: source.userId, token: randomUUID(), expiresAt: new Date(Date.now() + 60000) });
  voiceId = randomUUID();
  await db.insert(voiceSessions).values({ id: voiceId, workspaceId: source.workspaceId, userId: source.userId, authSessionId: sessionId, conversationId, status: "ready", context: { route: `/recipes/${first.id}`, activeRecipeId: first.id, activeRecipeVersionId: first.version.id }, expiresAt: new Date(Date.now() + 60000), leaseExpiresAt: new Date(Date.now() + 60000) });
  const photoId = randomUUID();
  await db.insert(photos).values({ id: photoId, workspaceId: source.workspaceId, recipeId: first.id, purpose: "recipe", status: "ready", objectKey: `workspaces/${source.workspaceId}/photos/${photoId}/image.webp`, contentType: "image/webp", byteSize: 100, width: 1, height: 1, createdByUserId: source.userId });
  await db.update(recipes).set({ coverPhotoId: photoId }).where(eq(recipes.id, first.id));
});
afterAll(async () => {
  if (source) {
    await db.update(recipes).set({ currentVersionId: null }).where(inArray(recipes.workspaceId, [source.workspaceId, target.workspaceId, stranger.workspaceId]));
    await db.delete(users).where(inArray(users.id, [source.userId, target.userId, stranger.userId]));
  }
  await pool.end();
});

describe("production content sync on real PostgreSQL", () => {
  it("scopes the read-only snapshot and remaps content, pinned history, media and internal references without carrying login sessions", async () => {
    const next = await snapshot();
    expect(next.productionReadOnly).toBe(true);
    expect(next.tables.recipes).toHaveLength(1);
    expect(next.tables).not.toHaveProperty("sessions");
    expect(next.tables).not.toHaveProperty("gateway_credentials");
    const plan = await apply(next);
    expect(plan.some((action) => action.kind === "conflict")).toBe(false);
    const copiedId = mappedId(next, sourceRecipeId), copied = await getRecipe(db, target, copiedId);
    expect(copied.version.content.title).toBe("Source chili v2");
    expect(copied.favorite).toBe(true);
    expect(await listVersions(db, target, copiedId)).toHaveLength(2);
    expect((await listRecipeNotes(db, target, copiedId))[0].body).toBe("A production observation");
    const cook = await getCookingSession(db, target, mappedId(next, cookId));
    expect(cook.version.number).toBe(1);
    expect(cook.recipeId).toBe(copiedId);
    const meal = await getArtifact(db, target, mappedId(next, artifactId));
    expect(meal.content.kind === "meal-plan" && meal.content.entries[0].recipeId).toBe(copiedId);
    expect(photoCopies).toHaveLength(1);
    expect(photoCopies[0].source).toContain(source.workspaceId);
    expect(photoCopies[0].target).toContain(target.workspaceId);
    expect(photoCopies[0].target).not.toContain(source.workspaceId);
    const chat = (await db.select().from(conversations).where(eq(conversations.id, mappedId(next, conversationId))))[0];
    expect(JSON.stringify(chat.messages)).toContain(`/recipes/${copiedId}`);
    expect(chat.activeRunId).toBeNull();
    const voice = (await db.select().from(voiceSessions).where(eq(voiceSessions.id, mappedId(next, voiceId))))[0];
    expect(voice.authSessionId).toBeNull(); expect(voice.status).toBe("ended");
    expect(voice.context.activeRecipeId).toBe(copiedId);
    expect((await getRecipe(db, target, keeperId)).version.content.title).toBe("Local keeper");
    expect((await getRecipe(db, source, sourceRecipeId)).version.content.title).toBe("Source chili v2");
  });

  it("repeats without duplicates and brings a later production version into an unchanged local copy", async () => {
    const repeated = await snapshot();
    expect(planSync(repeated, await readContent(pool, repeated.target), baseline).every((action) => action.kind === "unchanged")).toBe(true);
    const current = await getRecipe(db, source, sourceRecipeId);
    await updateRecipe(db, source, sourceRecipeId, { content: { ...content, title: "Source chili v3" }, expectedVersionId: current.version.id, changeSummary: "Production revision" });
    const next = await snapshot();
    await apply(next);
    const copiedId = mappedId(next, sourceRecipeId);
    expect((await getRecipe(db, target, copiedId)).version.content.title).toBe("Source chili v3");
    expect(await listVersions(db, target, copiedId)).toHaveLength(3);
    expect(photoCopies).toHaveLength(1);
    expect(planSync(next, await readContent(pool, next.target), baseline).every((action) => action.kind === "unchanged")).toBe(true);
  });

  it("preserves local recipe edits and handles competing version numbers while still copying unrelated new content", async () => {
    const before = await snapshot(), copiedId = mappedId(before, sourceRecipeId);
    const local = await getRecipe(db, target, copiedId), remote = await getRecipe(db, source, sourceRecipeId);
    await updateRecipe(db, target, copiedId, { content: { ...content, title: "My local chili experiment" }, expectedVersionId: local.version.id, changeSummary: "Local experiment" });
    await updateRecipe(db, source, sourceRecipeId, { content: { ...content, title: "Source chili v4" }, expectedVersionId: remote.version.id, changeSummary: "Production revision" });
    const added = await createRecipe(db, source, { content: { ...content, title: "A new production recipe" } });
    const next = await snapshot(), plan = await apply(next);
    expect(plan.some((action) => action.table === "recipes" && action.row.id === copiedId && action.kind === "conflict")).toBe(true);
    expect((await getRecipe(db, target, copiedId)).version.content.title).toBe("My local chili experiment");
    expect((await getRecipe(db, source, sourceRecipeId)).version.content.title).toBe("Source chili v4");
    expect((await getRecipe(db, target, mappedId(next, added.id))).version.content.title).toBe("A new production recipe");
    expect(await listVersions(db, target, copiedId)).toHaveLength(4);
  });
});
