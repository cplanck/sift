import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { eq, inArray } from "drizzle-orm";
import sharp from "sharp";
import { connectDatabase } from "@/db/connection";
import { coverAttempts, coverRequests, photos, recipes, users } from "@/db/schema";
import { coverContentHash, coverPrompt } from "@/domain/cover";
import { chooseStepIllustration } from "@/domain/step-illustrations";
import { ensurePersonalWorkspace, type Actor } from "@/services/workspaces";
import { createRecipe, getRecipe, updateRecipe } from "@/services/recipes";
import { deleteRecipePhoto, getPhoto, listRecipePhotos, setCoverPhoto, saveImportedRecipePhoto } from "@/services/photos";
import { resumeRecipeCover, cancelRecipeCover, getRecipeCoverState, requestRecipeCover } from "@/services/cover-generation";
import { produceCover } from "@/jobs/generate-cover";
import { testDatabaseUrl } from "./database";

const mocks = vi.hoisted(() => ({ generate: vi.fn(), write: vi.fn(), original: vi.fn(), read: vi.fn() }));
vi.mock("ai", () => ({ generateImage: mocks.generate }));
vi.mock("@ai-sdk/gateway", () => ({ createGateway: () => ({ imageModel: (id: string) => id }) }));
vi.mock("@/services/credentials", () => ({ resolveGatewayCredential: async () => "test-only-key" }));
vi.mock("@/lib/r2", () => ({ r2: () => {}, MAX_PHOTO_BYTES: 8388608, writePhotoObject: mocks.write, writeUploadObject: mocks.original, deletePhotoObject: vi.fn(async () => {}), readPhotoObject: mocks.read, signPhotoUpload: vi.fn() }));
vi.mock("@/jobs/client", () => ({ requireJobs: () => {}, inngest: { createFunction: () => ({}), send: vi.fn() } }));
const { db, pool } = connectDatabase(testDatabaseUrl);
vi.mock("@/db", () => ({ database: () => db }));
const ids = [randomUUID(), randomUUID()];
let owner: Actor, outsider: Actor;
let image: Buffer;
beforeAll(async () => {
  await db.insert(users).values(ids.map((id) => ({ id, email: `${id}@example.test`, name: "Cover test" })));
  [owner, outsider] = await Promise.all(ids.map(async (userId) => ({ userId, workspaceId: await ensurePersonalWorkspace(db, userId) })));
  image = await sharp({ create: { width: 800, height: 600, channels: 3, background: "#777" } }).png().toBuffer();
});
beforeEach(() => {
  vi.stubEnv("COVER_GENERATION_ENABLED", "1"); vi.stubEnv("COVER_IMAGE_MODEL", "bfl/flux-3-image");
  vi.stubEnv("COVER_DAILY_BUDGET_USD", "100"); vi.stubEnv("COVER_REQUEST_RESERVATION_USD", "0.10");
  mocks.generate.mockReset(); mocks.write.mockReset(); mocks.original.mockReset(); mocks.read.mockReset(); mocks.read.mockResolvedValue(image);
  mocks.generate.mockResolvedValue({ image: { uint8Array: image, mediaType: "image/png" }, calls: [{ providerMetadata: { gateway: { cost: "0.025", generationId: "test-generation" } } }] });
});
afterAll(async () => {
  vi.unstubAllEnvs();
  await db.update(recipes).set({ currentVersionId: null }).where(inArray(recipes.workspaceId, [owner.workspaceId, outsider.workspaceId]));
  await db.delete(users).where(inArray(users.id, ids)); await pool.end();
});
async function recipe() {
  return createRecipe(db, owner, { content: { title: "Carrot soup", ingredientSections: [{ items: [{ text: "2 carrots" }] }], instructionSections: [{ steps: ["Simmer the carrots."] }] } });
}
async function request() {
  const saved = await recipe();
  const input = { idempotencyKey: randomUUID(), expectedVersionId: saved.version.id };
  return { saved, input, ...await requestRecipeCover(db, owner, saved.id, input) };
}
it("deduplicates starts and enforces workspace access and finite budget", async () => {
  const saved = await recipe(), input = { idempotencyKey: randomUUID(), expectedVersionId: saved.version.id };
  const results = await Promise.all([requestRecipeCover(db, owner, saved.id, input), requestRecipeCover(db, owner, saved.id, input)]);
  expect(results[0].requestId).toBe(results[1].requestId);
  await expect(getRecipeCoverState(db, outsider, saved.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
  vi.stubEnv("COVER_DAILY_BUDGET_USD", "0.10");
  const another = await recipe();
  await expect(requestRecipeCover(db, owner, another.id, { ...input, idempotencyKey: randomUUID(), expectedVersionId: another.version.id })).rejects.toMatchObject({ code: "RATE_LIMITED" });
});
it("publishes real derivatives without choosing the candidate or upscaling", async () => {
  const { saved, requestId } = await request();
  await setCoverPhoto(db, owner, saved.id, null, 0);
  await produceCover(requestId);
  const state = await getRecipeCoverState(db, owner, saved.id);
  expect(state.coverSelection).toBe("none"); expect(state.coverPhotoId).toBeNull();
  expect(state.requests[0].status).toBe("ready");
  const [photo] = await db.select().from(photos).where(eq(photos.id, state.requests[0].candidatePhotoId!));
  expect(photo.derivatives?.map((item) => [item.width, item.height])).toEqual([[320, 240], [640, 480], [800, 600]]);
  expect(photo.origin).toBe("generated");
  for (const call of mocks.write.mock.calls) expect((await sharp(call[1]).metadata()).format).toBe("webp");
  await expect(setCoverPhoto(db, owner, saved.id, photo.id, 0)).rejects.toMatchObject({ code: "CONFLICT" });
  await setCoverPhoto(db, owner, saved.id, photo.id, state.coverRevision);
  expect((await getRecipe(db, owner, saved.id)).coverPhotoId).toBe(photo.id);
});
it("retries storage from retained bytes without another provider charge", async () => {
  const { requestId } = await request();
  mocks.write.mockRejectedValueOnce(new Error("storage unavailable"));
  await expect(produceCover(requestId)).rejects.toThrow();
  await produceCover(requestId);
  expect(mocks.generate).toHaveBeenCalledTimes(1);
  const [attempt] = await db.select().from(coverAttempts).where(eq(coverAttempts.requestId, requestId));
  expect(attempt.outputBase64).toBeNull(); expect(Number(attempt.costUsd)).toBe(0.025);
});
it("never repeats ambiguous provider calls and keeps unknown cost null", async () => {
  const { requestId } = await request();
  mocks.generate.mockRejectedValue(new Error("timeout"));
  await expect(produceCover(requestId)).rejects.toThrow();
  await expect(produceCover(requestId)).rejects.toThrow();
  expect(mocks.generate).toHaveBeenCalledTimes(1);
  const [attempt] = await db.select().from(coverAttempts).where(eq(coverAttempts.requestId, requestId));
  expect(attempt.costUsd).toBeNull();
});
it("does not publish a candidate cancelled during generation", async () => {
  const { saved, requestId } = await request();
  mocks.generate.mockImplementation(async () => {
    await cancelRecipeCover(db, owner, saved.id, requestId);
    return { image: { uint8Array: image, mediaType: "image/png" }, calls: [] };
  });
  await produceCover(requestId);
  const [record] = await db.select().from(coverRequests).where(eq(coverRequests.id, requestId));
  expect(record.status).toBe("cancelled"); expect(record.candidatePhotoId).toBeNull();
});
it("marks changed recipes and preserves explicit removal when a source image arrives", async () => {
  const { saved } = await request();
  await updateRecipe(db, owner, saved.id, { expectedVersionId: saved.version.id, changeSummary: "Change dish", content: { ...saved.version.content, title: "Roasted carrots" } });
  expect((await getRecipeCoverState(db, owner, saved.id)).requests[0].basedOnEarlierRecipe).toBe(true);
  await setCoverPhoto(db, owner, saved.id, null, 0);
  await saveImportedRecipePhoto(db, owner, saved.id, image);
  expect((await getRecipe(db, owner, saved.id)).coverPhotoId).toBeNull();
});
it("bounds prompts, persists action keys, and collapses ambiguous illustrations", async () => {
  const saved = await recipe();
  expect(saved.version.content.instructionSections[0].illustrationKeys).toEqual(["simmer"]);
  expect(chooseStepIllustration("Chop, then boil the carrots.")).toBeNull();
  expect(chooseStepIllustration("Make the sauce: Whisk the ingredients.")).toBe("whisk");
  expect(chooseStepIllustration("Sauté the mushrooms.")).toBe("sauté");
  expect(chooseStepIllustration("Fry the noodles: stir constantly.")).toBe("sauté");
  expect(chooseStepIllustration("Add the rest of the ingredients.")).toBeNull();
  expect(coverContentHash(saved.version.content)).toBe(coverContentHash({ ...saved.version.content, servings: 8 }));
  expect(coverPrompt(saved.version.content)).toContain("untrusted dish description");
});

it("recovers retained output after a terminal storage failure without generating again", async () => {
  const { saved, requestId } = await request();
  mocks.write.mockRejectedValueOnce(new Error("offline"));
  await expect(produceCover(requestId)).rejects.toThrow();
  await db.update(coverRequests).set({ status: "failed" }).where(eq(coverRequests.id, requestId));
  expect((await getRecipeCoverState(db, owner, saved.id)).requests[0].retainedOutput).toBe(true);
  await resumeRecipeCover(db, owner, saved.id, requestId);
  await produceCover(requestId);
  expect(mocks.generate).toHaveBeenCalledTimes(1);
  expect((await getRecipeCoverState(db, owner, saved.id)).requests[0].status).toBe("ready");
});
it("keeps reserved spending after its draft is discarded", async () => {
  const { saved } = await request();
  await db.update(recipes).set({ currentVersionId: null }).where(eq(recipes.id, saved.id));
  await db.delete(recipes).where(eq(recipes.id, saved.id));
  vi.stubEnv("COVER_DAILY_BUDGET_USD", "0.10");
  const another = await recipe();
  await expect(requestRecipeCover(db, owner, another.id, { idempotencyKey: randomUUID(), expectedVersionId: another.version.id })).rejects.toMatchObject({ code: "RATE_LIMITED" });
});

async function originalPhoto(saved: Awaited<ReturnType<typeof recipe>>) {
  const [photo] = await db.insert(photos).values({ workspaceId: owner.workspaceId, recipeId: saved.id, purpose: "recipe", status: "ready", origin: "user", objectKey: `test/${randomUUID()}.webp`, contentType: "image/webp", byteSize: image.length, width: 800, height: 600, createdByUserId: owner.userId }).returning();
  return photo;
}
it("enhances the uploaded bytes, retains the original, and leaves cover selection to the cook", async () => {
  const saved = await recipe(), original = await originalPhoto(saved);
  await setCoverPhoto(db, owner, saved.id, original.id);
  const input = { idempotencyKey: randomUUID(), expectedVersionId: saved.version.id, sourcePhotoId: original.id };
  const { requestId } = await requestRecipeCover(db, owner, saved.id, input);
  await produceCover(requestId);
  expect(mocks.read).toHaveBeenCalledWith(original.objectKey);
  expect(mocks.generate).toHaveBeenCalledWith(expect.objectContaining({ model: "spacexai/grok-imagine-image", prompt: { images: [image], text: expect.stringContaining("Preserve the actual dish") }, maxRetries: 0 }));
  const state = await getRecipeCoverState(db, owner, saved.id);
  expect(state.requests[0]).toMatchObject({ status: "ready", sourcePhotoId: original.id });
  const gallery = await listRecipePhotos(db, owner, saved.id);
  expect(gallery).toHaveLength(2);
  const enhanced = gallery.find((photo) => photo.id !== original.id)!;
  expect(enhanced.enhanced).toBe(true);
  expect(state.coverPhotoId).toBe(original.id);
  await setCoverPhoto(db, owner, saved.id, enhanced.id, state.coverRevision);
  await deleteRecipePhoto(db, owner, original.id);
  expect((await getPhoto(db, owner, enhanced.id)).provenance?.sourcePhotoId).toBe(original.id);
  expect((await getRecipe(db, owner, saved.id)).coverPhotoId).toBe(enhanced.id);
});
it("rejects another recipe's photo, cross-workspace requests, and mismatched idempotency keys", async () => {
  const saved = await recipe(), another = await recipe(), original = await originalPhoto(saved), wrong = await originalPhoto(another);
  const input = { idempotencyKey: randomUUID(), expectedVersionId: saved.version.id, sourcePhotoId: original.id };
  await expect(requestRecipeCover(db, outsider, saved.id, input)).rejects.toMatchObject({ code: "NOT_FOUND" });
  await expect(requestRecipeCover(db, owner, saved.id, { ...input, sourcePhotoId: wrong.id })).rejects.toMatchObject({ code: "NOT_FOUND" });
  const first = await requestRecipeCover(db, owner, saved.id, input);
  expect((await requestRecipeCover(db, owner, saved.id, input)).requestId).toBe(first.requestId);
  await expect(requestRecipeCover(db, owner, saved.id, { ...input, sourcePhotoId: wrong.id })).rejects.toMatchObject({ code: "CONFLICT" });
  expect(mocks.generate).not.toHaveBeenCalled();
});
it("cancels queued enhancement when its source is deleted without calling the model", async () => {
  const saved = await recipe(), original = await originalPhoto(saved);
  const { requestId } = await requestRecipeCover(db, owner, saved.id, { idempotencyKey: randomUUID(), expectedVersionId: saved.version.id, sourcePhotoId: original.id });
  await deleteRecipePhoto(db, owner, original.id);
  await produceCover(requestId);
  expect(mocks.generate).not.toHaveBeenCalled();
  expect((await getRecipeCoverState(db, owner, saved.id)).requests[0].status).toBe("cancelled");
});
it("does not publish an enhancement if its source is deleted during the provider call", async () => {
  const saved = await recipe(), original = await originalPhoto(saved);
  const { requestId } = await requestRecipeCover(db, owner, saved.id, { idempotencyKey: randomUUID(), expectedVersionId: saved.version.id, sourcePhotoId: original.id });
  mocks.generate.mockImplementation(async () => {
    await deleteRecipePhoto(db, owner, original.id);
    return { image: { uint8Array: image, mediaType: "image/png" }, calls: [] };
  });
  await produceCover(requestId);
  expect((await getRecipeCoverState(db, owner, saved.id)).requests[0].status).toBe("cancelled");
  expect(await listRecipePhotos(db, owner, saved.id)).toHaveLength(0);
});
