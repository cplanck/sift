import { randomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import type { Database, Executor } from "@/db/connection";
import { artifacts, recipes, recipeVersions } from "@/db/schema";
import { addGroceryItemsSchema, addMealEntrySchema, artifactContentSchema, checkGroceryItemSchema, createArtifactSchema, deriveGrocerySchema, removeGroceryItemSchema, removeMealEntrySchema, type ArtifactContent, type ArtifactDetail, type ArtifactKind, type ArtifactSummary, type MealEntryInput } from "@/domain/artifact";
import { DomainError } from "@/domain/errors";
import { normalizeSearch, type Ingredient } from "@/domain/recipe";
import { parseIngredient, scaleIngredient } from "@/domain/scaling";
import { assertMembership, type Actor } from "./workspaces";

const listSchema = z.object({ kind: z.enum(["grocery", "meal-plan"]).optional(), query: z.string().trim().max(200).optional() }).strict();
type ContentOf<Kind extends ArtifactKind> = Extract<ArtifactContent, { kind: Kind }>;

function scope(actor: Actor, id: string) {
  if (!z.uuid().safeParse(id).success) throw new DomainError("NOT_FOUND", "List or plan not found.");
  return and(eq(artifacts.workspaceId, actor.workspaceId), eq(artifacts.id, id));
}
function summary(row: Pick<typeof artifacts.$inferSelect, "id" | "kind" | "title" | "revision" | "updatedAt">): ArtifactSummary {
  return { id: row.id, kind: row.kind, title: row.title, revision: row.revision, updatedAt: row.updatedAt.toISOString() };
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
  const rows = await db.select({ id: artifacts.id, kind: artifacts.kind, title: artifacts.title, revision: artifacts.revision, updatedAt: artifacts.updatedAt }).from(artifacts)
    .where(and(eq(artifacts.workspaceId, actor.workspaceId), data.kind ? eq(artifacts.kind, data.kind) : undefined)).orderBy(desc(artifacts.updatedAt));
  const query = normalizeSearch(data.query ?? "");
  return rows.filter((row) => !query || normalizeSearch(row.title).includes(query)).map(summary);
}
export async function createArtifact(db: Database, actor: Actor, input: unknown): Promise<ArtifactDetail> {
  const data = createArtifactSchema.parse(input);
  return db.transaction(async (tx) => {
    await assertMembership(tx, actor);
    if (data.kind === "grocery") {
      if (data.groups.reduce((total, group) => total + group.items.length, 0) > 1000) throw new DomainError("INVALID_INPUT", "A grocery list can hold up to 1,000 items. Split this into smaller lists.");
      return insertArtifact(tx, actor, data.title, { kind: "grocery", groups: data.groups.map((group) => ({ id: randomUUID(), name: group.name, items: group.items.map((item) => ({ id: randomUUID(), text: item.text, checked: false })) })) });
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
    for (const source of data.recipes) {
      const recipe = await exactRecipeVersion(tx, actor, source.recipeId, source.versionId);
      const servings = source.servings ?? recipe.servings;
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
    return insertArtifact(tx, actor, data.title, { kind: "grocery", groups });
  });
}

async function mutateArtifact<Kind extends ArtifactKind>(db: Database, actor: Actor, id: string, expectedRevision: number, kind: Kind, change: (tx: Database, content: ContentOf<Kind>) => ContentOf<Kind> | Promise<ContentOf<Kind>>): Promise<ArtifactDetail> {
  return db.transaction(async (tx) => {
    await assertMembership(tx, actor);
    const [row] = await tx.select().from(artifacts).where(scope(actor, id)).for("update");
    if (!row) throw new DomainError("NOT_FOUND", "List or plan not found.");
    if (row.kind !== kind || row.content.kind !== kind) throw new DomainError("INVALID_INPUT", kind === "grocery" ? "Choose a grocery list for this action." : "Choose a meal plan for this action.");
    if (row.revision !== expectedRevision) throw new DomainError("CONFLICT", "This list or plan changed in another tab or through Sift. Reload it before saving.");
    const content = artifactContentSchema.parse(await change(tx, structuredClone(row.content) as ContentOf<Kind>));
    const [updated] = await tx.update(artifacts).set({ content, revision: row.revision + 1, updatedAt: new Date(), updatedByUserId: actor.userId }).where(scope(actor, id)).returning();
    return detail(updated);
  });
}
export async function addGroceryItems(db: Database, actor: Actor, id: string, input: unknown): Promise<ArtifactDetail> {
  const data = addGroceryItemsSchema.parse(input);
  return mutateArtifact(db, actor, id, data.expectedRevision, "grocery", (_tx, content) => {
    let group = content.groups.find((entry) => entry.name === data.groupName);
    if (!group) {
      if (data.groupName.length > 100) throw new DomainError("INVALID_INPUT", "Keep new group names to 100 characters or fewer.");
      group = { id: randomUUID(), name: data.groupName, items: [] }; content.groups.push(group);
    }
    group.items.push(...data.items.map((item) => ({ id: randomUUID(), text: item.text, checked: false })));
    return content;
  });
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
