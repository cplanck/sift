import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { DomainError } from "@/domain/errors";
import { requireConfig } from "@/lib/env";
import { elevenVoiceConfiguration } from "./config";

const providerId = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
const usageSchema = z.object({
  conversation_id: providerId,
  agent_id: providerId,
  status: z.enum(["initiated", "in-progress", "processing", "done", "failed"]),
  metadata: z.object({
    call_duration_secs: z.number().int().nonnegative().max(86_400),
    cost: z.number().int().nonnegative().max(1_000_000_000_000).nullish(),
    cost_fiat: z.number().finite().nonnegative().max(9_999_999_999).nullish(),
  }),
});

export interface ElevenConversationUsage {
  providerConversationId: string;
  agentId: string;
  status: z.infer<typeof usageSchema>["status"];
  durationSeconds: number;
  costUsd: string | null;
  credits: number | null;
}

export class ElevenLabsProviderError extends Error {
  constructor(
    public readonly code: "VOICE_AUTH" | "VOICE_CREDITS" | "VOICE_RATE_LIMITED" | "VOICE_UNAVAILABLE" | "VOICE_CONFIGURATION",
    public readonly status: number,
    message: string,
  ) { super(message); this.name = "ElevenLabsProviderError"; }
}

function unavailable() {
  return new ElevenLabsProviderError("VOICE_UNAVAILABLE", 503, "Voice is temporarily unavailable. Try again or continue with text.");
}

function providerFailure(status: number, data: unknown): ElevenLabsProviderError {
  // Inspect only known machine-readable codes. Provider prose can contain secrets.
  const parsed = z.object({ detail: z.object({ status: z.string().max(100).optional() }).optional() }).safeParse(data);
  const code = parsed.success ? parsed.data.detail?.status : undefined;
  if (status === 402 || ["quota_exceeded", "insufficient_credits", "insufficient_balance", "payment_required"].includes(code ?? "")) {
    return new ElevenLabsProviderError("VOICE_CREDITS", 402, "The voice service has run out of credits. Check the ElevenLabs account’s billing and this API key’s credit limit. Text chat is still available.");
  }
  if (status === 401 || status === 403) {
    return new ElevenLabsProviderError("VOICE_AUTH", 503, "The voice service denied access. Check the ElevenLabs API key, Agents permissions, and account credits. Text chat is still available.");
  }
  if (status === 429) return new ElevenLabsProviderError("VOICE_RATE_LIMITED", 429, "The voice service is busy or has reached its usage limit. Try again shortly or continue with text.");
  if ([400, 404, 422].includes(status)) return new ElevenLabsProviderError("VOICE_CONFIGURATION", 503, "The voice service configuration needs attention. Check the private ElevenLabs agent and its Sift callback settings.");
  return unavailable();
}

async function providerGet(path: string): Promise<unknown> {
  const { ELEVENLABS_API_KEY } = requireConfig(["ELEVENLABS_API_KEY"]);
  let response: Response;
  try {
    response = await fetch(`${elevenVoiceConfiguration.apiOrigin}${path}`, {
      headers: { "xi-api-key": ELEVENLABS_API_KEY, Accept: "application/json" },
      cache: "no-store", redirect: "error", signal: AbortSignal.timeout(15_000),
    });
  } catch { throw unavailable(); }
  let body: unknown;
  try {
    const reader = response.body?.getReader();
    if (!reader) throw unavailable();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.byteLength;
        // Conversation detail can include transcripts; never retain or expose them.
        if (size > 2 * 1024 * 1024) { await reader.cancel(); throw unavailable(); }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    if (!response.ok) throw providerFailure(response.status, undefined);
    throw unavailable();
  }
  if (!response.ok) throw providerFailure(response.status, body);
  return body;
}

