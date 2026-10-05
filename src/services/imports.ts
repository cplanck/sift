import { and, desc, eq, inArray } from "drizzle-orm";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import type { Database } from "@/db/connection";
import { recipeImports } from "@/db/schema";
import { DomainError } from "@/domain/errors";
import { importInputSchema, parsePastedRecipe } from "@/domain/import";
import { recipeContentSchema, type RecipeContent, type RecipeSource } from "@/domain/recipe";
import { validateImportUrl } from "@/lib/safe-fetch";
import { inngest, requireJobs } from "@/jobs/client";
import { assertMembership, type Actor } from "./workspaces";
import { createRecipe, getRecipe, publishReviewedRecipe, updateRecipe } from "./recipes";
import { getPhoto } from "./photos";
import { consumeLimit } from "./rate-limit";

export async function getImport(db: Database, actor: Actor, id: string) {
  await assertMembership(db, actor);
  if (!z.uuid().safeParse(id).success) throw new DomainError("NOT_FOUND", "Import not found.");
  const [record] = await db.select().from(recipeImports).where(and(eq(recipeImports.id, id), eq(recipeImports.workspaceId, actor.workspaceId)));
  if (!record) throw new DomainError("NOT_FOUND", "Import not found.");
  return record;
}
export async function listPendingImports(db: Database, actor: Actor) {
  await assertMembership(db, actor);
  return db.select({ id: recipeImports.id, status: recipeImports.status, kind: recipeImports.kind, createdAt: recipeImports.createdAt }).from(recipeImports)
    .where(and(eq(recipeImports.workspaceId, actor.workspaceId), inArray(recipeImports.status, ["queued", "processing", "review", "failed"]))).orderBy(desc(recipeImports.createdAt));
}

export async function createImport(db: Database, actor: Actor, input: unknown) {
  const data = importInputSchema.parse(input);
  await assertMembership(db, actor);
  if (data.kind === "url") validateImportUrl(data.url);
  if (data.kind === "image") {
    const photo = await getPhoto(db, actor, data.photoId);
    if (photo.status !== "ready" || photo.purpose !== "import") throw new DomainError("INVALID_INPUT", "Upload a recipe image first.");
  }
  const immediate = data.kind === "paste" ? parsePastedRecipe(data.text) : null;
  if (!immediate) requireJobs();
  await consumeLimit(db, actor, "import", 30);
  const [record] = await db.insert(recipeImports).values({ workspaceId: actor.workspaceId, createdByUserId: actor.userId, kind: data.kind, rawText: data.kind === "paste" ? data.text : null, sourceUrl: data.kind === "url" ? data.url : null, photoId: data.kind === "image" ? data.photoId : null }).returning();
  if (immediate) await saveExtractedImport(db, actor, record.id, immediate, { type: "paste", rawText: data.kind === "paste" ? data.text : undefined, importedAt: new Date().toISOString() });
  else {
    try { await inngest.send({ name: "sift/import.requested", id: record.id, data: { importId: record.id } }); }
    catch { await markImportFailed(db, record.id, "The import service could not be reached. Please try again."); throw new DomainError("INVALID_INPUT", "The import service could not be reached. Check Inngest configuration and try again."); }
  }
  return getImport(db, actor, record.id);
}

// Structured external ingestion uses the same draft/review workflow. The
// caller supplies a namespaced request UUID and its original payload so a
// delivery retry cannot create a duplicate or replace a different request.
export async function createStructuredImport(db: Database, actor: Actor, input: { id: string; rawText: string; content: RecipeContent; source: RecipeSource }) {
  z.uuid().parse(input.id);
  z.string().max(80000).parse(input.rawText);
  return db.transaction(async (tx) => {
    await assertMembership(tx, actor);
    const inserted = await tx.insert(recipeImports).values({ id: input.id, workspaceId: actor.workspaceId, createdByUserId: actor.userId, kind: "mcp", rawText: input.rawText, sourceUrl: input.source.url ?? null }).onConflictDoNothing().returning({ id: recipeImports.id });
    const [record] = await tx.select().from(recipeImports).where(and(eq(recipeImports.id, input.id), eq(recipeImports.workspaceId, actor.workspaceId), eq(recipeImports.createdByUserId, actor.userId))).for("update");
    if (!record) throw new DomainError("NOT_FOUND", "Import not found.");
    if (record.kind !== "mcp" || record.rawText !== input.rawText) throw new DomainError("CONFLICT", "This save request was already used for different content. Use a new requestId for a new recipe.");
    if (inserted.length) await consumeLimit(tx, actor, "import", 30);
    await saveExtractedImport(tx, actor, record.id, input.content, input.source);
    return getImport(tx, actor, record.id);
  });
}

