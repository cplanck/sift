import { createHash, randomBytes } from "node:crypto";
import { and, desc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "@/db/connection";
import { photos, recipeShares, recipeVersions } from "@/db/schema";
import { DomainError } from "@/domain/errors";
import { type Actor, assertMembership } from "./workspaces";
import { getRecipe } from "./recipes";

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");
export async function createRecipeShare(db: Database, actor: Actor, recipeId: string, expectedVersionId: string, expectedCoverPhotoId: string | null) {
  const recipe = await getRecipe(db, actor, recipeId);
  if (recipe.status !== "active") throw new DomainError("INVALID_INPUT", "Approve this recipe before sharing it.");
  z.uuid().parse(expectedVersionId);
  z.uuid().nullable().parse(expectedCoverPhotoId);
  if (recipe.version.id !== expectedVersionId || recipe.coverPhotoId !== expectedCoverPhotoId) throw new DomainError("CONFLICT", "This recipe changed. Refresh it before creating a share link.");
  const token = randomBytes(32).toString("base64url");
  const [share] = await db.insert(recipeShares).values({ workspaceId: actor.workspaceId, recipeId, versionId: recipe.version.id, coverPhotoId: recipe.coverPhotoId, tokenHash: hashToken(token), createdByUserId: actor.userId }).returning({ id: recipeShares.id, createdAt: recipeShares.createdAt });
  return { ...share, token, versionId: recipe.version.id };
}
export async function listRecipeShares(db: Database, actor: Actor, recipeId: string) {
  await getRecipe(db, actor, recipeId);
  return db.select({ id: recipeShares.id, createdAt: recipeShares.createdAt, versionId: recipeShares.versionId }).from(recipeShares).where(and(eq(recipeShares.workspaceId, actor.workspaceId), eq(recipeShares.recipeId, recipeId), isNull(recipeShares.revokedAt))).orderBy(desc(recipeShares.createdAt));
}
export async function revokeRecipeShare(db: Database, actor: Actor, id: string) {
  await assertMembership(db, actor); z.uuid().parse(id);
  const [share] = await db.update(recipeShares).set({ revokedAt: new Date() }).where(and(eq(recipeShares.id, id), eq(recipeShares.workspaceId, actor.workspaceId))).returning({ id: recipeShares.id });
  if (!share) throw new DomainError("NOT_FOUND", "Share link not found.");
  return share;
}

// Deliberately public, bearer-capability read. Exposes one immutable approved
// version and its selected image, never notes, history, membership, or raw imports.
export async function readSharedRecipe(db: Database, token: string) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new DomainError("NOT_FOUND", "Share link not found.");
  const [row] = await db.select({ share: recipeShares, version: recipeVersions }).from(recipeShares).innerJoin(recipeVersions, and(eq(recipeVersions.id, recipeShares.versionId), eq(recipeVersions.recipeId, recipeShares.recipeId), eq(recipeVersions.workspaceId, recipeShares.workspaceId)))
    .where(and(eq(recipeShares.tokenHash, hashToken(token)), isNull(recipeShares.revokedAt)));
  if (!row) throw new DomainError("NOT_FOUND", "Share link not found.");
  return { content: row.version.content, coverPhotoId: row.share.coverPhotoId, workspaceId: row.share.workspaceId, recipeId: row.share.recipeId };
}
export async function readSharedPhoto(db: Database, token: string) {
  const share = await readSharedRecipe(db, token);
  if (!share.coverPhotoId) throw new DomainError("NOT_FOUND", "Shared photo not found.");
  const [photo] = await db.select().from(photos).where(and(eq(photos.id, share.coverPhotoId), eq(photos.workspaceId, share.workspaceId), eq(photos.recipeId, share.recipeId), eq(photos.purpose, "recipe"), eq(photos.status, "ready")));
  if (!photo) throw new DomainError("NOT_FOUND", "Shared photo not found.");
  return photo;
}
