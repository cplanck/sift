import { randomUUID } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import sharp from "sharp";
import { z } from "zod";
import type { Database } from "@/db/connection";
import { photos, recipes } from "@/db/schema";
import { DomainError } from "@/domain/errors";
import { deletePhotoObject, MAX_PHOTO_BYTES, r2, readPhotoObject, signPhotoUpload, writePhotoObject } from "@/lib/r2";
import { assertMembership, type Actor } from "./workspaces";
import { getRecipe } from "./recipes";
import { consumeLimit } from "./rate-limit";
import { assertCookingSessionOwner } from "./cooking";

const uploadSchema = z.object({
  recipeId: z.uuid().optional(), sessionId: z.uuid().optional(), purpose: z.enum(["recipe", "import", "cooking"]),
  contentType: z.enum(["image/jpeg", "image/png", "image/webp"]), byteSize: z.number().int().positive().max(MAX_PHOTO_BYTES),
}).strict().refine((data) => data.purpose === "recipe" ? !!data.recipeId && !data.sessionId : data.purpose === "cooking" ? !!data.sessionId && !data.recipeId : !data.recipeId && !data.sessionId, "Choose a recipe or cooking session appropriate to this photo.");

export async function preparePhotoUpload(db: Database, actor: Actor, input: unknown) {
  const data = uploadSchema.parse(input);
  await assertMembership(db, actor);
  if (data.recipeId) await getRecipe(db, actor, data.recipeId);
  const session = data.sessionId ? await assertCookingSessionOwner(db, actor, data.sessionId) : null;
  r2(); // Validate provider settings before reserving an upload.
  await consumeLimit(db, actor, "photo", 60);
  const id = randomUUID(), objectKey = `uploads/workspaces/${actor.workspaceId}/${id}`;
  const url = await signPhotoUpload(objectKey, data.contentType, data.byteSize);
  await db.insert(photos).values({ id, workspaceId: actor.workspaceId, recipeId: session?.recipeId ?? data.recipeId, sessionId: session?.id, purpose: data.purpose, objectKey, contentType: data.contentType, byteSize: data.byteSize, createdByUserId: actor.userId });
  return { id, url, expiresIn: 300 };
}

export async function getPhoto(db: Database, actor: Actor, id: string) {
  await assertMembership(db, actor);
  if (!z.uuid().safeParse(id).success) throw new DomainError("NOT_FOUND", "Photo not found.");
  const [photo] = await db.select().from(photos).where(and(eq(photos.id, id), eq(photos.workspaceId, actor.workspaceId)));
  if (!photo) throw new DomainError("NOT_FOUND", "Photo not found.");
  return photo;
}

export async function normalizePhoto(bytes: Uint8Array) {
  try {
    const source = sharp(bytes, { limitInputPixels: 40_000_000, animated: false });
    const metadata = await source.metadata();
    if (!["jpeg", "png", "webp"].includes(metadata.format ?? "")) throw new Error("Unsupported format");
    const result = await source.rotate().resize(2048, 2048, { fit: "inside", withoutEnlargement: true }).webp({ quality: 85 }).toBuffer({ resolveWithObject: true });
    return { bytes: result.data, width: result.info.width, height: result.info.height };
  } catch { throw new DomainError("INVALID_INPUT", "This file isn’t a supported photo. Choose a JPEG, PNG, or WebP image."); }
}

export async function finishPhotoUpload(db: Database, actor: Actor, id: string) {
  const photo = await getPhoto(db, actor, id);
  if (photo.purpose === "cooking") {
    if (!photo.sessionId) throw new DomainError("NOT_FOUND", "Cooking photo not found.");
    await assertCookingSessionOwner(db, actor, photo.sessionId);
  }
  if (photo.status === "ready") return { id: photo.id };
  await consumeLimit(db, actor, "photo_finalize", 60);
  const original = await readPhotoObject(photo.objectKey);
  if (original.byteLength !== photo.byteSize) throw new DomainError("INVALID_INPUT", "The uploaded file size changed. Please upload it again.");
  const normalized = await normalizePhoto(original);
  // Final objects use a separate key never covered by a client upload signature.
  const objectKey = `workspaces/${actor.workspaceId}/photos/${photo.id}/${randomUUID()}.webp`;
  await writePhotoObject(objectKey, normalized.bytes);
  let published: boolean | null = null;
  try {
    published = await db.transaction(async (tx) => {
      await assertMembership(tx, actor);
      const [current] = await tx.select().from(photos).where(and(eq(photos.id, id), eq(photos.workspaceId, actor.workspaceId))).for("update");
      if (!current) throw new DomainError("NOT_FOUND", "Photo not found.");
      if (current.purpose === "cooking") await assertCookingSessionOwner(tx, actor, current.sessionId!);
      if (current.status === "ready") return false;
      await tx.update(photos).set({ status: "ready", objectKey, contentType: "image/webp", byteSize: normalized.bytes.byteLength, width: normalized.width, height: normalized.height }).where(and(eq(photos.id, id), eq(photos.workspaceId, actor.workspaceId)));
      if (photo.recipeId && photo.purpose === "recipe") await tx.update(recipes).set({ coverPhotoId: photo.id }).where(and(eq(recipes.id, photo.recipeId), eq(recipes.workspaceId, actor.workspaceId), isNull(recipes.coverPhotoId)));
      return true;
    });
  } finally {
    // Concurrent finalizers cannot overwrite a published image. Clean up losing attempts.
    // An ambiguous commit failure must not delete a possibly-published object.
    if (published === false) await deletePhotoObject(objectKey).catch(() => {});
  }
  await deletePhotoObject(photo.objectKey).catch(() => { /* R2 lifecycle removes abandoned temporary uploads. */ });
  return { id: photo.id };
}

export async function listRecipePhotos(db: Database, actor: Actor, recipeId: string) {
  await getRecipe(db, actor, recipeId);
  return db.select({ id: photos.id, width: photos.width, height: photos.height, createdAt: photos.createdAt }).from(photos).where(and(eq(photos.workspaceId, actor.workspaceId), eq(photos.recipeId, recipeId), eq(photos.purpose, "recipe"), eq(photos.status, "ready")));
}

export async function setCoverPhoto(db: Database, actor: Actor, recipeId: string, photoId: string) {
  await getRecipe(db, actor, recipeId);
  const photo = await getPhoto(db, actor, photoId);
  if (photo.recipeId !== recipeId || photo.purpose !== "recipe" || photo.status !== "ready") throw new DomainError("NOT_FOUND", "Recipe photo not found.");
  await db.update(recipes).set({ coverPhotoId: photo.id, updatedAt: new Date(), updatedByUserId: actor.userId }).where(and(eq(recipes.id, recipeId), eq(recipes.workspaceId, actor.workspaceId)));
  return { coverPhotoId: photo.id };
}
