import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConfigurationError } from "@/lib/env";
import { buildElevenAgentConfig } from "@/voice/config";
import { createElevenVoiceToken, getElevenConversationFailure, getElevenConversationUsage, verifyElevenWebhook } from "@/voice/elevenlabs";

const secret = "test-webhook-secret-for-elevenlabs-000000000";
const sensitive = "private-provider-response-and-credential";
const providerFetch = vi.fn<typeof fetch>();
const agentDefinition = () => ({ agent_id: "agent_sift", ...buildElevenAgentConfig({ origin: "https://sift.example", voiceId: "voice", secretId: "secret", webhookId: "webhook" }) });
const tokenResponse = (response: Response) => providerFetch.mockImplementation(async (url) => String(url).includes("/agents/") ? Response.json(agentDefinition()) : response);
const usage = {
  agent_id: "agent_sift", conversation_id: "conv_sift", status: "done",
  metadata: { call_duration_secs: 52, cost: 296, cost_fiat: 0.0521 },
  transcript: [{ role: "user", message: sensitive }],
};
const webhook = (data: unknown = usage, timestamp = Math.floor(Date.now() / 1000)) => {
  const body = JSON.stringify({ type: "post_call_transcription", event_timestamp: timestamp, data });
  return { body, signature: `t=${timestamp},v0=${createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex")}` };
};
beforeEach(() => {
  vi.stubGlobal("fetch", providerFetch); providerFetch.mockReset();
  vi.stubEnv("ELEVENLABS_API_KEY", sensitive);
  vi.stubEnv("BETTER_AUTH_URL", "https://sift.example");
  vi.stubEnv("ELEVENLABS_CALLBACK_ORIGIN", "");
  vi.stubEnv("ELEVENLABS_AGENT_ID", "agent_sift");
  vi.stubEnv("ELEVENLABS_LLM_SECRET", "test-llm-secret-for-elevenlabs-000000000");
  vi.stubEnv("ELEVENLABS_WEBHOOK_SECRET", secret);
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("private ElevenLabs transport", () => {
  it("requires callback configuration and binds the provider ID returned with the WebRTC token", async () => {
    tokenResponse(Response.json({ token: "short-lived-browser-token", conversation_id: "conv_sift" }));
    await expect(createElevenVoiceToken()).resolves.toEqual({ conversationToken: "short-lived-browser-token", providerConversationId: "conv_sift", agentId: "agent_sift" });
    expect(providerFetch).toHaveBeenCalledWith("https://api.elevenlabs.io/v1/convai/conversation/token?agent_id=agent_sift", expect.objectContaining({
      cache: "no-store", redirect: "error", headers: { "xi-api-key": sensitive, Accept: "application/json" },
    }));
    vi.stubEnv("ELEVENLABS_LLM_SECRET", "");
    await expect(createElevenVoiceToken()).rejects.toBeInstanceOf(ConfigurationError);
    expect(providerFetch).toHaveBeenCalledTimes(2);
  });

  it("rejects a token without a provider conversation ID instead of trusting a later browser claim", async () => {
    tokenResponse(Response.json({ token: sensitive }));
    await expect(createElevenVoiceToken()).rejects.toMatchObject({ code: "VOICE_UNAVAILABLE" });
  });

  it.each([
    [402, undefined, "VOICE_CREDITS"], [401, "quota_exceeded", "VOICE_CREDITS"], [403, "insufficient_credits", "VOICE_CREDITS"],
    [401, "missing_permissions", "VOICE_AUTH"], [403, undefined, "VOICE_AUTH"], [429, undefined, "VOICE_RATE_LIMITED"],
    [404, undefined, "VOICE_CONFIGURATION"], [422, undefined, "VOICE_CONFIGURATION"], [503, undefined, "VOICE_UNAVAILABLE"],
  ])("exposes an actionable safe failure for provider HTTP %s / %s", async (status, machineCode, code) => {
    tokenResponse(Response.json({ detail: { status: machineCode, message: sensitive }, apiKey: sensitive }, { status }));
    const error = await createElevenVoiceToken().catch((caught: unknown) => caught);
    expect(error).toMatchObject({ code });
    expect(String(error)).not.toContain(sensitive);
    expect(JSON.stringify(error)).not.toContain(sensitive);
    expect(error).not.toHaveProperty("cause");
    expect(providerFetch).toHaveBeenCalledTimes(2); // One config read, one mint; no automatic mint retry.
  });

  it("sanitizes network failures and oversized provider bodies", async () => {
    providerFetch.mockRejectedValueOnce(new Error(sensitive));
    await expect(createElevenVoiceToken()).rejects.toMatchObject({ code: "VOICE_UNAVAILABLE" });
    providerFetch.mockResolvedValueOnce(new Response("x".repeat(2 * 1024 * 1024 + 1)));
    await expect(createElevenVoiceToken()).rejects.toMatchObject({ code: "VOICE_UNAVAILABLE" });
  });

  it("preserves reported dollars and credits separately and drops all transcript content", async () => {
    providerFetch.mockResolvedValue(Response.json(usage));
    await expect(getElevenConversationUsage("conv_sift")).resolves.toEqual({
      providerConversationId: "conv_sift", agentId: "agent_sift", status: "done", durationSeconds: 52, costUsd: "0.0521000000", credits: 296,
    });
    providerFetch.mockResolvedValueOnce(Response.json({ ...usage, metadata: { call_duration_secs: 3, cost: 0 } }));
    await expect(getElevenConversationUsage("conv_sift")).resolves.toMatchObject({ costUsd: null, credits: 0 });
    providerFetch.mockResolvedValueOnce(Response.json({ ...usage, metadata: { call_duration_secs: 3 } }));
    await expect(getElevenConversationUsage("conv_sift")).resolves.toMatchObject({ costUsd: null, credits: null });
  });

  it("reduces a provider hangup reason to a fixed category", async () => {
    providerFetch.mockResolvedValueOnce(Response.json({ status: "failed", metadata: { termination_reason: "", error: { code: 3000, reason: "[quota_exceeded] You've run out of credits." } } }));
    await expect(getElevenConversationFailure("conv_sift")).resolves.toBe("credits");
    providerFetch.mockResolvedValueOnce(Response.json({ status: "failed", metadata: { termination_reason: "This request exceeds your quota limit." } }));
    await expect(getElevenConversationFailure("conv_sift")).resolves.toBe("credits");
    providerFetch.mockResolvedValueOnce(Response.json({ status: "failed", metadata: { termination_reason: "custom_llm generation failed" } }));
    await expect(getElevenConversationFailure("conv_sift")).resolves.toBe("failed");
    providerFetch.mockResolvedValueOnce(Response.json({ status: "done", metadata: { termination_reason: "Client disconnected: 1000" } }));
    await expect(getElevenConversationFailure("conv_sift")).resolves.toBeNull();
    await expect(getElevenConversationFailure("../x")).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it("rejects invalid paths and a provider response for a different conversation", async () => {
    await expect(getElevenConversationUsage("../another-conversation")).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(providerFetch).not.toHaveBeenCalled();
    providerFetch.mockResolvedValue(Response.json({ ...usage, conversation_id: "conv_other" }));
    await expect(getElevenConversationUsage("conv_sift")).rejects.toMatchObject({ code: "VOICE_UNAVAILABLE" });
  });

  it("prevents local/dev sessions from being minted against a different deployment's callback", async () => {
    vi.stubEnv("BETTER_AUTH_URL", "http://localhost:3003");
    await expect(createElevenVoiceToken()).rejects.toMatchObject({ code: "VOICE_CONFIGURATION" });
    expect(providerFetch).not.toHaveBeenCalled();
    vi.stubEnv("BETTER_AUTH_URL", "https://another-sift.example");
    providerFetch.mockResolvedValue(Response.json(agentDefinition()));
    await expect(createElevenVoiceToken()).rejects.toMatchObject({ code: "VOICE_CONFIGURATION" });
    expect(providerFetch).toHaveBeenCalledOnce();
  });

  it("allows an explicit HTTPS callback tunnel backed by the same local app while preserving origin verification", async () => {
    vi.stubEnv("BETTER_AUTH_URL", "http://localhost:3003");
    vi.stubEnv("ELEVENLABS_CALLBACK_ORIGIN", "https://sift.example");
    tokenResponse(Response.json({ token: "private-token", conversation_id: "conv_sift" }));
    await expect(createElevenVoiceToken()).resolves.toMatchObject({ providerConversationId: "conv_sift" });
    vi.stubEnv("ELEVENLABS_CALLBACK_ORIGIN", "https://wrong-tunnel.example");
    await expect(createElevenVoiceToken()).rejects.toMatchObject({ code: "VOICE_CONFIGURATION" });
  });

  it("requires the LLM base URL because ElevenLabs appends chat/completions itself", async () => {
    const agent = agentDefinition();
    agent.conversation_config.agent.prompt.custom_llm.url += "chat/completions";
    providerFetch.mockResolvedValue(Response.json(agent));
    await expect(createElevenVoiceToken()).rejects.toMatchObject({ code: "VOICE_CONFIGURATION" });
    expect(providerFetch).toHaveBeenCalledOnce(); // Reject before minting an unusable token.
  });

  it.each([4, undefined])("rejects a shortened or implicit provider cascade timeout (%s) before minting", async (timeout) => {
    const agent = agentDefinition();
    Object.assign(agent.conversation_config.agent.prompt, { cascade_timeout_seconds: timeout });
    providerFetch.mockResolvedValue(Response.json(agent));
    await expect(createElevenVoiceToken()).rejects.toMatchObject({ code: "VOICE_CONFIGURATION" });
    expect(providerFetch).toHaveBeenCalledOnce();
  });

  it("accepts the API's inert default start node but no linked subgraph or additional behavior", async () => {
    const agent = { ...agentDefinition(), workflow: { nodes: { start: { type: "start", position: { x: 0, y: 0 }, edge_order: [], parent_subgraph_id: null } }, edges: {}, subgraphs: {}, prevent_subagent_loops: true } };
    providerFetch.mockImplementation(async (url) => String(url).includes("/agents/") ? Response.json(agent) : Response.json({ token: "private-token", conversation_id: "conv_sift" }));
    await expect(createElevenVoiceToken()).resolves.toMatchObject({ providerConversationId: "conv_sift" });
    Object.assign(agent.workflow, { subgraphs: { foreign: {} } });
    await expect(createElevenVoiceToken()).rejects.toMatchObject({ code: "VOICE_CONFIGURATION" });
  });

  it.each(["public", "override", "speculative", "idle-reengagement", "tools", "workflow", "procedures", "forged-header"])("fails closed when the provider agent enables %s", async (change) => {
    const agent = agentDefinition();
    if (change === "public") agent.platform_settings.auth.enable_auth = false;
    if (change === "override") agent.platform_settings.overrides.custom_llm_extra_body = true;
    if (change === "speculative") agent.conversation_config.turn.speculative_turn = true;
    if (change === "idle-reengagement") agent.conversation_config.turn.turn_timeout = 30;
    if (change === "tools") Object.assign(agent.conversation_config.agent.prompt, { tool_ids: ["foreign-tool"] });
    if (change === "workflow") Object.assign(agent, { workflow: { nodes: { foreign: {} }, edges: {} } });
    if (change === "procedures") Object.assign(agent, { procedures: { foreign: { procedure_id: "external-procedure" } } });
    if (change === "forged-header") agent.conversation_config.agent.prompt.custom_llm.request_headers["X-Sift-Voice-Conversation"].variable_name = "browser_conversation";
    providerFetch.mockResolvedValue(Response.json(agent));
    await expect(createElevenVoiceToken()).rejects.toMatchObject({ code: "VOICE_CONFIGURATION" });
    expect(providerFetch).toHaveBeenCalledOnce();
  });
});

describe("ElevenLabs signed usage webhooks", () => {
  it("verifies the unmodified raw payload and returns only bounded usage metadata", () => {
    const { body, signature } = webhook();
    expect(verifyElevenWebhook(body, signature)).toEqual({
      providerConversationId: "conv_sift", agentId: "agent_sift", status: "done", durationSeconds: 52, costUsd: "0.0521000000", credits: 296,
    });
    expect(() => verifyElevenWebhook(`${body} `, signature)).toThrow("Invalid voice webhook signature");
    expect(() => verifyElevenWebhook(body, null)).toThrow("Invalid voice webhook signature");
    expect(() => verifyElevenWebhook(body, signature.replace("v0=", "v1="))).toThrow("Invalid voice webhook signature");
  });

  it("rejects expired, future, duplicate and nonnumeric timestamps even when signed", () => {
    for (const timestamp of [Math.floor(Date.now() / 1000) - 1801, Math.floor(Date.now() / 1000) + 301]) {
      const event = webhook(usage, timestamp);
      expect(() => verifyElevenWebhook(event.body, event.signature)).toThrow("Invalid voice webhook signature");
    }
    const event = webhook();
    for (const signature of [`${event.signature},t=123`, event.signature.replace(/t=\d+/, "t=NaN"), event.signature.replace(/t=\d+/, "t=Infinity")]) {
      expect(() => verifyElevenWebhook(event.body, signature)).toThrow("Invalid voice webhook signature");
    }
  });

  it("rejects signed malformed/negative costs and ignores unrelated signed events", () => {
    const malformed = webhook({ ...usage, metadata: { call_duration_secs: 10, cost_fiat: -1 } });
    expect(() => verifyElevenWebhook(malformed.body, malformed.signature)).toThrow();
    const timestamp = Math.floor(Date.now() / 1000);
    const body = JSON.stringify({ type: "voice_removed", data: { private: sensitive } });
    const signature = `t=${timestamp},v0=${createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex")}`;
    expect(verifyElevenWebhook(body, signature)).toBeNull();
  });
});

describe("provisioned Sift voice agent boundary", () => {
  it("pins callbacks to the app, disables client authority/speculation and keeps one tool loop", () => {
    const config = buildElevenAgentConfig({ origin: "https://sift.example", voiceId: "licensed_voice", secretId: "callback_secret", webhookId: "usage_webhook" });
    expect(config.platform_settings.auth).toEqual({ enable_auth: true, allowlist: [] });
    expect(config.conversation_config.tts.model_id).toBe("eleven_flash_v2");
    expect(config.conversation_config.agent.prompt).toMatchObject({ llm: "custom-llm", tools: [], tool_ids: [], mcp_server_ids: [], backup_llm_config: { preference: "disabled" } });
    expect(config.conversation_config.agent.prompt.custom_llm).toEqual({
      url: "https://sift.example/api/voice/llm/", model_id: "sift", api_type: "chat_completions", api_key: { secret_id: "callback_secret" },
      request_headers: { "X-Sift-Voice-Conversation": { variable_name: "system__conversation_id" }, "X-Sift-Voice-Turn": { variable_name: "system__agent_turns" } },
    });
    expect(config.conversation_config.turn.speculative_turn).toBe(false);
    expect(config.conversation_config.turn).toMatchObject({ turn_timeout: -1, initial_wait_time: -1, silence_end_call_timeout: 300 });
    expect(config.conversation_config.conversation.client_events).toContain("interruption");
    const overrides = config.platform_settings.overrides;
    expect(overrides.custom_llm_extra_body).toBe(false);
    const flattened = (value: unknown): unknown[] => typeof value === "object" && value ? Object.values(value).flatMap(flattened) : [value];
    expect(flattened(overrides).every((value) => value === false)).toBe(true);
    expect(config.platform_settings.workspace_overrides.webhooks).toMatchObject({ events: ["transcript"], exclude_transcript: true });
    expect(config.platform_settings.privacy.record_voice).toBe(false);
  });

  it("rejects unsafe callback origins and malformed provider IDs before provisioning", () => {
    for (const origin of ["http://sift.example", "https://user:pass@sift.example", "https://sift.example/elsewhere", "https://sift.example?key=private"]) {
      expect(() => buildElevenAgentConfig({ origin, voiceId: "voice", secretId: "secret", webhookId: "webhook" })).toThrow();
    }
    expect(() => buildElevenAgentConfig({ origin: "https://sift.example", voiceId: "../voice", secretId: "secret", webhookId: "webhook" })).toThrow();
  });
});
