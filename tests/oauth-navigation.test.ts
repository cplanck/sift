import { describe, expect, it } from "vitest";
import { isOAuthCallback, oauthSearchQuery } from "../src/lib/oauth-navigation";

describe("browser OAuth continuation boundaries", () => {
  it("preserves repeated signed request fields when Next decodes search parameters", () => {
    const query = new URLSearchParams(oauthSearchQuery({ client_id: "registered app", ba_param: ["client_id", "redirect_uri"], missing: undefined }));
    expect(query.getAll("ba_param")).toEqual(["client_id", "redirect_uri"]);
    expect(query.get("client_id")).toBe("registered app");
    expect(query.has("missing")).toBe(false);
  });
  it("accepts response fields only at the exact approved callback while preserving its query", () => {
    const callback = "https://client.example/oauth/callback?instance=1&instance=2";
    expect(isOAuthCallback(`${callback}&code=authorized&state=state`, callback)).toBe(true);
    for (const candidate of [
      "https://other.example/oauth/callback?instance=1&instance=2", "http://client.example/oauth/callback?instance=1&instance=2",
      "https://client.example/other?instance=1&instance=2", "https://client.example/oauth/callback?instance=changed",
      "https://client.example/oauth/callback?instance=1&instance=2#fragment", "https://user@client.example/oauth/callback?instance=1&instance=2", "//client.example/oauth/callback",
    ]) expect(isOAuthCallback(candidate, callback)).toBe(false);
  });
  it("supports registered private-use native callbacks without accepting arbitrary executable schemes", () => {
    expect(isOAuthCallback("com.example.cook:/oauth?code=authorized", "com.example.cook:/oauth")).toBe(true);
    expect(isOAuthCallback("com.other.cook:/oauth?code=authorized", "com.example.cook:/oauth")).toBe(false);
    expect(isOAuthCallback("com.example.cook://unregistered/oauth?code=authorized", "com.example.cook:/oauth")).toBe(false);
    expect(isOAuthCallback("javascript:alert(1)", "javascript:alert(1)")).toBe(false);
  });
});
