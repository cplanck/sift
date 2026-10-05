import { z } from "zod";

export const quantitySchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("exact"), value: z.number().nonnegative().max(100000) }),
  z.object({ kind: z.literal("range"), min: z.number().nonnegative(), max: z.number().nonnegative() }).refine((q) => q.max >= q.min && q.max <= 100000),
]);
export const ingredientSchema = z.object({
  text: z.string().trim().min(1).max(1000),
  quantity: quantitySchema.optional(),
  unit: z.string().max(50).optional(),
  item: z.string().max(500).optional(),
});
export const recipeContentSchema = z.object({
  title: z.string().trim().min(1).max(160),
  description: z.string().trim().max(4000).default(""),
  servings: z.number().positive().max(1000).default(4),
  yieldText: z.string().trim().max(150).default(""),
  prepMinutes: z.number().int().nonnegative().max(10080).nullable().default(null),
  cookMinutes: z.number().int().nonnegative().max(10080).nullable().default(null),
  totalMinutes: z.number().int().nonnegative().max(20160).nullable().default(null),
  ingredientSections: z.array(z.object({ name: z.string().trim().max(150).default(""), items: z.array(ingredientSchema).min(1).max(200) })).min(1).max(30),
  instructionSections: z.array(z.object({ name: z.string().trim().max(150).default(""), steps: z.array(z.string().trim().min(1).max(5000)).min(1).max(100) })).min(1).max(30),
  tags: z.array(z.string().trim().min(1).max(60)).max(30).default([]),
  collections: z.array(z.string().trim().min(1).max(60)).max(30).default([]),
});
export const sourceSchema = z.object({
  type: z.enum(["manual", "paste", "url", "image", "mcp"]),
  url: z.url().refine((value) => ["http:", "https:"].includes(new URL(value).protocol)).optional(),
  name: z.string().trim().max(300).optional(),
  rawText: z.string().max(80000).optional(),
  importedAt: z.iso.datetime().optional(),
});
export const createRecipeSchema = z.object({ content: recipeContentSchema, source: sourceSchema.default({ type: "manual" }), status: z.enum(["draft", "active"]).default("active") });
export const updateRecipeSchema = z.object({ content: recipeContentSchema, expectedVersionId: z.uuid(), changeSummary: z.string().trim().min(1).max(500) });
export type RecipeContent = z.infer<typeof recipeContentSchema>;
export type Ingredient = z.infer<typeof ingredientSchema>;
export type RecipeSource = z.infer<typeof sourceSchema>;

export interface RecipeSummary {
  id: string;
  versionId: string;
  title: string;
  description: string;
  tags: string[];
  collections: string[];
  ingredientsText: string;
  notesText: string;
  totalMinutes: number | null;
  status: "draft" | "active" | "archived";
  favorite: boolean;
  updatedAt: string;
  coverPhotoId: string | null;
}

export function normalizeSearch(value: string) { return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("en").trim(); }
export function searchRank(recipe: RecipeSummary, query: string) {
  const q = normalizeSearch(query), title = normalizeSearch(recipe.title);
  if (!q) return 0;
  if (title === q) return 0;
  if (title.startsWith(q)) return 1;
  if (title.includes(q)) return 2;
  if (normalizeSearch([...recipe.tags, ...recipe.collections].join(" ")).includes(q)) return 3;
  if (normalizeSearch(recipe.ingredientsText).includes(q)) return 4;
  if (normalizeSearch(`${recipe.description} ${recipe.notesText}`).includes(q)) return 5;
  return Infinity;
}
export function searchLibrary(recipes: RecipeSummary[], query: string) {
  return recipes.map((recipe) => ({ recipe, rank: searchRank(recipe, query) })).filter(({ rank }) => Number.isFinite(rank))
    .sort((a, b) => a.rank - b.rank || b.recipe.updatedAt.localeCompare(a.recipe.updatedAt) || a.recipe.title.localeCompare(b.recipe.title))
    .map(({ recipe }) => recipe);
}
