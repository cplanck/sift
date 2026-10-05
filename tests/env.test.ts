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
});
