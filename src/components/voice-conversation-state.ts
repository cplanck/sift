import type { Conversation } from "./assistant-shell";

export function voiceConversationError(saved: Pick<Conversation, "busy" | "lastError" | "lastTurn">): string | null {
  // ElevenLabs may cancel the previous HTTP reply before the next utterance
  // arrives. Its saved interruption stays visible in text without ending the
  // connected voice session. Provider disconnects still end through the SDK.
  if (saved.busy || saved.lastTurn?.status === "aborted") return null;
  return saved.lastError;
}
