import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import type { Database, Executor } from "@/db/connection";
import { cookingSessionNotes, cookingSessions, photos, recipes, recipeVersions } from "@/db/schema";
import { cookingFinishSchema, cookingNoteSchema, cookingProgressSchema, cookingStartSchema, type CookingHistoryItem, type CookingProgress, type CookingSessionDetail } from "@/domain/cooking";
import { DomainError } from "@/domain/errors";
import type { RecipeContent } from "@/domain/recipe";
import { getRecipe } from "./recipes";
import { assertMembership, type Actor } from "./workspaces";

function scope(actor: Actor, id: string) {
  if (!z.uuid().safeParse(id).success) throw new DomainError("NOT_FOUND", "Cooking session not found.");
  return and(eq(cookingSessions.workspaceId, actor.workspaceId), eq(cookingSessions.id, id));
}
function summary(row: typeof cookingSessions.$inferSelect) {
  return { id: row.id, recipeId: row.recipeId, recipeVersionId: row.recipeVersionId, startedByUserId: row.startedByUserId,
    status: row.status, servings: row.servings, revision: row.revision, progress: row.progress, rating: row.rating, summary: row.summary,
    startedAt: row.startedAt.toISOString(), finishedAt: row.finishedAt?.toISOString() ?? null };
}
export async function assertCookingSessionOwner(db: Executor, actor: Actor, id: string) {
  await assertMembership(db, actor);
  const [session] = await db.select().from(cookingSessions).where(scope(actor, id));
  if (!session || session.startedByUserId !== actor.userId) throw new DomainError("NOT_FOUND", "Cooking session not found.");
  return session;
}
function assertEditable(session: typeof cookingSessions.$inferSelect | undefined, actor: Actor, revision: number) {
  if (!session || session.startedByUserId !== actor.userId) throw new DomainError("NOT_FOUND", "Cooking session not found.");
  if (session.status !== "active") throw new DomainError("CONFLICT", "This cook has already finished. Open its history to review it.");
  if (session.revision !== revision) throw new DomainError("CONFLICT", "This cook changed in another tab or through Sift. Reload it before saving.");
}
function validateProgress(progress: CookingProgress, content: RecipeContent): CookingProgress {
  const ingredientKeys = new Set(content.ingredientSections.flatMap((section, s) => section.items.map((_, i) => `${s}:${i}`)));
  const stepKeys = new Set(content.instructionSections.flatMap((section, s) => section.steps.map((_, i) => `${s}:${i}`)));
  if (progress.currentStep >= stepKeys.size || progress.checkedIngredients.some((key) => !ingredientKeys.has(key)) || progress.checkedSteps.some((key) => !stepKeys.has(key))) {
    throw new DomainError("INVALID_INPUT", "Cooking progress must refer to ingredients and steps in this cook’s recipe version.");
  }
  return { ...progress, checkedIngredients: [...new Set(progress.checkedIngredients)], checkedSteps: [...new Set(progress.checkedSteps)] };
}

export async function getCookingSession(db: Database, actor: Actor, id: string): Promise<CookingSessionDetail> {
  await assertMembership(db, actor);
  const [row] = await db.select({ session: cookingSessions, version: recipeVersions }).from(cookingSessions)
    .innerJoin(recipeVersions, and(eq(recipeVersions.id, cookingSessions.recipeVersionId), eq(recipeVersions.recipeId, cookingSessions.recipeId), eq(recipeVersions.workspaceId, actor.workspaceId)))
    .where(scope(actor, id));
  if (!row) throw new DomainError("NOT_FOUND", "Cooking session not found.");
  const [notes, images] = await Promise.all([
    db.select().from(cookingSessionNotes).where(and(eq(cookingSessionNotes.workspaceId, actor.workspaceId), eq(cookingSessionNotes.sessionId, id))).orderBy(desc(cookingSessionNotes.createdAt)),
    db.select({ id: photos.id, width: photos.width, height: photos.height, createdAt: photos.createdAt }).from(photos)
      .where(and(eq(photos.workspaceId, actor.workspaceId), eq(photos.sessionId, id), eq(photos.purpose, "cooking"), eq(photos.status, "ready"))).orderBy(desc(photos.createdAt)),
  ]);
  return { ...summary(row.session), version: { id: row.version.id, number: row.version.number, content: row.version.content },
    notes: notes.map(({ id, body, createdByUserId, createdAt }) => ({ id, body, createdByUserId, createdAt: createdAt.toISOString() })),
    photos: images.map((photo) => ({ ...photo, createdAt: photo.createdAt.toISOString() })),
  };
}

