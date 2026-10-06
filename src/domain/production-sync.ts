import { z } from "zod";

export const productionSyncResultSchema = z.object({
  applied: z.boolean(),
  summary: z.record(z.string().regex(/^[a-z_]+$/), z.object({ insert: z.number().int().nonnegative(), update: z.number().int().nonnegative(), unchanged: z.number().int().nonnegative(), conflict: z.number().int().nonnegative() })),
  conflicts: z.array(z.object({ table: z.string(), reason: z.string() })),
}).strict();
export type ProductionSyncResult = z.infer<typeof productionSyncResultSchema>;
export const syncLabels: Record<string, string> = { recipes: "Recipes", recipe_versions: "Recipe versions", cooking_sessions: "Cooking history", cooking_session_notes: "Cooking notes", photos: "Photos", recipe_notes: "Recipe notes", recipe_favorites: "Favorites", recipe_imports: "Imports", artifacts: "Lists and meal plans", conversations: "Conversations", conversation_turns: "Chat history", conversation_tool_calls: "Assistant actions", ai_usage: "AI usage history", voice_sessions: "Voice history", voice_turns: "Voice turns" };
