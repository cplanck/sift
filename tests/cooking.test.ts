import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import sharp from "sharp";
import { connectDatabase } from "@/db/connection";
import { recipes, users, workspaceMembers } from "@/db/schema";
import { createRecipe, getRecipe, listRecipeNotes, listVersions, restoreVersion, setRecipeStatus, updateRecipe } from "@/services/recipes";
import { addCookingSessionNote, finishCookingSession, getActiveCookingSession, getCookingSession, listCookingHistory, startCookingSession, updateCookingProgress } from "@/services/cooking";
import { finishPhotoUpload, getPhoto, listRecipePhotos, preparePhotoUpload, setCoverPhoto } from "@/services/photos";
import { ensurePersonalWorkspace, type Actor } from "@/services/workspaces";
import { testDatabaseUrl } from "./database";

const { db, pool } = connectDatabase(testDatabaseUrl);
const userIds = [randomUUID(), randomUUID(), randomUUID()];
let actorA: Actor, actorB: Actor, fellowCook: Actor;
let png: Buffer;
// Only object storage transport is mocked. Session authorization, photo
// metadata, canonical separation, decoding, and transactions are real.
const storage = vi.hoisted(() => ({ r2: vi.fn(), signPhotoUpload: vi.fn(), readPhotoObject: vi.fn(), writePhotoObject: vi.fn(), deletePhotoObject: vi.fn() }));
vi.mock("@/lib/r2", () => ({ ...storage, MAX_PHOTO_BYTES: 8 * 1024 * 1024 }));
const content = {
  title: "Countertop soup", servings: 4,
  ingredientSections: [{ name: "Soup", items: [{ text: "½ tsp salt" }, { text: "2–3 carrots" }] }, { name: "To serve", items: [{ text: "Pepper to taste" }] }],
  instructionSections: [{ name: "Prepare", steps: ["Chop the carrots."] }, { name: "Cook", steps: ["Simmer gently.", "Season and serve."] }],
};

beforeAll(async () => {
  await db.insert(users).values(userIds.map((id) => ({ id, email: `${id}@example.test`, name: "Cooking test cook" })));
  [actorA, actorB] = await Promise.all(userIds.slice(0, 2).map(async (userId) => ({ userId, workspaceId: await ensurePersonalWorkspace(db, userId) })));
  fellowCook = { userId: userIds[2], workspaceId: actorA.workspaceId };
  await db.insert(workspaceMembers).values({ ...fellowCook, role: "member" });
  png = await sharp({ create: { width: 32, height: 24, channels: 3, background: "#999999" } }).png().toBuffer();
});
beforeEach(() => {
  vi.resetAllMocks();
  storage.signPhotoUpload.mockResolvedValue("https://r2.example.test/signed-upload");
  storage.readPhotoObject.mockImplementation(async () => png);
  storage.writePhotoObject.mockResolvedValue(undefined);
  storage.deletePhotoObject.mockResolvedValue(undefined);
});
afterAll(async () => {
  await db.update(recipes).set({ currentVersionId: null }).where(inArray(recipes.workspaceId, [actorA.workspaceId, actorB.workspaceId]));
  await db.delete(users).where(inArray(users.id, userIds));
  await pool.end();
});

