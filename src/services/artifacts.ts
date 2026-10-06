import { randomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import type { Database, Executor } from "@/db/connection";
import { artifacts, recipes, recipeVersions } from "@/db/schema";
import { setShoppingListArchivedSchema, categorizeGroceryItemsSchema, clearCheckedGroceryItemsSchema, restoreGroceryItemsSchema, addShoppingRecipeSchema, removeShoppingRecipeSchema, updateShoppingRecipeSchema, addGroceryItemsSchema, addMealEntrySchema, artifactContentSchema, checkGroceryItemSchema, createArtifactSchema, deriveGrocerySchema, expectedRevisionSchema, removeGroceryItemSchema, removeMealEntrySchema, renameArtifactSchema, updateGroceryItemSchema, updateMealEntrySchema, type ArtifactContent, type ArtifactDetail, type ArtifactKind, type ArtifactSummary, type MealEntryInput } from "@/domain/artifact";
import { DomainError } from "@/domain/errors";
import { combineGroceryItems, expandRecipeItems, shoppingRecipes } from "@/domain/grocery";
import { normalizeSearch, type Ingredient } from "@/domain/recipe";
import { parseIngredient, scaleIngredient } from "@/domain/scaling";
import { assertMembership, type Actor } from "./workspaces";

const listSchema = z.object({ kind: z.enum(["grocery", "meal-plan"]).optional(), query: z.string().trim().max(200).optional(), includeArchived: z.boolean().optional() }).strict();
type ContentOf<Kind extends ArtifactKind> = Extract<ArtifactContent, { kind: Kind }>;

function scope(actor: Actor, id: string) {
  if (!z.uuid().safeParse(id).success) throw new DomainError("NOT_FOUND", "List or plan not found.");
  return and(eq(artifacts.workspaceId, actor.workspaceId), eq(artifacts.id, id));
}
function summary(row: Pick<typeof artifacts.$inferSelect, "id" | "kind" | "title" | "revision" | "updatedAt"> & { content?: ArtifactContent }): ArtifactSummary {
  return { id: row.id, kind: row.kind, title: row.title, revision: row.revision, updatedAt: row.updatedAt.toISOString(), ...(row.content?.kind === "grocery" ? { archivedAt: row.content.archivedAt ?? null, recipeIds: shoppingRecipes(row.content).map((recipe) => recipe.recipeId) } : {}) };
}
function detail(row: typeof artifacts.$inferSelect): ArtifactDetail {
  return { ...summary(row), content: row.content, createdAt: row.createdAt.toISOString() };
}
async function scopedArtifact(db: Executor, actor: Actor, id: string) {
  await assertMembership(db, actor);
  const [row] = await db.select().from(artifacts).where(scope(actor, id));
  if (!row) throw new DomainError("NOT_FOUND", "List or plan not found.");
  return row;
}
async function exactRecipeVersion(db: Executor, actor: Actor, recipeId: string, versionId: string) {
  const [row] = await db.select({ status: recipes.status, content: recipeVersions.content }).from(recipes)
    .innerJoin(recipeVersions, and(eq(recipeVersions.id, versionId), eq(recipeVersions.recipeId, recipes.id), eq(recipeVersions.workspaceId, actor.workspaceId)))
    .where(and(eq(recipes.workspaceId, actor.workspaceId), eq(recipes.id, recipeId)));
  if (!row) throw new DomainError("NOT_FOUND", "Recipe version not found.");
  if (row.status === "draft") throw new DomainError("INVALID_INPUT", "Review and save this recipe before adding it to a list or plan.");
  return row.content;
}
async function mealEntry(db: Executor, actor: Actor, input: MealEntryInput): Promise<ContentOf<"meal-plan">["entries"][number]> {
  const recipe = input.recipeId && input.versionId ? await exactRecipeVersion(db, actor, input.recipeId, input.versionId) : null;
  return { id: randomUUID(), date: input.date ?? null, meal: input.meal, title: input.title ?? recipe!.title,
    recipeId: input.recipeId ?? null, recipeVersionId: input.versionId ?? null,
    servings: input.servings ?? recipe?.servings ?? null, note: input.note ?? "" };
}
async function insertArtifact(db: Executor, actor: Actor, title: string, content: ArtifactContent) {
  const validated = artifactContentSchema.parse(content);
  const [row] = await db.insert(artifacts).values({ workspaceId: actor.workspaceId, kind: validated.kind, title, content: validated, createdByUserId: actor.userId, updatedByUserId: actor.userId }).returning();
  return detail(row);
}

export async function getArtifact(db: Database, actor: Actor, id: string): Promise<ArtifactDetail> {
  return detail(await scopedArtifact(db, actor, id));
}
export async function listArtifacts(db: Database, actor: Actor, input: unknown = {}): Promise<ArtifactSummary[]> {
  const data = listSchema.parse(input);
  await assertMembership(db, actor);
  const rows = await db.select({ id: artifacts.id, kind: artifacts.kind, title: artifacts.title, revision: artifacts.revision, updatedAt: artifacts.updatedAt, content: artifacts.content }).from(artifacts)
    .where(and(eq(artifacts.workspaceId, actor.workspaceId), data.kind ? eq(artifacts.kind, data.kind) : undefined)).orderBy(desc(artifacts.updatedAt));
  const query = normalizeSearch(data.query ?? "");
  return rows.filter((row) => (data.includeArchived || row.content.kind !== "grocery" || !row.content.archivedAt) && (!query || normalizeSearch(row.title).includes(query))).map(summary);
}
export async function createArtifact(db: Database, actor: Actor, input: unknown): Promise<ArtifactDetail> {
  const data = createArtifactSchema.parse(input);
  return db.transaction(async (tx) => {
    await assertMembership(tx, actor);
    if (data.kind === "grocery") {
      if (data.groups.reduce((total, group) => total + group.items.length, 0) > 1000) throw new DomainError("INVALID_INPUT", "A grocery list can hold up to 1,000 items. Split this into smaller lists.");
      return insertArtifact(tx, actor, data.title, { kind: "grocery", groups: data.groups.map((group) => ({ id: randomUUID(), name: group.name, items: group.items.map((item) => ({ id: randomUUID(), text: item.text, category: item.category, checked: false })) })) });
    }
    const entries = [];
    for (const entry of data.entries) entries.push(await mealEntry(tx, actor, entry));
    return insertArtifact(tx, actor, data.title, { kind: "meal-plan", entries });
  });
}

function scaledText(ingredient: Ingredient, factor: number) {
  const quantity = parseIngredient(ingredient.text).quantity;
  const amounts = !quantity ? [] : quantity.kind === "exact" ? [quantity.value] : [quantity.min, quantity.max];
  if (!Number.isFinite(factor) || factor <= 0 || amounts.some((amount) => !Number.isFinite(amount * factor))) {
    throw new DomainError("INVALID_INPUT", "This recipe’s quantities cannot be scaled to that serving size.");
  }
  return scaleIngredient(ingredient, factor);
}
export async function deriveGroceryList(db: Database, actor: Actor, input: unknown): Promise<ArtifactDetail> {
  const data = deriveGrocerySchema.parse(input);
  return db.transaction(async (tx) => {
    await assertMembership(tx, actor);
    const groups: ContentOf<"grocery">["groups"] = [];
    let itemCount = 0;
    const linkedRecipes: NonNullable<ContentOf<"grocery">["recipes"]> = [];
    for (const source of data.recipes) {
      const recipe = await exactRecipeVersion(tx, actor, source.recipeId, source.versionId);
      const servings = source.servings ?? recipe.servings;
      linkedRecipes.push({ ...source, title: recipe.title, servings });
      itemCount += recipe.ingredientSections.reduce((total, section) => total + section.items.length, 0);
      if (itemCount > 1000 || groups.length + recipe.ingredientSections.length > 100) throw new DomainError("INVALID_INPUT", "This grocery list is too large. Split it into lists of up to 1,000 items and 100 groups.");
      for (const section of recipe.ingredientSections) {
        groups.push({ id: randomUUID(), name: [recipe.title, section.name].filter(Boolean).join(" · "), items: section.items.map((item) => ({
          id: randomUUID(), text: scaledText(item, servings / recipe.servings), checked: false,
          source: { recipeId: source.recipeId, versionId: source.versionId, servings },
        })) });
      }
    }
    // Preserve ingredient wording and recipe provenance; unlike a unit-aware
    // aggregation system this never guesses whether similar items can merge.
    return insertArtifact(tx, actor, data.title, { kind: "grocery", groups, recipes: linkedRecipes });
  });
}

async function mutateArtifact<Kind extends ArtifactKind>(db: Database, actor: Actor, id: string, expectedRevision: number, kind: Kind, change: (tx: Database, content: ContentOf<Kind>) => ContentOf<Kind> | Promise<ContentOf<Kind>>, allowArchived = false): Promise<ArtifactDetail> {
  return db.transaction(async (tx) => {
    await assertMembership(tx, actor);
    const [row] = await tx.select().from(artifacts).where(scope(actor, id)).for("update");
    if (!row) throw new DomainError("NOT_FOUND", "List or plan not found.");
    if (row.kind !== kind || row.content.kind !== kind) throw new DomainError("INVALID_INPUT", kind === "grocery" ? "Choose a grocery list for this action." : "Choose a meal plan for this action.");
    if (row.revision !== expectedRevision) throw new DomainError("CONFLICT", "This list or plan changed in another tab or through Sift. Reload it before saving.");
    if (!allowArchived && row.content.kind === "grocery" && row.content.archivedAt) throw new DomainError("CONFLICT", "Restore this shopping list before editing it.");
    const content = artifactContentSchema.parse(await change(tx, structuredClone(row.content) as ContentOf<Kind>));
    const [updated] = await tx.update(artifacts).set({ content, revision: row.revision + 1, updatedAt: new Date(), updatedByUserId: actor.userId }).where(scope(actor, id)).returning();
    return detail(updated);
  });
}
export async function setShoppingListArchived(db: Database, actor: Actor, id: string, input: unknown): Promise<ArtifactDetail> {
  const data = setShoppingListArchivedSchema.parse(input);
  return mutateArtifact(db, actor, id, data.expectedRevision, "grocery", (_tx, content) => ({ ...content, archivedAt: data.archived ? content.archivedAt ?? new Date().toISOString() : null }), true);
}
export async function addGroceryItems(db: Database, actor: Actor, id: string, input: unknown): Promise<ArtifactDetail> {
  const data = addGroceryItemsSchema.parse(input);
  return mutateArtifact(db, actor, id, data.expectedRevision, "grocery", (_tx, content) => {
    let group = content.groups.find((entry) => entry.name === data.groupName);
    if (!group) {
      if (data.groupName.length > 100) throw new DomainError("INVALID_INPUT", "Keep new group names to 100 characters or fewer.");
      group = { id: randomUUID(), name: data.groupName, items: [] }; content.groups.push(group);
    }
    group.items.push(...data.items.map((item) => ({ id: randomUUID(), text: item.text, category: item.category, checked: false })));
    return content;
  });
}
export async function combineGroceryList(db: Database, actor: Actor, id: string, input: unknown): Promise<ArtifactDetail> {
  const data = expectedRevisionSchema.parse(input);
  return mutateArtifact(db, actor, id, data.expectedRevision, "grocery", (_tx, content) => combineGroceryItems(content, randomUUID));
}
export async function removeGroceryItem(db: Database, actor: Actor, id: string, input: unknown): Promise<ArtifactDetail> {
  const data = removeGroceryItemSchema.parse(input);
  return mutateArtifact(db, actor, id, data.expectedRevision, "grocery", (_tx, content) => {
    const group = content.groups.find((entry) => entry.items.some((item) => item.id === data.itemId));
    if (!group) throw new DomainError("NOT_FOUND", "Grocery item not found.");
    group.items = group.items.filter((item) => item.id !== data.itemId);
    return content;
  });
}
export async function restoreGroceryItems(db: Database, actor: Actor, id: string, input: unknown): Promise<ArtifactDetail> {
  const data = restoreGroceryItemsSchema.parse(input);
  return mutateArtifact(db, actor, id, data.expectedRevision, "grocery", async (tx, content) => {
    const existingIds = new Set(content.groups.flatMap((group) => group.items.map((item) => item.id)));
    const linked = shoppingRecipes(content), validated = new Set<string>();
    for (const removed of [...data.items].sort((a, b) => a.groupIndex - b.groupIndex || a.index - b.index)) {
      if (existingIds.has(removed.item.id)) throw new DomainError("CONFLICT", "This item is already on the list.");
      for (const source of removed.item.sources ?? (removed.item.source ? [removed.item.source] : [])) {
        if (content.recipes && !linked.some((recipe) => recipe.recipeId === source.recipeId && recipe.versionId === source.versionId && recipe.servings === source.servings)) throw new DomainError("CONFLICT", "The recipe or its servings changed. Add the recipe again to restore its items.");
        const key = source.recipeId + source.versionId;
        if (!validated.has(key)) { await exactRecipeVersion(tx, actor, source.recipeId, source.versionId); validated.add(key); }
      }
      let group = content.groups.find((entry) => entry.id === removed.groupId);
      if (!group) { group = { id: removed.groupId, name: removed.groupName, items: [] }; content.groups.splice(removed.groupIndex, 0, group); }
      group.items.splice(removed.index, 0, removed.item);
      existingIds.add(removed.item.id);
    }
    return content;
  });
}
export async function setGroceryItemChecked(db: Database, actor: Actor, id: string, input: unknown): Promise<ArtifactDetail> {
  const data = checkGroceryItemSchema.parse(input);
  return mutateArtifact(db, actor, id, data.expectedRevision, "grocery", (_tx, content) => {
    const item = content.groups.flatMap((group) => group.items).find((entry) => entry.id === data.itemId);
    if (!item) throw new DomainError("NOT_FOUND", "Grocery item not found.");
    item.checked = data.checked;
    return content;
  });
}
export async function addMealPlanEntry(db: Database, actor: Actor, id: string, input: unknown): Promise<ArtifactDetail> {
  const data = addMealEntrySchema.parse(input);
  return mutateArtifact(db, actor, id, data.expectedRevision, "meal-plan", async (tx, content) => {
    content.entries.push(await mealEntry(tx, actor, data.entry));
    return content;
  });
}
export async function removeMealPlanEntry(db: Database, actor: Actor, id: string, input: unknown): Promise<ArtifactDetail> {
  const data = removeMealEntrySchema.parse(input);
  return mutateArtifact(db, actor, id, data.expectedRevision, "meal-plan", (_tx, content) => {
    if (!content.entries.some((entry) => entry.id === data.entryId)) throw new DomainError("NOT_FOUND", "Meal not found.");
    content.entries = content.entries.filter((entry) => entry.id !== data.entryId);
    return content;
  });
}

export async function renameArtifact(db: Database, actor: Actor, id: string, input: unknown): Promise<ArtifactDetail> {
  const data = renameArtifactSchema.parse(input);
  return db.transaction(async (tx) => {
    await assertMembership(tx, actor);
    const [row] = await tx.select().from(artifacts).where(scope(actor, id)).for("update");
    if (!row) throw new DomainError("NOT_FOUND", "List or plan not found.");
    if (row.revision !== data.expectedRevision) throw new DomainError("CONFLICT", "This list or plan changed in another tab or through Sift. Reload it before saving.");
    const [updated] = await tx.update(artifacts).set({ title: data.title, revision: row.revision + 1, updatedAt: new Date(), updatedByUserId: actor.userId }).where(scope(actor, id)).returning();
    return detail(updated);
  });
}
export async function deleteArtifact(db: Database, actor: Actor, id: string, input: unknown): Promise<ArtifactSummary> {
  const data = expectedRevisionSchema.parse(input);
  return db.transaction(async (tx) => {
    await assertMembership(tx, actor);
    const [row] = await tx.select().from(artifacts).where(scope(actor, id)).for("update");
    if (!row) throw new DomainError("NOT_FOUND", "List or plan not found.");
    if (row.revision !== data.expectedRevision) throw new DomainError("CONFLICT", "This list or plan changed after the delete was proposed. Review it again before deleting.");
    await tx.delete(artifacts).where(scope(actor, id));
    return summary(row);
  });
}
export async function updateGroceryItem(db: Database, actor: Actor, id: string, input: unknown): Promise<ArtifactDetail> {
  const data = updateGroceryItemSchema.parse(input);
  if (data.text === undefined && data.category === undefined) throw new DomainError("INVALID_INPUT", "Supply item text or a category to edit.");
  return mutateArtifact(db, actor, id, data.expectedRevision, "grocery", (_tx, content) => {
    const item = content.groups.flatMap((group) => group.items).find((entry) => entry.id === data.itemId);
    if (!item) throw new DomainError("NOT_FOUND", "Grocery item not found.");
    // Edited text is the user's own wording; it no longer mirrors a scaled recipe line.
    if (data.text !== undefined && data.text !== item.text) { item.text = data.text; delete item.source; delete item.sources; }
    if (data.category !== undefined) item.category = data.category;
    return content;
  });
}
export async function categorizeGroceryItems(db: Database, actor: Actor, id: string, input: unknown): Promise<ArtifactDetail> {
  const data = categorizeGroceryItemsSchema.parse(input);
  return mutateArtifact(db, actor, id, data.expectedRevision, "grocery", (_tx, content) => {
    const items = new Map(content.groups.flatMap((group) => group.items).map((item) => [item.id, item]));
    for (const change of data.items) {
      const item = items.get(change.itemId);
      if (!item) throw new DomainError("NOT_FOUND", "Grocery item not found.");
      item.category = change.category;
    }
    return content;
  });
}
export async function clearCheckedGroceryItems(db: Database, actor: Actor, id: string, input: unknown): Promise<ArtifactDetail & { removed: number }> {
  const data = clearCheckedGroceryItemsSchema.parse(input);
  let removed = 0;
  const result = await mutateArtifact(db, actor, id, data.expectedRevision, "grocery", (_tx, content) => {
    for (const group of content.groups) { const before = group.items.length; group.items = group.items.filter((item) => !item.checked || (data.itemIds !== undefined && !data.itemIds.includes(item.id))); removed += before - group.items.length; }
    content.groups = content.groups.filter((group) => group.items.length);
    return content;
  });
  return { ...result, removed };
}
export async function updateMealPlanEntry(db: Database, actor: Actor, id: string, input: unknown): Promise<ArtifactDetail> {
  const { expectedRevision, entryId, ...changes } = updateMealEntrySchema.parse(input);
  return mutateArtifact(db, actor, id, expectedRevision, "meal-plan", (_tx, content) => {
    const entry = content.entries.find((item) => item.id === entryId);
    if (!entry) throw new DomainError("NOT_FOUND", "Meal not found.");
    if (changes.date !== undefined) entry.date = changes.date;
    if (changes.meal !== undefined) entry.meal = changes.meal;
    if (changes.title !== undefined) entry.title = changes.title;
    if (changes.servings !== undefined) entry.servings = changes.servings;
    if (changes.note !== undefined) entry.note = changes.note;
    return content;
  });
}

export async function addShoppingRecipe(db: Database, actor: Actor, id: string, input: unknown): Promise<ArtifactDetail> {
  const data = addShoppingRecipeSchema.parse(input);
  return mutateArtifact(db, actor, id, data.expectedRevision, "grocery", async (tx, previous) => {
    const content = expandRecipeItems(previous, randomUUID);
    if (content.recipes!.some((source) => source.recipeId === data.recipeId)) return previous;
    if (content.recipes!.length >= 30) throw new DomainError("INVALID_INPUT", "A shopping list can hold up to 30 recipes.");
    const recipe = await exactRecipeVersion(tx, actor, data.recipeId, data.versionId);
    const servings = data.servings ?? recipe.servings;
    const source = { recipeId: data.recipeId, versionId: data.versionId, servings };
    content.recipes!.push({ ...source, title: recipe.title });
    content.groups.push({ id: randomUUID(), name: "", items: recipe.ingredientSections.flatMap((section, sectionIndex) => section.items.map((item, itemIndex) => ({ id: randomUUID(), checked: false, text: scaledText(item, servings / recipe.servings), source: { ...source, ingredientKey: `${sectionIndex}:${itemIndex}` } }))) });
    if (content.groups.reduce((count, group) => count + group.items.length, 0) > 1000) throw new DomainError("INVALID_INPUT", "A shopping list can hold up to 1,000 ingredient lines.");
    return combineGroceryItems(content, randomUUID);
  });
}
export async function removeShoppingRecipe(db: Database, actor: Actor, id: string, input: unknown): Promise<ArtifactDetail> {
  const data = removeShoppingRecipeSchema.parse(input);
  return mutateArtifact(db, actor, id, data.expectedRevision, "grocery", (_tx, previous) => {
    const content = expandRecipeItems(previous, randomUUID);
    content.recipes = content.recipes!.filter((recipe) => recipe.recipeId !== data.recipeId);
    content.groups = content.groups.map((group) => ({ ...group, items: group.items.filter((item) => item.source?.recipeId !== data.recipeId) }));
    return combineGroceryItems(content, randomUUID);
  });
}
export async function updateShoppingRecipe(db: Database, actor: Actor, id: string, input: unknown): Promise<ArtifactDetail> {
  const data = updateShoppingRecipeSchema.parse(input);
  return mutateArtifact(db, actor, id, data.expectedRevision, "grocery", async (tx, previous) => {
    const content = expandRecipeItems(previous, randomUUID);
    const source = content.recipes!.find((recipe) => recipe.recipeId === data.recipeId);
    if (!source) throw new DomainError("NOT_FOUND", "Recipe not found in this list.");
    const recipe = await exactRecipeVersion(tx, actor, source.recipeId, source.versionId);
    for (const group of content.groups) for (const item of group.items) {
      if (item.source?.recipeId !== data.recipeId) continue;
      const [sectionIndex, itemIndex] = item.source.ingredientKey?.split(":").map(Number) ?? [];
      const original = recipe.ingredientSections[sectionIndex]?.items[itemIndex];
      const text = original ? scaledText(original, data.servings / recipe.servings) : scaledText({ text: item.text }, data.servings / source.servings);
      if (text !== item.text) item.checked = false;
      item.text = text; item.source.servings = data.servings;
    }
    source.servings = data.servings;
    return combineGroceryItems(content, randomUUID);
  });
}
