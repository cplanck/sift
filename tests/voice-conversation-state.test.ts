import { describe, expect, it } from "vitest";
import { voiceConversationError } from "@/components/voice-conversation-state";

describe("Voice polling decisions", () => {
  const lastError = "The previous reply was interrupted. Review saved changes.";

  it("distinguishes an interrupted turn from a failed turn without interpreting the error text", () => {
    expect(voiceConversationError({ busy: false, lastError, lastTurn: { id: "old", status: "aborted" } })).toBeNull();
    expect(voiceConversationError({ busy: false, lastError, lastTurn: { id: "new", status: "failed" } })).toBe(lastError);
  });

  it("waits for an active reply but preserves errors on an expired or unknown turn", () => {
    expect(voiceConversationError({ busy: true, lastError, lastTurn: { id: "new", status: "running" } })).toBeNull();
    expect(voiceConversationError({ busy: false, lastError, lastTurn: { id: "expired", status: "running" } })).toBe(lastError);
    expect(voiceConversationError({ busy: false, lastError, lastTurn: null })).toBe(lastError);
    expect(voiceConversationError({ busy: false, lastError: null, lastTurn: { id: "done", status: "completed" } })).toBeNull();
  });
});
