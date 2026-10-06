import { withStepIllustrations } from "@/domain/step-illustrations";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import type { Database, Executor } from "@/db/connection";
import { photos, recipeFavorites, recipeImports, recipePlans, recipeNotes, recipes, recipeStockPhotos, recipeVersions } from "@/db/schema";
import { DomainError } from "@/domain/errors";
import { createRecipeSchema, searchLibrary, updateRecipeSchema, type RecipeSummary } from "@/domain/recipe";
import { assertMembership, type Actor } from "./workspaces";

function recipeScope(actor: Actor, id: string) {
  if (!z.uuid().safeParse(id).success) throw new DomainError("NOT_FOUND", "Recipe not found.");
  return and(eq(recipes.workspaceId, actor.workspaceId), eq(recipes.id, id));
}

async function scopedRecipe(db: Executor, actor: Actor, id: string) {
  await assertMembership(db, actor);
  const [recipe] = await db.select().from(recipes).where(recipeScope(actor, id));
  if (!recipe) throw new DomainError("NOT_FOUND", "Recipe not found.");
  return recipe;
}

export async function createRecipe(db: Database, actor: Actor, input: unknown) {
  const data = createRecipeSchema.parse(input);
  return db.transaction(async (tx) => {
    await assertMembership(tx, actor);
    const [recipe] = await tx.insert(recipes).values({ workspaceId: actor.workspaceId, source: data.source, status: data.status, createdByUserId: actor.userId, updatedByUserId: actor.userId }).returning();
    const [version] = await tx.insert(recipeVersions).values({ workspaceId: actor.workspaceId, recipeId: recipe.id, number: 1, content: withStepIllustrations(data.content), changeSummary: "Recipe created", createdByUserId: actor.userId }).returning();
    await tx.update(recipes).set({ currentVersionId: version.id }).where(recipeScope(actor, recipe.id));
    return { ...recipe, currentVersionId: version.id, version };
  });
}

export async function getRecipe(db: Database, actor: Actor, id: string) {
  const recipe = await scopedRecipe(db, actor, id);
  const [version] = await db.select().from(recipeVersions).where(and(eq(recipeVersions.workspaceId, actor.workspaceId), eq(recipeVersions.recipeId, id), eq(recipeVersions.id, recipe.currentVersionId!)));
  if (!version) throw new DomainError("NOT_FOUND", "Recipe version not found.");
  const [favorite] = await db.select().from(recipeFavorites).where(and(eq(recipeFavorites.workspaceId, actor.workspaceId), eq(recipeFavorites.recipeId, id), eq(recipeFavorites.userId, actor.userId)));
  const [planned] = await db.select().from(recipePlans).where(and(eq(recipePlans.workspaceId, actor.workspaceId), eq(recipePlans.recipeId, id), eq(recipePlans.userId, actor.userId)));
  const [review] = recipe.status === "draft" ? await db.select({ id: recipeImports.id }).from(recipeImports).where(and(eq(recipeImports.recipeId, id), eq(recipeImports.workspaceId, actor.workspaceId))).limit(1) : [];
  const [stock] = await db.select({ photo: recipeStockPhotos.photo }).from(recipeStockPhotos).where(and(eq(recipeStockPhotos.recipeId, id), eq(recipeStockPhotos.workspaceId, actor.workspaceId)));
  const [cover] = recipe.coverPhotoId ? await db.select({ origin: photos.origin, derivatives: photos.derivatives }).from(photos).where(and(eq(photos.id, recipe.coverPhotoId), eq(photos.workspaceId, actor.workspaceId))) : [];
  return { ...recipe, coverImage: cover ? { origin: cover.origin, widths: cover.derivatives?.map((item) => item.width) ?? [] } : null, stockPhoto: stock?.photo ?? null, version, favorite: !!favorite, planned: !!planned, reviewImportId: review?.id ?? null };
}

