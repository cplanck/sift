import { z } from "zod";

export const clientPageContextSchema = z.object({
  route: z.string().min(1).max(200),
  activeRecipeId: z.uuid().optional(),
  activeRecipeVersionId: z.uuid().optional(),
  activeCookingSessionId: z.uuid().optional(),
  activeArtifactId: z.uuid().optional(),
}).strict();
export type ClientPageContext = z.infer<typeof clientPageContextSchema>;
export interface AppContext extends ClientPageContext {
  userId: string;
  workspaceId: string;
  surface: "library" | "recipe" | "cooking" | "conversation" | "artifact";
  activeCookingSessionId?: string;
}
const requestBase = {
  conversationId: z.uuid(), requestId: z.uuid(), context: clientPageContextSchema,
};
export const assistantRequestSchema = z.union([
  z.object({ ...requestBase, message: z.object({ id: z.uuid(), text: z.string().trim().min(1).max(8000) }).strict() }).strict(),
  z.object({ ...requestBase, approval: z.object({ id: z.string().min(1).max(200), approved: z.boolean() }).strict() }).strict(),
]);
export type AssistantRequest = z.infer<typeof assistantRequestSchema>;
