import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq, inArray, like } from "drizzle-orm";
import sharp from "sharp";
import { connectDatabase } from "@/db/connection";
import { photos, recipes, usageLimits, users } from "@/db/schema";
import { ensurePersonalWorkspace, type Actor } from "@/services/workspaces";
import { createRecipe, getRecipe } from "@/services/recipes";
import { deleteRecipePhoto, finishPhotoUpload, getPhoto, listRecipePhotos, normalizePhoto, preparePhotoUpload, receivePhotoUpload, setCoverPhoto } from "@/services/photos";
import { testDatabaseUrl } from "./database";

// Only R2's external transport is mocked here. Authorization, transactions,
// metadata, image decoding, and normalization use real PostgreSQL and Sharp.
const storage = vi.hoisted(() => ({ r2: vi.fn(), signPhotoUpload: vi.fn(), readPhotoObject: vi.fn(), writePhotoObject: vi.fn(), writeUploadObject: vi.fn(), deletePhotoObject: vi.fn() }));
vi.mock("@/lib/r2", () => ({ ...storage, MAX_PHOTO_BYTES: 8 * 1024 * 1024 }));
const { db, pool } = connectDatabase(testDatabaseUrl);
const userIds = [randomUUID(), randomUUID()];
let actorA: Actor, actorB: Actor;
let png: Buffer;
const content = { title: "Photo recipe", ingredientSections: [{ items: [{ text: "2 eggs" }] }], instructionSections: [{ steps: ["Scramble gently."] }] };

beforeAll(async () => {
  await db.insert(users).values(userIds.map((id) => ({ id, email: `${id}@example.test`, name: "Photo test cook" })));
  [actorA, actorB] = await Promise.all(userIds.map(async (userId) => ({ userId, workspaceId: await ensurePersonalWorkspace(db, userId) })));
  png = await sharp({ create: { width: 40, height: 20, channels: 3, background: "#888888" } }).png().toBuffer();
});
beforeEach(() => {
  vi.resetAllMocks();
  storage.signPhotoUpload.mockResolvedValue("https://r2.example.test/signed-upload");
  storage.readPhotoObject.mockImplementation(async () => png);
  storage.writePhotoObject.mockResolvedValue(undefined);
  storage.deletePhotoObject.mockResolvedValue(undefined);
  storage.writeUploadObject.mockResolvedValue(undefined);
});
afterAll(async () => {
  await db.update(recipes).set({ currentVersionId: null }).where(inArray(recipes.workspaceId, [actorA.workspaceId, actorB.workspaceId]));
  await db.delete(users).where(inArray(users.id, userIds));
  await pool.end();
});

async function pendingPhoto(actor: Actor, recipeId?: string) {
  const [photo] = await db.insert(photos).values({ workspaceId: actor.workspaceId, createdByUserId: actor.userId, recipeId, purpose: recipeId ? "recipe" : "import", objectKey: `uploads/workspaces/${actor.workspaceId}/${randomUUID()}`, contentType: "image/png", byteSize: png.byteLength }).returning();
  return photo;
}

