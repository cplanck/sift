import { describe, expect, it } from "vitest";
import { ConfigurationError, parseEnv } from "@/lib/env";

describe("environment validation", () => {
  it("permits a credential-free build and normalizes empty provider settings", () => {
    expect(parseEnv({ DATABASE_URL: "" }).DATABASE_URL).toBeUndefined();
    expect(parseEnv({}).BETTER_AUTH_URL).toBe("http://localhost:3003");
  });
  it("reports invalid variable names without leaking their values", () => {
    expect(() => parseEnv({ BETTER_AUTH_SECRET: "secret-value" })).toThrow(ConfigurationError);
    expect(() => parseEnv({ BETTER_AUTH_SECRET: "secret-value" })).not.toThrow(/secret-value/);
    expect(() => parseEnv({ DATABASE_URL: "https://wrong.example" })).toThrow(/DATABASE_URL/);
  });
  it("allows a separate HTTPS voice callback while keeping local authentication unchanged", () => {
    expect(parseEnv({ ELEVENLABS_CALLBACK_ORIGIN: "" }).ELEVENLABS_CALLBACK_ORIGIN).toBeUndefined();
    expect(parseEnv({ BETTER_AUTH_URL: "http://localhost:3003", ELEVENLABS_CALLBACK_ORIGIN: "https://sift-voice-dev.akleao.com/" })).toMatchObject({
      BETTER_AUTH_URL: "http://localhost:3003", ELEVENLABS_CALLBACK_ORIGIN: "https://sift-voice-dev.akleao.com",
    });
  });
  it("rejects insecure or non-origin voice callback settings without exposing values", () => {
    for (const value of ["http://localhost:3003", "https://user:private-secret@example.com", "https://example.com/callback", "https://example.com?token=private-secret", "https://example.com#private-secret", "not-a-url"]) {
      expect(() => parseEnv({ ELEVENLABS_CALLBACK_ORIGIN: value })).toThrow(/ELEVENLABS_CALLBACK_ORIGIN/);
      expect(() => parseEnv({ ELEVENLABS_CALLBACK_ORIGIN: value })).not.toThrow(/private-secret/);
    }
  });
});