export async function listRecipes(db: Database, actor: Actor, query = ""): Promise<RecipeSummary[]> {
  await assertMembership(db, actor);
  const rows = await db.select({ recipe: recipes, version: recipeVersions, favorite: recipeFavorites.recipeId, planned: recipePlans.recipeId, stockPhoto: recipeStockPhotos.photo, coverOrigin: photos.origin, coverDerivatives: photos.derivatives }).from(recipes)
    .innerJoin(recipeVersions, and(eq(recipeVersions.id, recipes.currentVersionId), eq(recipeVersions.recipeId, recipes.id), eq(recipeVersions.workspaceId, actor.workspaceId)))
    .leftJoin(recipeFavorites, and(eq(recipeFavorites.recipeId, recipes.id), eq(recipeFavorites.userId, actor.userId), eq(recipeFavorites.workspaceId, actor.workspaceId)))
    .leftJoin(recipePlans, and(eq(recipePlans.recipeId, recipes.id), eq(recipePlans.userId, actor.userId), eq(recipePlans.workspaceId, actor.workspaceId)))
    .leftJoin(photos, and(eq(photos.id, recipes.coverPhotoId), eq(photos.workspaceId, actor.workspaceId)))
    .leftJoin(recipeStockPhotos, and(eq(recipeStockPhotos.recipeId, recipes.id), eq(recipeStockPhotos.workspaceId, actor.workspaceId)))
    .where(eq(recipes.workspaceId, actor.workspaceId)).orderBy(desc(recipes.updatedAt));
  const notes = await db.select({ recipeId: recipeNotes.recipeId, body: recipeNotes.body }).from(recipeNotes).where(eq(recipeNotes.workspaceId, actor.workspaceId));
  const notesByRecipe = new Map<string, string[]>();
  for (const note of notes) notesByRecipe.set(note.recipeId, [...(notesByRecipe.get(note.recipeId) ?? []), note.body]);
  return searchLibrary(rows.map(({ recipe, version, favorite, planned, stockPhoto, coverOrigin, coverDerivatives }) => ({
    id: recipe.id, versionId: version.id, title: version.content.title, description: version.content.description,
    tags: version.content.tags, collections: version.content.collections,
    ingredientsText: version.content.ingredientSections.flatMap((section) => section.items.map((item) => item.text)).join(" "),
    notesText: (notesByRecipe.get(recipe.id) ?? []).join(" "),
    totalMinutes: version.content.totalMinutes ?? ((version.content.prepMinutes ?? 0) + (version.content.cookMinutes ?? 0) || null),
    status: recipe.status, favorite: !!favorite, planned: !!planned, updatedAt: recipe.updatedAt.toISOString(), coverPhotoId: recipe.coverPhotoId, coverSelection: recipe.coverSelection, coverImage: coverOrigin ? { origin: coverOrigin, widths: coverDerivatives?.map((item) => item.width) ?? [] } : null, stockPhoto,
  })), query.slice(0, 200));
}

export async function updateRecipe(db: Database, actor: Actor, id: string, input: unknown) {
  const data = updateRecipeSchema.parse(input);
  return db.transaction(async (tx) => {
    await assertMembership(tx, actor);
    const [recipe] = await tx.select().from(recipes).where(recipeScope(actor, id)).for("update");
    if (!recipe) throw new DomainError("NOT_FOUND", "Recipe not found.");
    if (recipe.currentVersionId !== data.expectedVersionId) throw new DomainError("CONFLICT", "This recipe has changed. Reload it before saving your changes.");
    const [current] = await tx.select().from(recipeVersions).where(and(eq(recipeVersions.id, data.expectedVersionId), eq(recipeVersions.recipeId, id), eq(recipeVersions.workspaceId, actor.workspaceId)));
    if (!current) throw new DomainError("NOT_FOUND", "Recipe version not found.");
    const [version] = await tx.insert(recipeVersions).values({ workspaceId: actor.workspaceId, recipeId: id, number: current.number + 1, content: withStepIllustrations(data.content), changeSummary: data.changeSummary, createdByUserId: actor.userId }).returning();
    await tx.update(recipes).set({ currentVersionId: version.id, updatedAt: new Date(), updatedByUserId: actor.userId }).where(recipeScope(actor, id));
    return version;
  });
}

export async function listVersions(db: Database, actor: Actor, id: string) {
  await scopedRecipe(db, actor, id);
  return db.select().from(recipeVersions).where(and(eq(recipeVersions.workspaceId, actor.workspaceId), eq(recipeVersions.recipeId, id))).orderBy(desc(recipeVersions.number));
}