export async function startCookingSession(db: Database, actor: Actor, input: unknown) {
  const data = cookingStartSchema.parse(input);
  return db.transaction(async (tx) => {
    await assertMembership(tx, actor);
    // Serialize starts for a recipe so repeated taps resume the same cook.
    const [recipe] = await tx.select().from(recipes).where(and(eq(recipes.workspaceId, actor.workspaceId), eq(recipes.id, data.recipeId))).for("update");
    if (!recipe) throw new DomainError("NOT_FOUND", "Recipe not found.");
    const [existing] = await tx.select().from(cookingSessions).where(and(eq(cookingSessions.workspaceId, actor.workspaceId), eq(cookingSessions.recipeId, recipe.id), eq(cookingSessions.startedByUserId, actor.userId), eq(cookingSessions.status, "active")));
    if (existing) return getCookingSession(tx, actor, existing.id);
    if (recipe.status !== "active") throw new DomainError("INVALID_INPUT", "Save or restore this recipe before starting a cook.");
    if (recipe.currentVersionId !== data.expectedVersionId) throw new DomainError("CONFLICT", "This recipe changed. Reload it before starting a cook.");
    const [version] = await tx.select().from(recipeVersions).where(and(eq(recipeVersions.id, data.expectedVersionId), eq(recipeVersions.recipeId, recipe.id), eq(recipeVersions.workspaceId, actor.workspaceId)));
    if (!version) throw new DomainError("NOT_FOUND", "Recipe version not found.");
    const [session] = await tx.insert(cookingSessions).values({ workspaceId: actor.workspaceId, recipeId: recipe.id, recipeVersionId: version.id, startedByUserId: actor.userId, servings: data.servings ?? version.content.servings }).returning();
    return getCookingSession(tx, actor, session.id);
  });
}

export async function getActiveCookingSession(db: Database, actor: Actor, recipeId: string) {
  await getRecipe(db, actor, recipeId);
  const [session] = await db.select({ id: cookingSessions.id }).from(cookingSessions).where(and(eq(cookingSessions.workspaceId, actor.workspaceId), eq(cookingSessions.recipeId, recipeId), eq(cookingSessions.startedByUserId, actor.userId), eq(cookingSessions.status, "active")));
  return session ? getCookingSession(db, actor, session.id) : null;
}

export async function listCookingHistory(db: Database, actor: Actor, recipeId: string): Promise<CookingHistoryItem[]> {
  await getRecipe(db, actor, recipeId);
  const rows = await db.select({ session: cookingSessions, version: recipeVersions }).from(cookingSessions)
    .innerJoin(recipeVersions, and(eq(recipeVersions.id, cookingSessions.recipeVersionId), eq(recipeVersions.recipeId, recipeId), eq(recipeVersions.workspaceId, actor.workspaceId)))
    .where(and(eq(cookingSessions.workspaceId, actor.workspaceId), eq(cookingSessions.recipeId, recipeId))).orderBy(desc(cookingSessions.startedAt));
  return rows.map(({ session, version }) => ({ ...summary(session), versionNumber: version.number, title: version.content.title }));
}

export async function updateCookingProgress(db: Database, actor: Actor, id: string, input: unknown) {
  const data = cookingProgressSchema.parse(input);
  return db.transaction(async (tx) => {
    await assertMembership(tx, actor);
    const [session] = await tx.select().from(cookingSessions).where(scope(actor, id)).for("update");
    assertEditable(session, actor, data.expectedRevision);
    const current = await getCookingSession(tx, actor, id);
    const progress = validateProgress(data.progress, current.version.content);
    await tx.update(cookingSessions).set({ progress, servings: data.servings ?? session.servings, revision: session.revision + 1 }).where(scope(actor, id));
    return getCookingSession(tx, actor, id);
  });
}

export async function finishCookingSession(db: Database, actor: Actor, id: string, input: unknown) {
  const data = cookingFinishSchema.parse(input);
  return db.transaction(async (tx) => {
    await assertMembership(tx, actor);
    const [session] = await tx.select().from(cookingSessions).where(scope(actor, id)).for("update");
    if (!session || session.startedByUserId !== actor.userId) throw new DomainError("NOT_FOUND", "Cooking session not found.");
    // Retrying a completed request is safe; a conflicting wrap-up never overwrites it.
    if (session.status === data.status && session.revision === data.expectedRevision + 1 && session.rating === (data.rating ?? null) && session.summary === (data.summary || null)) return getCookingSession(tx, actor, id);
    assertEditable(session, actor, data.expectedRevision);
    await tx.update(cookingSessions).set({ status: data.status, finishedAt: new Date(), rating: data.rating ?? null, summary: data.summary || null, revision: session.revision + 1 }).where(scope(actor, id));
    return getCookingSession(tx, actor, id);
  });
}

export async function addCookingSessionNote(db: Database, actor: Actor, id: string, input: unknown) {
  const data = cookingNoteSchema.parse(input);
  return db.transaction(async (tx) => {
    await assertCookingSessionOwner(tx, actor, id);
    const [note] = await tx.insert(cookingSessionNotes).values({ workspaceId: actor.workspaceId, sessionId: id, body: data.body, createdByUserId: actor.userId }).returning();
    return { id: note.id, body: note.body, createdByUserId: note.createdByUserId, createdAt: note.createdAt.toISOString() };
  });
}

export async function listCookingPhotos(db: Database, actor: Actor, id: string) { return (await getCookingSession(db, actor, id)).photos; }
