import { z } from "zod";

export const elevenVoiceConfiguration = {
  apiOrigin: "https://api.elevenlabs.io",
  // English Agents currently require Flash/Turbo v2 (provider validates this).
  ttsModel: "eleven_flash_v2",
  maxDurationSeconds: 1800,
  cascadeTimeoutSeconds: 15,
  // ElevenLabs appends chat/completions to this OpenAI-compatible base URL.
  llmBasePath: "/api/voice/llm/",
  callbackPath: "/api/voice/llm/chat/completions",
  webhookPath: "/api/voice/webhook",
} as const;

const identifier = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);

export function buildElevenAgentConfig(input: { origin: string; voiceId: string; secretId: string; webhookId: string }) {
  const { voiceId, secretId, webhookId } = z.object({ voiceId: identifier, secretId: identifier, webhookId: identifier }).parse(input);
  const origin = new URL(input.origin);
  if (origin.protocol !== "https:" || origin.username || origin.password || origin.pathname !== "/" || origin.search || origin.hash) {
    throw new Error("Voice callbacks require a public HTTPS origin without a path.");
  }
  return {
    name: `Sift voice · ${origin.hostname}`,
    tags: ["sift", "app-owned-runtime"],
    conversation_config: {
      agent: {
        first_message: "", language: "en", disable_first_message_interruptions: false,
        prompt: {
          prompt: "Sift owns this conversation. Forward user speech to the configured Sift endpoint.",
          llm: "custom-llm", max_tokens: 3000, ignore_default_personality: true,
          tools: [], tool_ids: [], built_in_tools: {}, mcp_server_ids: [], native_mcp_server_ids: [], knowledge_base: [],
          // The shared Sift tool runtime can take longer than the provider's
          // four-second default before it has model text to speak.
          cascade_timeout_seconds: elevenVoiceConfiguration.cascadeTimeoutSeconds,
          backup_llm_config: { preference: "disabled" }, enable_reasoning_summary: false,
          custom_llm: {
            url: `${origin.origin}${elevenVoiceConfiguration.llmBasePath}`,
            model_id: "sift", api_type: "chat_completions", api_key: { secret_id: secretId },
            request_headers: {
              "X-Sift-Voice-Conversation": { variable_name: "system__conversation_id" },
              "X-Sift-Voice-Turn": { variable_name: "system__agent_turns" },
            },
          },
        },
      },
      tts: { voice_id: voiceId, model_id: elevenVoiceConfiguration.ttsModel },
      turn: {
        // -1 is accepted by the live Agents API and disables idle re-engagement.
        speculative_turn: false, turn_eagerness: "normal", turn_timeout: -1,
        initial_wait_time: -1, silence_end_call_timeout: 300,
        soft_timeout_config: { timeout_seconds: -1, use_llm_generated_message: false },
      },
      conversation: {
        max_duration_seconds: elevenVoiceConfiguration.maxDurationSeconds,
        client_events: ["audio", "interruption", "user_transcript", "agent_response", "agent_response_correction", "agent_response_complete", "agent_chat_response_part", "vad_score"],
      },
    },
    platform_settings: {
      auth: { enable_auth: true, allowlist: [] },
      privacy: { record_voice: false, delete_audio: true, retention_days: 7 },
      call_limits: { agent_concurrency_limit: 5, daily_limit: 100, bursting_enabled: false },
      overrides: {
        custom_llm_extra_body: false, enable_conversation_initiation_client_data_from_webhook: false,
        enable_starting_workflow_node_id_from_client: false, enable_procedure_ids_from_client: false,
        conversation_config_override: {
          agent: { first_message: false, language: false, max_conversation_duration_message: false,
            prompt: { prompt: false, llm: false, tool_ids: false, native_mcp_server_ids: false, knowledge_base: false } },
          asr: { keywords: false },
          conversation: { text_only: false, max_duration_seconds: false },
          tts: { model_id: false, voice_id: false, supported_voices: false, stability: false, speed: false, similarity_boost: false, pronunciation_dictionary_locators: false },
          turn: { soft_timeout_config: { message: false, additional_soft_timeout_messages: false } },
        },
      },
      workspace_overrides: { webhooks: { post_call_webhook_id: webhookId, events: ["transcript"], transcript_format: "json", exclude_transcript: true } },
    },
  };
}