export async function saveExtractedImport(db: Database, actor: Actor, id: string, content: RecipeContent, source: RecipeSource) {
  return db.transaction(async (tx) => {
    await assertMembership(tx, actor);
    const [record] = await tx.select().from(recipeImports).where(and(eq(recipeImports.id, id), eq(recipeImports.workspaceId, actor.workspaceId))).for("update");
    if (!record) throw new DomainError("NOT_FOUND", "Import not found.");
    if (record.recipeId) return record.recipeId; // Durable job retries are idempotent.
    const recipe = await createRecipe(tx, actor, { content, source, status: "draft" });
    await tx.update(recipeImports).set({ recipeId: recipe.id, status: "review", errorMessage: null, updatedAt: new Date() }).where(eq(recipeImports.id, record.id));
    return recipe.id;
  });
}

export async function approveImport(db: Database, actor: Actor, id: string, input: unknown) {
  const data = z.object({ content: recipeContentSchema, expectedVersionId: z.uuid() }).parse(input);
  return db.transaction(async (tx) => {
    await assertMembership(tx, actor);
    const [record] = await tx.select().from(recipeImports).where(and(eq(recipeImports.id, id), eq(recipeImports.workspaceId, actor.workspaceId))).for("update");
    if (!record || !record.recipeId) throw new DomainError("NOT_FOUND", "Import draft not found.");
    if (record.status === "saved") {
      const saved = await getRecipe(tx, actor, record.recipeId);
      if (!isDeepStrictEqual(saved.version.content, data.content)) throw new DomainError("CONFLICT", "This import was already approved with different corrections. Open the saved recipe to review it.");
      return { recipeId: record.recipeId };
    }
    if (record.status !== "review") throw new DomainError("INVALID_INPUT", "This import is not ready for review.");
    const version = await updateRecipe(tx, actor, record.recipeId, { ...data, changeSummary: "Reviewed and approved import" });
    await publishReviewedRecipe(tx, actor, record.recipeId, version.id);
    await tx.update(recipeImports).set({ status: "saved", updatedAt: new Date() }).where(eq(recipeImports.id, record.id));
    return { recipeId: record.recipeId };
  });
}

export async function importForJob(db: Database, id: string) {
  z.uuid().parse(id);
  const [record] = await db.select().from(recipeImports).where(eq(recipeImports.id, id));
  if (!record) throw new DomainError("NOT_FOUND", "Import not found.");
  const actor = { userId: record.createdByUserId, workspaceId: record.workspaceId };
  await assertMembership(db, actor);
  return { record, actor };
}
export async function markImportProcessing(db: Database, id: string) {
  const { actor } = await importForJob(db, id);
  await db.update(recipeImports).set({ status: "processing", updatedAt: new Date() }).where(and(eq(recipeImports.id, id), eq(recipeImports.workspaceId, actor.workspaceId), inArray(recipeImports.status, ["queued", "processing", "failed"])));
}
export async function markImportFailed(db: Database, id: string, message: string) {
  const { actor } = await importForJob(db, id);
  await db.update(recipeImports).set({ status: "failed", errorMessage: message, updatedAt: new Date() }).where(and(eq(recipeImports.id, id), eq(recipeImports.workspaceId, actor.workspaceId), inArray(recipeImports.status, ["queued", "processing"])));
}
export async function importReview(db: Database, actor: Actor, id: string) {
  const record = await getImport(db, actor, id);
  return { id: record.id, status: record.status, kind: record.kind, errorMessage: record.errorMessage, recipe: record.recipeId ? await getRecipe(db, actor, record.recipeId) : null };
}
