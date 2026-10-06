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
  notes: z.string().trim().max(20000).optional(),
}).strict();
export const cookingNoteSchema = z.object({ body: z.string().trim().min(1).max(5000) }).strict();
export type CookingProgress = z.infer<typeof cookingProgressValueSchema>;
/** Save the checkoff and navigation together so other devices see one update. */
export function completeCookingStep(progress: CookingProgress, stepKeys: readonly string[]): CookingProgress {
  const key = stepKeys[progress.currentStep];
  if (!key) return progress;
  return { ...progress, checkedSteps: progress.checkedSteps.includes(key) ? progress.checkedSteps : [...progress.checkedSteps, key], currentStep: Math.min(progress.currentStep + 1, stepKeys.length - 1) };
}
export interface CookingSessionSummary {
  id: string; recipeId: string; recipeVersionId: string; startedByUserId: string | null;
  startedAt: string; finishedAt: string | null; status: "active" | "completed" | "abandoned";
  servings: number; revision: number; progress: CookingProgress; rating: number | null; summary: string | null;
}
export interface CookingSessionDetail extends CookingSessionSummary {
  version: { id: string; number: number; content: RecipeContent };
  notes: CookingNote[];
  photos: { id: string; width: number | null; height: number | null; createdAt: string }[];
}
export interface CookingNote {
  id: string; body: string; organizedBody: string | null; cleanupStatus: "none" | "queued" | "processing" | "ready" | "failed";
  createdByUserId: string | null; createdAt: string;
}
export interface CookingHistoryItem extends CookingSessionSummary { versionNumber: number; title: string; notes: CookingNote[] }
