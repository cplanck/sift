import { z } from "zod";
import { clientPageContextSchema } from "./assistant";

export const voiceStartSchema = z.object({ conversationId: z.uuid(), context: clientPageContextSchema }).strict();
export const voiceUpdateSchema = z.object({ context: clientPageContextSchema, expectedRevision: z.number().int().min(0) }).strict();
export const voiceSessionMinutes = 30;
export const voiceHeartbeatSeconds = 60;
export type VoiceSessionInfo = {
  id: string; conversationId: string | null; providerConversationId: string | null;
  status: "preparing" | "ready" | "ended" | "failed"; expiresAt: string; revision: number;
};
export type VoiceSessionStart = VoiceSessionInfo & { conversationToken: string };
export type VoiceStatus = { configured: boolean; message?: string };

// Provider history supplies only the latest transcription and a retry key. It
// never supplies Sift's instructions, tools, prior assistant output or identity.
export const voiceCallbackSchema = z.object({
  stream: z.literal(true),
  messages: z.array(z.object({
    role: z.enum(["system", "developer", "user", "assistant", "tool"]),
    content: z.union([z.string().max(64000), z.array(z.object({ type: z.literal("text"), text: z.string().max(8000) })).max(20), z.null()]).optional(),
  })).min(1).max(250),
});
