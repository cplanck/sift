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
  z.object({ ...requestBase, message: z.object({
    id: z.uuid(), text: z.string().trim().max(8000).default(""),
    // Uploaded chat photos (purpose "chat"); a message may be photos alone.
    photoIds: z.array(z.uuid()).max(4).default([]),
  }).strict().refine((message) => !!message.text || message.photoIds.length > 0, "Write a message or attach a photo.") }).strict(),
  z.object({ ...requestBase, approval: z.object({ id: z.string().min(1).max(200), approved: z.boolean() }).strict() }).strict(),
]);
export type AssistantRequest = z.input<typeof assistantRequestSchema>;