describe("real photo decoding", () => {
  it("decodes permitted formats and outputs clean WebP within display bounds", async () => {
    const large = await sharp({ create: { width: 2400, height: 600, channels: 3, background: "#888888" } }).jpeg().toBuffer();
    const result = await normalizePhoto(large);
    expect(result).toMatchObject({ width: 2048, height: 512 });
    expect(await sharp(result.bytes).metadata()).toMatchObject({ format: "webp", width: 2048, height: 512 });
    for (const bytes of [png, await sharp(png).webp().toBuffer()]) {
      const small = await normalizePhoto(bytes);
      expect(small).toMatchObject({ width: 40, height: 20 });
    }
  });

  it("applies orientation and strips source metadata", async () => {
    const original = await sharp(png).jpeg().withMetadata({ orientation: 6 }).toBuffer();
    const result = await normalizePhoto(original);
    expect(result).toMatchObject({ width: 20, height: 40 });
    const metadata = await sharp(result.bytes).metadata();
    expect(metadata.orientation).toBeUndefined();
    expect(metadata.exif).toBeUndefined();
  });

  it("rejects fake images, truncated images, and executable SVG content", async () => {
    const invalid = [Buffer.from("not a photograph"), png.subarray(0, 20), Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><script>alert(1)</script></svg>')];
    for (const bytes of invalid) await expect(normalizePhoto(bytes)).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });
});

describe("photo services with real DB and isolated R2 transport", () => {
  it("authorizes workspace and recipe before configuration, signing, download, or upload", async () => {
    const recipe = await createRecipe(db, actorB, { content });
    const photo = await pendingPhoto(actorB, recipe.id);
    const forged = { userId: actorA.userId, workspaceId: actorB.workspaceId };
    const operations = [
      () => preparePhotoUpload(db, actorA, { purpose: "recipe", recipeId: recipe.id, contentType: "image/png", byteSize: png.byteLength }),
      () => preparePhotoUpload(db, forged, { purpose: "import", contentType: "image/png", byteSize: png.byteLength }),
      () => getPhoto(db, actorA, photo.id),
      () => finishPhotoUpload(db, actorA, photo.id),
      () => finishPhotoUpload(db, forged, photo.id),
      () => listRecipePhotos(db, actorA, recipe.id),
      () => setCoverPhoto(db, actorA, recipe.id, photo.id),
    ];
    for (const operation of operations) await expect(operation()).rejects.toMatchObject({ code: "NOT_FOUND" });
    for (const mock of Object.values(storage)) expect(mock).not.toHaveBeenCalled();
  });

  it("reserves a signed temporary upload in its authorized workspace, then publishes normalized bytes", async () => {
    const recipe = await createRecipe(db, actorA, { content });
    const upload = await preparePhotoUpload(db, actorA, { purpose: "recipe", recipeId: recipe.id, contentType: "image/png", byteSize: png.byteLength });
    const pending = await getPhoto(db, actorA, upload.id);
    expect(pending.objectKey).toBe(`uploads/workspaces/${actorA.workspaceId}/${upload.id}`);
    expect(storage.signPhotoUpload).toHaveBeenCalledWith(pending.objectKey, "image/png", png.byteLength);
    expect(pending.status).toBe("pending");
    expect(upload.expiresIn).toBe(300);
    await finishPhotoUpload(db, actorA, upload.id);
    const ready = await getPhoto(db, actorA, upload.id);
    expect(ready).toMatchObject({ status: "ready", contentType: "image/webp", width: 40, height: 20 });
    expect(ready.objectKey).toMatch(new RegExp(`^workspaces/${actorA.workspaceId}/photos/${upload.id}/.+\\.webp$`));
    expect(storage.writePhotoObject).toHaveBeenCalledWith(ready.objectKey, expect.any(Buffer));
    expect(storage.deletePhotoObject).toHaveBeenCalledWith(pending.objectKey);
    expect((await getRecipe(db, actorA, recipe.id)).coverPhotoId).toBe(upload.id);
    expect((await listRecipePhotos(db, actorA, recipe.id)).map((photo) => photo.id)).toEqual([upload.id]);
    await finishPhotoUpload(db, actorA, upload.id);
    expect(storage.readPhotoObject).toHaveBeenCalledTimes(1);
    expect(storage.writePhotoObject).toHaveBeenCalledTimes(1);
  });

  it("publishes one immutable object under concurrent finalizers and deletes only the losing output", async () => {
    const photo = await pendingPhoto(actorA);
    let release!: () => void;
    const bothReading = new Promise<void>((resolve) => { release = resolve; });
    let reads = 0;
    storage.readPhotoObject.mockImplementation(async () => { if (++reads === 2) release(); await bothReading; return png; });
    const results = await Promise.all([finishPhotoUpload(db, actorA, photo.id), finishPhotoUpload(db, actorA, photo.id)]);
    expect(results).toEqual([{ id: photo.id }, { id: photo.id }]);
    expect(storage.writePhotoObject).toHaveBeenCalledTimes(2);
    const outputKeys = storage.writePhotoObject.mock.calls.map(([key]) => key as string);
    expect(new Set(outputKeys).size).toBe(2);
    const published = await getPhoto(db, actorA, photo.id);
    expect(outputKeys).toContain(published.objectKey);
    const loser = outputKeys.find((key) => key !== published.objectKey)!;
    expect(storage.deletePhotoObject).toHaveBeenCalledWith(loser);
    expect(storage.deletePhotoObject).not.toHaveBeenCalledWith(published.objectKey);
  });

  it("does not publish mismatched upload sizes or invalid image bodies", async () => {
    const photo = await pendingPhoto(actorA);
    storage.readPhotoObject.mockResolvedValueOnce(Buffer.from("wrong length"));
    await expect(finishPhotoUpload(db, actorA, photo.id)).rejects.toMatchObject({ code: "INVALID_INPUT" });
    storage.readPhotoObject.mockResolvedValueOnce(Buffer.alloc(png.byteLength));
    await expect(finishPhotoUpload(db, actorA, photo.id)).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(storage.writePhotoObject).not.toHaveBeenCalled();
    expect((await getPhoto(db, actorA, photo.id)).status).toBe("pending");
  });

  it("restricts cover changes to ready canonical photos of that exact recipe", async () => {
    const first = await createRecipe(db, actorA, { content });
    const second = await createRecipe(db, actorA, { content });
    const photo = await pendingPhoto(actorA, first.id);
    await expect(setCoverPhoto(db, actorA, first.id, photo.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await finishPhotoUpload(db, actorA, photo.id);
    await expect(setCoverPhoto(db, actorA, second.id, photo.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(setCoverPhoto(db, actorA, first.id, photo.id)).resolves.toMatchObject({ coverPhotoId: photo.id });
    expect((await getRecipe(db, actorA, second.id)).coverPhotoId).toBeNull();
  });

  it("limits repeated finalization before fetching or decoding provider bytes", async () => {
    const photo = await pendingPhoto(actorA);
    const window = Math.floor(Date.now() / 3600000);
    await db.delete(usageLimits).where(like(usageLimits.key, `${actorA.userId}:photo_finalize:%`));
    await db.insert(usageLimits).values({ key: `${actorA.userId}:photo_finalize:${window}`, userId: actorA.userId, count: 60, expiresAt: new Date((window + 1) * 3600000) });
    try {
      await expect(finishPhotoUpload(db, actorA, photo.id)).rejects.toMatchObject({ code: "RATE_LIMITED" });
      expect(storage.readPhotoObject).not.toHaveBeenCalled();
      expect(storage.writePhotoObject).not.toHaveBeenCalled();
    } finally { await db.delete(usageLimits).where(like(usageLimits.key, `${actorA.userId}:photo_finalize:%`)); }
  });

  it("accepts uploads through Sift itself, so storage needs no browser CORS rules", async () => {
    const recipe = await createRecipe(db, actorA, { content, source: { type: "manual" }, status: "active" });
    const photo = await pendingPhoto(actorA, recipe.id);
    await expect(receivePhotoUpload(db, actorB, photo.id, png)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(receivePhotoUpload(db, actorA, photo.id, png.subarray(1))).rejects.toMatchObject({ code: "INVALID_INPUT" });
    storage.writeUploadObject.mockClear();
    await receivePhotoUpload(db, actorA, photo.id, png);
    expect(storage.writeUploadObject).toHaveBeenCalledWith(photo.objectKey, png, "image/png");
    expect((await getPhoto(db, actorA, photo.id)).status).toBe("ready");
    expect((await getRecipe(db, actorA, recipe.id)).coverPhotoId).toBe(photo.id);
    // A repeated request after success is a no-op, not a second write.
    storage.writeUploadObject.mockClear();
    await receivePhotoUpload(db, actorA, photo.id, png);
    expect(storage.writeUploadObject).not.toHaveBeenCalled();
  });
});

it("deletes a current cover and all its variants only inside the authorized workspace", async () => {
  const recipe = await createRecipe(db, actorA, { content });
  const pending = await pendingPhoto(actorA, recipe.id);
  await finishPhotoUpload(db, actorA, pending.id);
  await db.update(photos).set({ originalObjectKey: "test/original.png", derivatives: [{ objectKey: "test/320.webp", width: 320, height: 240 }] }).where(eq(photos.id, pending.id));
  const photo = await getPhoto(db, actorA, pending.id), before = await getRecipe(db, actorA, recipe.id);
  storage.deletePhotoObject.mockClear();
  await expect(deleteRecipePhoto(db, actorB, photo.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
  expect(storage.deletePhotoObject).not.toHaveBeenCalled();
  await deleteRecipePhoto(db, actorA, photo.id);
  await expect(getPhoto(db, actorA, photo.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
  expect(await listRecipePhotos(db, actorA, recipe.id)).toHaveLength(0);
  expect(await getRecipe(db, actorA, recipe.id)).toMatchObject({ coverPhotoId: null, coverSelection: "none", coverRevision: before.coverRevision + 1 });
  expect(storage.deletePhotoObject.mock.calls.map(([key]) => key)).toEqual(expect.arrayContaining([photo.objectKey, "test/original.png", "test/320.webp"]));
  await expect(setCoverPhoto(db, actorA, recipe.id, photo.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
});