describe("Cooking services with PostgreSQL", () => {
  it("does not create a cook merely from viewing its recipe or history", async () => {
    const recipe = await createRecipe(db, actorA, { content });
    await getRecipe(db, actorA, recipe.id);
    expect(await listCookingHistory(db, actorA, recipe.id)).toEqual([]);
    expect(await getActiveCookingSession(db, actorA, recipe.id)).toBeNull();
  });

  it("coalesces concurrent start taps while pinning a cook to its exact immutable version", async () => {
    const recipe = await createRecipe(db, actorA, { content });
    const input = { recipeId: recipe.id, expectedVersionId: recipe.version.id, servings: 6 };
    const sessions = await Promise.all(Array.from({ length: 4 }, () => startCookingSession(db, actorA, input)));
    expect(new Set(sessions.map((session) => session.id)).size).toBe(1);
    const session = sessions[0];
    expect(session).toMatchObject({ recipeVersionId: recipe.version.id, status: "active", servings: 6, revision: 1, progress: { checkedIngredients: [], checkedSteps: [], currentStep: 0 } });
    const edited = await updateRecipe(db, actorA, recipe.id, { expectedVersionId: recipe.version.id, content: { ...recipe.version.content, title: "New soup", servings: 8 }, changeSummary: "Later edit" });
    await restoreVersion(db, actorA, recipe.id, { expectedVersionId: edited.id, versionId: recipe.version.id });
    expect((await getCookingSession(db, actorA, session.id)).version).toEqual({ id: recipe.version.id, number: 1, content: recipe.version.content });
    const resumed = await startCookingSession(db, actorA, { ...input, expectedVersionId: edited.id, servings: 2 });
    expect(resumed).toMatchObject({ id: session.id, servings: 6, recipeVersionId: recipe.version.id });
    expect(await listCookingHistory(db, actorA, recipe.id)).toHaveLength(1);
    const otherCook = await startCookingSession(db, fellowCook, { recipeId: recipe.id, expectedVersionId: (await getRecipe(db, actorA, recipe.id)).version.id });
    expect(otherCook.id).not.toBe(session.id);
    expect((await getActiveCookingSession(db, fellowCook, recipe.id))?.id).toBe(otherCook.id);
  });

  it("rejects unreviewed, archived, stale, and foreign versions before starting", async () => {
    const draft = await createRecipe(db, actorA, { content, status: "draft" });
    await expect(startCookingSession(db, actorA, { recipeId: draft.id, expectedVersionId: draft.version.id })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    const recipe = await createRecipe(db, actorA, { content });
    await setRecipeStatus(db, actorA, recipe.id, "archived");
    await expect(startCookingSession(db, actorA, { recipeId: recipe.id, expectedVersionId: recipe.version.id })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await setRecipeStatus(db, actorA, recipe.id, "active");
    const current = await updateRecipe(db, actorA, recipe.id, { expectedVersionId: recipe.version.id, content, changeSummary: "A later version" });
    for (const expectedVersionId of [recipe.version.id, draft.version.id, randomUUID()]) {
      await expect(startCookingSession(db, actorA, { recipeId: recipe.id, expectedVersionId })).rejects.toMatchObject({ code: "CONFLICT" });
    }
    expect((await startCookingSession(db, actorA, { recipeId: recipe.id, expectedVersionId: current.id })).recipeVersionId).toBe(current.id);
  });

  it("checks progress against the pinned sections and prevents concurrent lost changes", async () => {
    const recipe = await createRecipe(db, actorA, { content });
    const session = await startCookingSession(db, actorA, { recipeId: recipe.id, expectedVersionId: recipe.version.id });
    const progress = { checkedIngredients: ["0:1", "1:0", "0:1"], checkedSteps: ["0:0"], currentStep: 1 };
    const saved = await updateCookingProgress(db, actorA, session.id, { expectedRevision: 1, progress, servings: 7 });
    expect(saved).toMatchObject({ revision: 2, servings: 7, progress: { ...progress, checkedIngredients: ["0:1", "1:0"] } });
    for (const invalid of [
      { ...saved.progress, checkedIngredients: ["3:0"] },
      { ...saved.progress, checkedSteps: ["1:2"] },
      { ...saved.progress, currentStep: 3 },
    ]) await expect(updateCookingProgress(db, actorA, session.id, { expectedRevision: 2, progress: invalid })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    const attempts = await Promise.allSettled([0, 2].map((currentStep) => updateCookingProgress(db, actorA, session.id, { expectedRevision: 2, progress: { ...saved.progress, currentStep } })));
    expect(attempts.filter((attempt) => attempt.status === "fulfilled")).toHaveLength(1);
    expect(attempts.find((attempt) => attempt.status === "rejected")).toMatchObject({ reason: { code: "CONFLICT" } });
    const final = await getCookingSession(db, actorA, session.id);
    expect(final.revision).toBe(3);
    expect(final.progress.checkedIngredients).toEqual(["0:1", "1:0"]);
    expect((await getRecipe(db, actorA, recipe.id)).version.content.servings).toBe(4);
  });

  it("keeps observations with this cook and finishes with optional wrap-up and idempotent retries", async () => {
    const recipe = await createRecipe(db, actorA, { content });
    const session = await startCookingSession(db, actorA, { recipeId: recipe.id, expectedVersionId: recipe.version.id });
    await addCookingSessionNote(db, actorA, session.id, { body: "This batch needed more salt." });
    expect(await listRecipeNotes(db, actorA, recipe.id)).toEqual([]);
    expect(await listVersions(db, actorA, recipe.id)).toHaveLength(1);
    const completion = { expectedRevision: 1, status: "completed" };
    const results = await Promise.all([finishCookingSession(db, actorA, session.id, completion), finishCookingSession(db, actorA, session.id, completion)]);
    expect(results[0]).toEqual(results[1]);
    expect(results[0]).toMatchObject({ status: "completed", revision: 2, rating: null, summary: null });
    expect(results[0].finishedAt).toEqual(expect.any(String));
    expect(results[0].notes.map((note) => note.body)).toEqual(["This batch needed more salt."]);
    await expect(finishCookingSession(db, actorA, session.id, { ...completion, rating: 5 })).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(updateCookingProgress(db, actorA, session.id, { expectedRevision: 2, progress: session.progress })).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await getActiveCookingSession(db, actorA, recipe.id)).toBeNull();
    await addCookingSessionNote(db, actorA, session.id, { body: "The leftovers were good." });
    const next = await startCookingSession(db, actorA, { recipeId: recipe.id, expectedVersionId: recipe.version.id });
    expect(next.id).not.toBe(session.id);
    await finishCookingSession(db, actorA, next.id, { expectedRevision: 1, status: "abandoned", summary: "Plans changed." });
    expect((await listCookingHistory(db, actorA, recipe.id)).map((cook) => cook.status)).toEqual(["abandoned", "completed"]);
    expect(await listVersions(db, actorA, recipe.id)).toHaveLength(1);
  });

  it("allows workspace history reads while restricting every mutation to the starter", async () => {
    const recipe = await createRecipe(db, actorA, { content });
    const session = await startCookingSession(db, actorA, { recipeId: recipe.id, expectedVersionId: recipe.version.id });
    expect((await getCookingSession(db, fellowCook, session.id)).id).toBe(session.id);
    expect(await listCookingHistory(db, fellowCook, recipe.id)).toHaveLength(1);
    for (const actor of [actorB, fellowCook, { userId: actorB.userId, workspaceId: actorA.workspaceId }]) {
      await expect(updateCookingProgress(db, actor, session.id, { expectedRevision: 1, progress: session.progress })).rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(finishCookingSession(db, actor, session.id, { expectedRevision: 1, status: "completed" })).rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(addCookingSessionNote(db, actor, session.id, { body: "Unauthorized" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    }
    await expect(getCookingSession(db, actorB, session.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await db.delete(workspaceMembers).where(and(eq(workspaceMembers.workspaceId, fellowCook.workspaceId), eq(workspaceMembers.userId, fellowCook.userId)));
    try { await expect(getCookingSession(db, fellowCook, session.id)).rejects.toMatchObject({ code: "NOT_FOUND" }); }
    finally { await db.insert(workspaceMembers).values({ ...fellowCook, role: "member" }); }
    expect((await getCookingSession(db, actorA, session.id)).status).toBe("active");
  });

  it("authorizes recipe ownership and membership before starting or listing cooks", async () => {
    const recipe = await createRecipe(db, actorB, { content });
    const forged = { userId: actorA.userId, workspaceId: actorB.workspaceId };
    for (const actor of [actorA, forged]) {
      await expect(startCookingSession(db, actor, { recipeId: recipe.id, expectedVersionId: recipe.version.id })).rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(listCookingHistory(db, actor, recipe.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    }
  });

  it("stores cook photos independently of canonical recipe photos and covers", async () => {
    const recipe = await createRecipe(db, actorA, { content });
    const session = await startCookingSession(db, actorA, { recipeId: recipe.id, expectedVersionId: recipe.version.id });
    const upload = await preparePhotoUpload(db, actorA, { purpose: "cooking", sessionId: session.id, contentType: "image/png", byteSize: png.byteLength });
    await finishPhotoUpload(db, actorA, upload.id);
    const photo = await getPhoto(db, actorA, upload.id);
    expect(photo).toMatchObject({ purpose: "cooking", sessionId: session.id, status: "ready" });
    expect((await getCookingSession(db, actorA, session.id)).photos.map((image) => image.id)).toEqual([photo.id]);
    expect((await getRecipe(db, actorA, recipe.id)).coverPhotoId).toBeNull();
    expect((await listRecipePhotos(db, actorA, recipe.id)).map((image) => image.id)).toEqual([photo.id]);
    await setCoverPhoto(db, actorA, recipe.id, photo.id);
    const coverId = (await getRecipe(db, actorA, recipe.id)).coverPhotoId!;
    expect(coverId).not.toBe(photo.id);
    expect(await getPhoto(db, actorA, coverId)).toMatchObject({ purpose: "recipe", sessionId: null });
    expect(await getPhoto(db, actorA, photo.id)).toMatchObject({ purpose: "cooking", sessionId: session.id });
    expect(await listVersions(db, actorA, recipe.id)).toHaveLength(1);
  });

  it("authorizes cook photo writes before provider access and rechecks finalization ownership", async () => {
    const recipe = await createRecipe(db, actorA, { content });
    const session = await startCookingSession(db, actorA, { recipeId: recipe.id, expectedVersionId: recipe.version.id });
    const input = { purpose: "cooking", sessionId: session.id, contentType: "image/png", byteSize: png.byteLength };
    for (const actor of [actorB, fellowCook]) await expect(preparePhotoUpload(db, actor, input)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(storage.r2).not.toHaveBeenCalled();
    expect(storage.signPhotoUpload).not.toHaveBeenCalled();
    const upload = await preparePhotoUpload(db, actorA, input);
    for (const actor of [actorB, fellowCook]) await expect(finishPhotoUpload(db, actor, upload.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(storage.readPhotoObject).not.toHaveBeenCalled();
    expect(storage.writePhotoObject).not.toHaveBeenCalled();
    await db.delete(workspaceMembers).where(and(eq(workspaceMembers.workspaceId, actorA.workspaceId), eq(workspaceMembers.userId, actorA.userId)));
    try { await expect(finishPhotoUpload(db, actorA, upload.id)).rejects.toMatchObject({ code: "NOT_FOUND" }); }
    finally { await db.insert(workspaceMembers).values({ ...actorA, role: "owner" }); }
    expect(storage.readPhotoObject).not.toHaveBeenCalled();
  });
});