export async function createElevenVoiceToken() {
  const { ELEVENLABS_AGENT_ID, ELEVENLABS_CALLBACK_ORIGIN, BETTER_AUTH_URL } = requireConfig(["ELEVENLABS_AGENT_ID", "ELEVENLABS_LLM_SECRET"]);
  const origin = new URL(ELEVENLABS_CALLBACK_ORIGIN ?? BETTER_AUTH_URL).origin;
  if (!origin.startsWith("https://")) throw new ElevenLabsProviderError("VOICE_CONFIGURATION", 503, "Voice needs a public HTTPS Sift deployment so ElevenLabs can reach its callback. Continue with text here or use the deployed app.");
  const definition = await providerGet(`/v1/convai/agents/${encodeURIComponent(ELEVENLABS_AGENT_ID)}`);
  if (!isSafeElevenAgent(definition, origin, ELEVENLABS_AGENT_ID)) {
    throw new ElevenLabsProviderError("VOICE_CONFIGURATION", 503, "The private voice agent must point to this Sift deployment with client overrides and speculative turns disabled. Check the ElevenLabs setup before starting voice.");
  }
  const body = await providerGet(`/v1/convai/conversation/token?agent_id=${encodeURIComponent(ELEVENLABS_AGENT_ID)}`);
  const parsed = z.object({ token: z.string().min(1).max(32_768), conversation_id: providerId }).safeParse(body);
  if (!parsed.success) throw unavailable();
  return { conversationToken: parsed.data.token, providerConversationId: parsed.data.conversation_id, agentId: ELEVENLABS_AGENT_ID };
}

function parseUsage(data: unknown): ElevenConversationUsage {
  const parsed = usageSchema.safeParse(data);
  if (!parsed.success) throw unavailable();
  const { conversation_id, agent_id, status, metadata } = parsed.data;
  return {
    providerConversationId: conversation_id, agentId: agent_id, status,
    durationSeconds: metadata.call_duration_secs,
    // Only cost_fiat is documented as USD. Never infer dollars from credits or duration.
    costUsd: metadata.cost_fiat == null ? null : metadata.cost_fiat.toFixed(10),
    credits: metadata.cost ?? null,
  };
}

/** Validate provider-side controls again when minting each private token. */
function isSafeElevenAgent(value: unknown, origin: string, agentId: string) {
  const emptyIds = z.array(z.unknown()).max(0).nullish();
  const record = (input: unknown): input is Record<string, unknown> => !!input && typeof input === "object" && !Array.isArray(input);
  const onlyDisabled = (input: unknown): boolean => input === false || input === null || (record(input) && Object.values(input).every(onlyDisabled));
  const config = z.object({
    agent_id: z.literal(agentId),
    conversation_config: z.object({
      agent: z.object({ first_message: z.literal(""), prompt: z.object({
        llm: z.literal("custom-llm"),
        tools: emptyIds, tool_ids: emptyIds, mcp_server_ids: emptyIds, native_mcp_server_ids: emptyIds, knowledge_base: emptyIds,
        built_in_tools: z.record(z.string(), z.unknown()).refine((tools) => Object.values(tools).every((tool) => tool === null)).nullish(),
        backup_llm_config: z.object({ preference: z.literal("disabled") }),
        cascade_timeout_seconds: z.literal(elevenVoiceConfiguration.cascadeTimeoutSeconds),
        custom_llm: z.object({
          url: z.literal(`${origin}${elevenVoiceConfiguration.llmBasePath}`), api_type: z.literal("chat_completions"),
          api_key: z.object({ secret_id: providerId }),
          request_headers: z.object({
            "X-Sift-Voice-Conversation": z.object({ variable_name: z.literal("system__conversation_id") }),
            "X-Sift-Voice-Turn": z.object({ variable_name: z.literal("system__agent_turns") }),
          }),
        }),
      }) }),
      turn: z.object({ speculative_turn: z.literal(false), turn_timeout: z.literal(-1), initial_wait_time: z.literal(-1), silence_end_call_timeout: z.literal(300),
        soft_timeout_config: z.object({ use_llm_generated_message: z.literal(false) }) }),
      conversation: z.object({ max_duration_seconds: z.number().int().positive().max(elevenVoiceConfiguration.maxDurationSeconds), client_events: z.array(z.string()).refine((events) => events.includes("interruption")) }),
    }),
    platform_settings: z.object({
      auth: z.object({ enable_auth: z.literal(true), allowlist: emptyIds, shareable_token: z.union([z.literal(""), z.null()]).optional() }),
      overrides: z.object({ custom_llm_extra_body: z.literal(false), conversation_config_override: z.unknown().refine(onlyDisabled) }).passthrough().refine(onlyDisabled),
    }),
    procedures: z.record(z.string(), z.unknown()).refine((procedures) => Object.keys(procedures).length === 0).nullish(),
    workflow: z.unknown().optional(),
  }).safeParse(value);
  if (!config.success) return false;
  const workflow = config.data.workflow;
  // A provider workflow must not introduce a parallel agent/tool loop.
  if (workflow == null) return true;
  if (!record(workflow) || Object.keys(workflow).some((key) => !["nodes", "edges", "subgraphs", "prevent_subagent_loops"].includes(key))) return false;
  if (!["edges", "subgraphs"].every((key) => workflow[key] == null || (record(workflow[key]) && Object.keys(workflow[key]).length === 0))) return false;
  if (workflow.nodes == null) return true;
  if (!record(workflow.nodes)) return false;
  const nodes = Object.values(workflow.nodes);
  // The API inserts one inert start node even for an agent with no workflow.
  const startNode = z.object({ type: z.literal("start"), position: z.unknown().optional(),
    edge_order: z.array(z.string()).max(0).nullish(), parent_subgraph_id: z.null().optional() }).strict();
  return nodes.length === 0 || (nodes.length === 1 && startNode.safeParse(nodes[0]).success);
}