export async function restoreVersion(db: Database, actor: Actor, id: string, input: unknown) {
  const data = z.object({ versionId: z.uuid(), expectedVersionId: z.uuid() }).parse(input);
  const versions = await listVersions(db, actor, id);
  const version = versions.find((entry) => entry.id === data.versionId);
  if (!version) throw new DomainError("NOT_FOUND", "Recipe version not found.");
  return updateRecipe(db, actor, id, { content: version.content, expectedVersionId: data.expectedVersionId, changeSummary: `Restored version ${version.number}` });
}

export async function setRecipeStatus(db: Database, actor: Actor, id: string, input: unknown, expectedVersionId?: string) {
  const status = z.enum(["active", "archived"]).parse(input);
  if (expectedVersionId) z.uuid().parse(expectedVersionId);
  return db.transaction(async (tx) => {
    await scopedRecipe(tx, actor, id);
    const [current] = await tx.select().from(recipes).where(recipeScope(actor, id)).for("update");
    if (current.status === "draft") throw new DomainError("INVALID_INPUT", "Review and approve the import before changing its Library status.");
    if (expectedVersionId && current.currentVersionId !== expectedVersionId) throw new DomainError("CONFLICT", "This recipe changed. Review its current version before changing its status.");
    const [recipe] = await tx.update(recipes).set({ status, updatedAt: new Date(), updatedByUserId: actor.userId }).where(recipeScope(actor, id)).returning();
    return recipe;
  });
}

// Called by the reviewed import workflow inside its transaction, after corrections
// have been validated and versioned. Not exposed as a generic API or agent action.
export async function publishReviewedRecipe(db: Executor, actor: Actor, id: string, expectedVersionId: string) {
  const current = await scopedRecipe(db, actor, id);
  if (current.currentVersionId !== expectedVersionId) throw new DomainError("CONFLICT", "This draft changed during review. Reload it before approval.");
  await db.update(recipes).set({ status: "active", updatedAt: new Date(), updatedByUserId: actor.userId }).where(recipeScope(actor, id));
}

export async function setFavorite(db: Database, actor: Actor, id: string, input: unknown) {
  const favorite = z.boolean().parse(input);
  await scopedRecipe(db, actor, id);
  if (favorite) await db.insert(recipeFavorites).values({ workspaceId: actor.workspaceId, recipeId: id, userId: actor.userId }).onConflictDoNothing();
  else await db.delete(recipeFavorites).where(and(eq(recipeFavorites.workspaceId, actor.workspaceId), eq(recipeFavorites.recipeId, id), eq(recipeFavorites.userId, actor.userId)));
  return { favorite };
}

export async function setPlanned(db: Database, actor: Actor, id: string, input: unknown) {
  const planned = z.boolean().parse(input);
  const recipe = await scopedRecipe(db, actor, id);
  if (planned && recipe.status !== "active") throw new DomainError("INVALID_INPUT", "Save this recipe to your Library before planning it.");
  if (planned) await db.insert(recipePlans).values({ workspaceId: actor.workspaceId, recipeId: id, userId: actor.userId }).onConflictDoNothing();
  else await db.delete(recipePlans).where(and(eq(recipePlans.workspaceId, actor.workspaceId), eq(recipePlans.recipeId, id), eq(recipePlans.userId, actor.userId)));
  return { planned };
}

export async function addRecipeNote(db: Database, actor: Actor, id: string, input: unknown) {
  const { body } = z.object({ body: z.string().trim().min(1).max(5000) }).parse(input);
  await scopedRecipe(db, actor, id);
  const [note] = await db.insert(recipeNotes).values({ workspaceId: actor.workspaceId, recipeId: id, body, createdByUserId: actor.userId }).returning();
  return note;
}

export async function listRecipeNotes(db: Database, actor: Actor, id: string) {
  await scopedRecipe(db, actor, id);
  return db.select().from(recipeNotes).where(and(eq(recipeNotes.workspaceId, actor.workspaceId), eq(recipeNotes.recipeId, id))).orderBy(desc(recipeNotes.createdAt));
}
