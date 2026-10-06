import { randomUUID } from "node:crypto";
import { and, eq, isNull, inArray, sql } from "drizzle-orm";
import sharp from "sharp";
import { z } from "zod";
import type { Database, Executor } from "@/db/connection";
import { coverAttempts, coverRequests, photos, recipes } from "@/db/schema";
import { DomainError } from "@/domain/errors";
import { deletePhotoObject, MAX_PHOTO_BYTES, r2, readPhotoObject, signPhotoUpload, writePhotoObject, writeUploadObject } from "@/lib/r2";
import { assertMembership, type Actor } from "./workspaces";
import { getRecipe } from "./recipes";
import { consumeLimit } from "./rate-limit";
import { assertCookingSessionOwner } from "./cooking";

const uploadSchema = z.object({
  recipeId: z.uuid().optional(), sessionId: z.uuid().optional(), purpose: z.enum(["recipe", "import", "cooking", "chat"]),
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

/**
 * Stores an upload that came through Sift's own server (same origin, so the
 * bucket needs no browser CORS rules), then finalizes it like a direct upload.
 */
export async function receivePhotoUpload(db: Database, actor: Actor, id: string, bytes: Uint8Array) {
  const photo = await getPhoto(db, actor, id);
  if (photo.createdByUserId !== actor.userId) throw new DomainError("NOT_FOUND", "Photo not found.");
  if (photo.status === "ready") return { id: photo.id };
  if (bytes.byteLength !== photo.byteSize) throw new DomainError("INVALID_INPUT", "The uploaded file size changed. Please upload it again.");
  await writeUploadObject(photo.objectKey, bytes, photo.contentType);
  return finishPhotoUpload(db, actor, id);
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
      if (photo.recipeId && photo.purpose === "recipe") await tx.update(recipes).set({ coverPhotoId: photo.id, coverRevision: sql`${recipes.coverRevision} + 1` }).where(and(eq(recipes.id, photo.recipeId), eq(recipes.workspaceId, actor.workspaceId), isNull(recipes.coverPhotoId), eq(recipes.coverSelection, "auto")));
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

/** Photos sent in chat belong to their uploader until moved onto a recipe or cook. */
export async function assertChatPhoto(db: Executor, actor: Actor, id: string) {
  await assertMembership(db, actor);
  if (!z.uuid().safeParse(id).success) throw new DomainError("NOT_FOUND", "Photo not found.");
  const [photo] = await db.select().from(photos).where(and(eq(photos.id, id), eq(photos.workspaceId, actor.workspaceId)));
  if (!photo || photo.createdByUserId !== actor.userId || photo.status !== "ready" || !["chat", "recipe", "cooking"].includes(photo.purpose)) throw new DomainError("NOT_FOUND", "That photo isn’t available. Attach it again.");
  return photo;
}

/** Moves a chat photo onto a recipe (optionally as its cover) or onto the user's own cook. */
export async function attachChatPhoto(db: Database, actor: Actor, id: string, target: { recipeId: string; makeCover?: boolean } | { sessionId: string }) {
  return db.transaction(async (tx) => {
    const photo = await assertChatPhoto(tx, actor, id);
    if (photo.purpose !== "chat") throw new DomainError("INVALID_INPUT", "This photo is already attached to a recipe or cook.");
    if ("sessionId" in target) {
      const session = await assertCookingSessionOwner(tx, actor, target.sessionId);
      await tx.update(photos).set({ purpose: "cooking", sessionId: session.id, recipeId: session.recipeId }).where(eq(photos.id, photo.id));
      return { photoId: photo.id, sessionId: session.id, recipeId: session.recipeId };
    }
    await tx.select({ id: recipes.id }).from(recipes).where(and(eq(recipes.id, target.recipeId), eq(recipes.workspaceId, actor.workspaceId))).for("update");
    const recipe = await getRecipe(tx, actor, target.recipeId);
    await tx.update(photos).set({ purpose: "recipe", recipeId: recipe.id }).where(eq(photos.id, photo.id));
    const cover = target.makeCover || (recipe.coverSelection === "auto" && !recipe.coverPhotoId);
    if (cover) await tx.update(recipes).set({ coverPhotoId: photo.id, coverSelection: "selected", coverRevision: sql`${recipes.coverRevision} + 1`, updatedAt: new Date(), updatedByUserId: actor.userId }).where(and(eq(recipes.id, recipe.id), eq(recipes.workspaceId, actor.workspaceId)));
    return { photoId: photo.id, recipeId: recipe.id, title: recipe.version.content.title, cover };
  });
}

export async function listRecipePhotos(db: Database, actor: Actor, recipeId: string) {
  await getRecipe(db, actor, recipeId);
  return db.select({ id: photos.id, width: photos.width, height: photos.height, createdAt: photos.createdAt, origin: photos.origin, purpose: photos.purpose, derivatives: photos.derivatives, enhanced: sql<boolean>`${photos.provenance}->>'sourcePhotoId' is not null`, canDelete: sql<boolean>`${photos.purpose} = 'recipe' or ${photos.createdByUserId} = ${actor.userId}` }).from(photos).where(and(eq(photos.workspaceId, actor.workspaceId), eq(photos.recipeId, recipeId), inArray(photos.purpose, ["recipe", "cooking"]), eq(photos.status, "ready"))).orderBy(photos.createdAt, photos.id);
}

export async function deleteRecipePhoto(db: Database, actor: Actor, id: string) {
  const photo = await db.transaction(async (tx) => {
    const found = await getPhoto(tx, actor, id);
    if (!found.recipeId || found.status !== "ready" || !["recipe", "cooking"].includes(found.purpose)) throw new DomainError("NOT_FOUND", "Recipe photo not found.");
    if (found.purpose === "cooking") {
      if (!found.sessionId) throw new DomainError("NOT_FOUND", "Cooking photo not found.");
      await assertCookingSessionOwner(tx, actor, found.sessionId);
    }
    // Serialize cover selection, deletion, and enhancement requests for this recipe.
    const [recipe] = await tx.select().from(recipes).where(and(eq(recipes.id, found.recipeId), eq(recipes.workspaceId, actor.workspaceId))).for("update");
    if (!recipe) throw new DomainError("NOT_FOUND", "Recipe not found.");
    const cancelled = await tx.update(coverRequests).set({ status: "cancelled", updatedAt: new Date() }).where(and(eq(coverRequests.workspaceId, actor.workspaceId), eq(coverRequests.sourcePhotoId, id), inArray(coverRequests.status, ["queued", "running", "failed"]))).returning({ id: coverRequests.id });
    if (cancelled.length) await tx.update(coverAttempts).set({ outputBase64: null }).where(inArray(coverAttempts.requestId, cancelled.map((item) => item.id)));
    if (recipe.coverPhotoId === id) await tx.update(recipes).set({ coverPhotoId: null, coverSelection: "none", coverRevision: recipe.coverRevision + 1, updatedAt: new Date(), updatedByUserId: actor.userId }).where(eq(recipes.id, recipe.id));
    await tx.delete(photos).where(and(eq(photos.id, id), eq(photos.workspaceId, actor.workspaceId)));
    return found;
  });
  // Originals and responsive variants belong exclusively to this immutable photo.
  const keys = new Set([photo.objectKey, photo.originalObjectKey, ...photo.derivatives?.map((item) => item.objectKey) ?? []].filter((key): key is string => !!key));
  await Promise.all([...keys].map((key) => deletePhotoObject(key).catch(() => { console.error("Could not remove deleted photo object", photo.id); })));
  return { deleted: true };
}

export async function setCoverPhoto(db: Database, actor: Actor, recipeId: string, photoId: string | null, expectedCoverRevision?: number) {
  return db.transaction(async (tx) => {
    await assertMembership(tx, actor);
    z.uuid().parse(recipeId);
    const [recipe] = await tx.select().from(recipes).where(and(eq(recipes.id, recipeId), eq(recipes.workspaceId, actor.workspaceId))).for("update");
    if (!recipe) throw new DomainError("NOT_FOUND", "Recipe not found.");
    if (expectedCoverRevision !== undefined && recipe.coverRevision !== expectedCoverRevision) throw new DomainError("CONFLICT", "The cover changed on another device. Review the current cover and try again.");
    let selected = photoId;
    if (photoId) {
      const photo = await getPhoto(tx, actor, photoId);
      if (photo.recipeId !== recipeId || !["recipe", "cooking"].includes(photo.purpose) || photo.status !== "ready") throw new DomainError("NOT_FOUND", "Recipe photo not found.");
      if (photo.purpose === "cooking") {
        // Keep the cook's photo in its history; the cover gets its own immutable object.
        const bytes = await readPhotoObject(photo.objectKey), id = randomUUID();
        const objectKey = `workspaces/${actor.workspaceId}/photos/${id}/cover.webp`;
        await writePhotoObject(objectKey, bytes);
        await tx.insert(photos).values({ id, workspaceId: actor.workspaceId, recipeId, purpose: "recipe", status: "ready", objectKey, contentType: "image/webp", byteSize: bytes.byteLength, width: photo.width, height: photo.height, createdByUserId: actor.userId });
        selected = id;
      }
    }
    const [updated] = await tx.update(recipes).set({ coverPhotoId: selected, coverSelection: selected ? "selected" : "none", coverRevision: recipe.coverRevision + 1, updatedAt: new Date(), updatedByUserId: actor.userId }).where(eq(recipes.id, recipeId)).returning();
    return { coverPhotoId: updated.coverPhotoId, coverRevision: updated.coverRevision };
  });
}

/** Optional import enrichment. A late source image cannot override a selection. */
export async function saveImportedRecipePhoto(db: Database, actor: Actor, recipeId: string, bytes: Uint8Array) {
  const normalized = await normalizePhoto(bytes), id = randomUUID();
  const objectKey = `workspaces/${actor.workspaceId}/photos/${id}/source.webp`;
  await writePhotoObject(objectKey, normalized.bytes);
  let saved = false;
  try {
    await db.transaction(async (tx) => {
      await assertMembership(tx, actor);
      const [recipe] = await tx.select().from(recipes).where(and(eq(recipes.id, recipeId), eq(recipes.workspaceId, actor.workspaceId))).for("update");
      if (!recipe) return;
      const [existing] = await tx.select({ id: photos.id }).from(photos).where(and(eq(photos.recipeId, recipeId), eq(photos.origin, "imported"))).limit(1);
      if (existing) return;
      await tx.insert(photos).values({ id, workspaceId: actor.workspaceId, recipeId, purpose: "recipe", status: "ready", origin: "imported", objectKey, contentType: "image/webp", byteSize: normalized.bytes.byteLength, width: normalized.width, height: normalized.height, createdByUserId: actor.userId });
      if (recipe.coverSelection === "auto" && !recipe.coverPhotoId) await tx.update(recipes).set({ coverPhotoId: id, coverRevision: recipe.coverRevision + 1 }).where(eq(recipes.id, recipeId));
      saved = true;
    });
  } catch { // Do not delete on an ambiguous commit: a reference may have been published.
    return;
  }
  if (!saved) await deletePhotoObject(objectKey).catch(() => {});
}
