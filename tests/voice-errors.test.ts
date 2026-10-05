import { describe, expect, it } from "vitest";
import { classifyVoiceError } from "@/components/voice-errors";

describe("Safe ElevenLabs client error classification", () => {
  it.each([
    ["NotAllowedError", "microphone_permission"],
    ["SecurityError", "microphone_permission"],
    ["NotFoundError", "microphone_missing"],
    ["OverconstrainedError", "microphone_missing"],
    ["NotReadableError", "microphone_busy"],
    ["DeviceUnsupportedError", "audio_unsupported"],
    ["PublishTrackError", "voice_audio"],
    ["NegotiationError", "voice_network"],
  ])("classifies a structured %s without exposing its exception text", (name, category) => {
    const failure = classifyVoiceError(Object.assign(new Error("private token and device information"), { name }));
    expect(failure.diagnostic).toEqual({ category, name });
    expect(failure.message).not.toContain("private");
  });

  it("distinguishes LiveKit connection authorization from microphone permission", () => {
    const failure = classifyVoiceError({ name: "ConnectionError", reason: 0, status: 401, code: 1 });
    expect(failure.diagnostic).toEqual({ category: "voice_auth", name: "ConnectionError", reason: "NotAllowed", status: 401, code: 1 });
    expect(failure.message).toContain("voice service rejected");
    expect(failure.message).not.toContain("microphone");
    expect(classifyVoiceError({ name: "ConnectionError", reasonName: "Timeout", reason: 5 }).diagnostic.category).toBe("voice_network");
  });

  it.each(["custom_llm_error", "llm_error", "llm_timeout", "cascade_brain_error"])("points %s to the server and saved conversation", (errorType) => {
    const failure = classifyVoiceError({ errorType, code: 1011, debugMessage: "private provider details" });
    expect(failure.diagnostic).toEqual({ category: "voice_reply", errorType, code: 1011 });
    expect(failure.message).toContain("server couldn’t accept or finish");
    expect(failure.message).toContain("conversation");
    expect(failure.message).not.toContain("microphone");
  });

  it("reports only a known rate-limit status without assuming an opaque provider detail means billing", () => {
    const failure = classifyVoiceError({ errorType: "http_exception", status: 429, details: { token: "secret", message: "account billing declined" } });
    expect(failure.diagnostic.category).toBe("voice_rate_limit");
    expect(failure.message).toContain("try again later");
    expect(failure.message).not.toContain("billing");
  });

  it("distinguishes speech recognition, speech generation and configuration failures", () => {
    expect(classifyVoiceError({ errorType: "asr_transcription_error" }).diagnostic.category).toBe("voice_transcription");
    expect(classifyVoiceError({ errorType: "tts_cascade_error" }).diagnostic.category).toBe("voice_speech");
    expect(classifyVoiceError({ errorType: "missing_dynamic_variable" }).diagnostic.category).toBe("voice_configuration");
    expect(classifyVoiceError({ errorType: "unknown" }).diagnostic.category).toBe("voice_reply");
  });

  it("reads the SDK’s structured disconnect shape without exposing close reasons", () => {
    const limit = classifyVoiceError({ reason: "error", message: "private text", context: { type: "max_duration_exceeded" }, closeReason: "private close reason" });
    expect(limit.diagnostic).toEqual({ category: "voice_time_limit", errorType: "max_duration_exceeded" });
    expect(classifyVoiceError({ reason: "error", context: { type: "connection_state_changed" } }).diagnostic.category).toBe("voice_network");
    expect(classifyVoiceError({ name: "SessionConnectionError", closeCode: 1006 }).diagnostic.category).toBe("voice_network");
  });

  it("drops all unknown strings, nested provider payloads and non-allowlisted numeric values", () => {
    const secret = "Bearer private-key-or-conversation-token";
    const context = { name: secret, reasonName: secret, errorType: secret, message: secret, stack: secret, cause: secret,
      debugMessage: secret, details: { authorization: secret }, status: 123456, code: 123456, context: { type: secret, code: 123456 } };
    const failure = classifyVoiceError(context);
    expect(failure.diagnostic).toEqual({ category: "voice_failed" });
    expect(JSON.stringify(failure)).not.toContain(secret);
    expect(JSON.stringify(failure)).not.toContain("123456");
  });

  it("handles absent or malformed SDK context without guessing a microphone or playback problem", () => {
    for (const context of [undefined, null, "raw secret message", 123, { get name() { throw new Error("private getter error"); } }]) {
      const failure = classifyVoiceError(context);
      expect(failure.diagnostic).toEqual({ category: "voice_failed" });
      expect(failure.message).not.toMatch(/microphone|playback|private|secret/);
    }
  });
});