export async function getElevenConversationUsage(providerConversationId: string): Promise<ElevenConversationUsage> {
  if (!providerId.safeParse(providerConversationId).success) throw new DomainError("INVALID_INPUT", "Invalid voice conversation.");
  const usage = parseUsage(await providerGet(`/v1/convai/conversations/${encodeURIComponent(providerConversationId)}`));
  if (usage.providerConversationId !== providerConversationId) throw unavailable();
  return usage;
}

/** Implements ElevenLabs' documented HMAC-SHA256 over `${timestamp}.${rawBody}`. */
export function verifyElevenWebhook(rawBody: string, signature: string | null): ElevenConversationUsage | null {
  const { ELEVENLABS_WEBHOOK_SECRET } = requireConfig(["ELEVENLABS_WEBHOOK_SECRET"]);
  const invalid = () => new DomainError("UNAUTHENTICATED", "Invalid voice webhook signature.");
  if (!signature || signature.length > 1024 || Buffer.byteLength(rawBody) > 2 * 1024 * 1024) throw invalid();
  const fields = signature.split(",").map((field) => field.trim());
  const timestamps = fields.filter((field) => field.startsWith("t="));
  if (timestamps.length !== 1 || !/^t=\d{1,13}$/.test(timestamps[0])) throw invalid();
  const timestamp = timestamps[0].slice(2);
  const age = Date.now() / 1000 - Number(timestamp);
  // Match the SDK's 30-minute past tolerance; also reject future-dated signatures.
  if (age > 1800 || age < -300) throw invalid();
  const expected = createHmac("sha256", ELEVENLABS_WEBHOOK_SECRET).update(`${timestamp}.${rawBody}`).digest();
  const valid = fields.some((field) => /^v0=[a-f0-9]{64}$/.test(field)
    && timingSafeEqual(Buffer.from(field.slice(3), "hex"), expected));
  if (!valid) throw invalid();
  let data: unknown;
  try { data = JSON.parse(rawBody); }
  catch { throw new DomainError("INVALID_INPUT", "Invalid voice webhook payload."); }
  const event = z.object({ type: z.string().max(100), data: z.unknown() }).safeParse(data);
  if (!event.success) throw new DomainError("INVALID_INPUT", "Invalid voice webhook payload.");
  if (event.data.type !== "post_call_transcription") return null;
  return parseUsage(event.data.data);
}
