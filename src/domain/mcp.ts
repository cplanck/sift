import { z } from "zod";
import { recipeContentSchema } from "./recipe";

export const mcpCreateRecipeSchema = z.object({
  requestId: z.uuid().describe("Generate one UUID for this save and reuse it only when retrying the same recipe."),
  content: recipeContentSchema.strict(),
  sourceName: z.string().trim().min(1).max(120).optional(),
  sourceUrl: z.url().max(2048).refine((value) => ["http:", "https:"].includes(new URL(value).protocol)).optional(),
}).strict();
export const mcpSearchRecipesSchema = z.object({
  query: z.string().trim().max(200).default(""), includeArchived: z.boolean().default(false),
  offset: z.number().int().min(0).max(100000).default(0), limit: z.number().int().min(1).max(20).default(10),
}).strict();
export const mcpGetRecipeSchema = z.object({
  recipeId: z.uuid(), view: z.enum(["full", "ingredients", "instructions"]).default("full"),
  expectedVersionId: z.uuid().optional(), offset: z.number().int().min(0).max(10000).default(0), limit: z.number().int().min(1).max(50).default(20),
}).strict();
export const mcpUpdateRecipeSchema = z.object({
  recipeId: z.uuid(), expectedVersionId: z.uuid(), content: recipeContentSchema.strict(),
  changeSummary: z.string().trim().min(1).max(500),
}).strict();

// OAuth identity is supplied by the server, never accepted in tool arguments.
export const mcpSourceClientSchema = z.object({ clientId: z.string().min(1).max(2048), clientName: z.string().trim().min(1).max(300) }).strict();
export type McpSourceClient = z.infer<typeof mcpSourceClientSchema>;
