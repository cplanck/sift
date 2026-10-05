import { z } from "zod";
import type { RecipeContent } from "./recipe";

const servings = z.number().positive().max(1000);
const checkoffKey = z.string().regex(/^\d{1,2}:\d{1,3}$/);
export const cookingProgressValueSchema = z.object({
  checkedIngredients: z.array(checkoffKey).max(6000),
  checkedSteps: z.array(checkoffKey).max(3000),
  currentStep: z.number().int().nonnegative().max(2999),
}).strict();
export const cookingStartSchema = z.object({ recipeId: z.uuid(), expectedVersionId: z.uuid(), servings: servings.optional() }).strict();
export const cookingProgressSchema = z.object({ expectedRevision: z.number().int().positive(), progress: cookingProgressValueSchema, servings: servings.optional() }).strict();
export const cookingFinishSchema = z.object({
  expectedRevision: z.number().int().positive(), status: z.enum(["completed", "abandoned"]),
  rating: z.number().int().min(1).max(5).nullable().optional(), summary: z.string().trim().max(5000).nullable().optional(),
}).strict();
export const cookingNoteSchema = z.object({ body: z.string().trim().min(1).max(5000) }).strict();
export type CookingProgress = z.infer<typeof cookingProgressValueSchema>;
export interface CookingSessionSummary {
  id: string; recipeId: string; recipeVersionId: string; startedByUserId: string | null;
  startedAt: string; finishedAt: string | null; status: "active" | "completed" | "abandoned";
  servings: number; revision: number; progress: CookingProgress; rating: number | null; summary: string | null;
}
export interface CookingSessionDetail extends CookingSessionSummary {
  version: { id: string; number: number; content: RecipeContent };
  notes: { id: string; body: string; createdByUserId: string | null; createdAt: string }[];
  photos: { id: string; width: number | null; height: number | null; createdAt: string }[];
}
export interface CookingHistoryItem extends CookingSessionSummary { versionNumber: number; title: string }
