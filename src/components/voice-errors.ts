const errorNames = ["Error", "NotAllowedError", "PermissionDeniedError", "SecurityError", "NotFoundError", "DevicesNotFoundError", "OverconstrainedError", "ConstraintNotSatisfiedError", "NotReadableError", "TrackStartError", "AbortError", "ConnectionError", "SessionConnectionError", "DeviceUnsupportedError", "TrackInvalidError", "UnsupportedServer", "UnexpectedConnectionState", "NegotiationError", "PublishDataError", "PublishTrackError", "SignalRequestError", "SignalReconnectError"] as const;
const connectionReasons = ["NotAllowed", "ServerUnreachable", "InternalError", "Cancelled", "LeaveRequest", "Timeout", "WebSocket", "ServiceNotFound"] as const;
const providerErrorTypes = ["unknown", "invalid_message", "telephony_agent_error", "mcp_tool_error", "mcp_https_error", "value_error", "missing_fields", "override_error", "missing_dynamic_variable_transfer", "missing_dynamic_variable", "websocket_disconnect", "safety_violation", "llm_timeout", "transport_receive_timeout", "asyncio_timeout", "http_exception", "max_duration_exceeded", "llm_error", "custom_llm_error", "cascade_brain_error", "asr_transcription_error", "vad_error", "turn_probability_error", "tts_cascade_error", "redis_timeout_error", "unknown_websocket_crash"] as const;

const messages = {
  microphone_permission: "Audio access is blocked. Allow microphone access in your browser and system settings, then reconnect.",
  microphone_missing: "The microphone isn’t available. Choose an available input in Microphone settings, then reconnect.",
  microphone_busy: "Your microphone could not be opened. Check other apps using it, or choose another input in Microphone settings.",
  audio_unsupported: "This browser couldn’t set up audio. Try a current supported browser, or continue in text.",
  voice_auth: "The voice service rejected the connection. Reconnect to request a new session, or continue in text.",
  voice_network: "Voice couldn’t establish an audio connection. Check your network or VPN, then reconnect or continue in text.",
  voice_cancelled: "The voice connection was interrupted while starting. Reconnect when you’re ready, or continue in text.",
  voice_audio: "Voice couldn’t connect your microphone’s audio. Choose an available input and reconnect, or continue in text.",
  voice_reply: "Sift’s server couldn’t accept or finish the voice reply. Open the conversation to check the details and any saved changes, or continue in text.",
  voice_transcription: "The voice service couldn’t transcribe your speech. Reconnect or continue in text.",
  voice_speech: "The voice service couldn’t generate spoken audio. Open the conversation to read the reply, or continue in text.",
  voice_configuration: "The voice service couldn’t use Sift’s configuration. Continue in text while the connection settings are checked.",
  voice_time_limit: "This voice session reached its time limit. Reconnect to continue in the same conversation.",
  voice_rate_limit: "The voice service has reached a request limit. Open the conversation for details and try again later, or continue in text.",
  voice_failed: "Voice couldn’t continue. Open the conversation to check for details, then reconnect or continue in text.",
} as const;
export type VoiceErrorCategory = keyof typeof messages;
type Diagnostic = {
  category: VoiceErrorCategory;
  name?: typeof errorNames[number];
  errorType?: typeof providerErrorTypes[number];
  reason?: typeof connectionReasons[number];
  status?: number;
  code?: number;
};

function field(value: unknown, key: string): unknown {
  if (!value || typeof value !== "object") return undefined;
  try { return (value as Record<string, unknown>)[key]; }
  catch { return undefined; }
}
function allowed<T extends string>(value: unknown, values: readonly T[]): T | undefined {
  return typeof value === "string" && values.includes(value as T) ? value as T : undefined;
}

/** Accept only structured SDK fields; never expose messages, stack, causes,
 * debugMessage, provider details, device IDs, or connection credentials. */
export function classifyVoiceError(context: unknown): { message: string; diagnostic: Diagnostic } {
  const nested = field(context, "context");
  const name = allowed(field(context, "name"), errorNames);
  const errorType = allowed(field(context, "errorType") ?? field(nested, "type"), providerErrorTypes);
  const rawReason = field(context, "reason");
  const reason = name === "ConnectionError" ? allowed(field(context, "reasonName"), connectionReasons)
    ?? (typeof rawReason === "number" && Number.isInteger(rawReason) ? connectionReasons[rawReason] : undefined) : undefined;
  const rawStatus = field(context, "status"), rawCode = field(context, "closeCode") ?? field(context, "code") ?? field(nested, "code");
  const status = typeof rawStatus === "number" && [400, 401, 403, 404, 408, 409, 429, 500, 502, 503, 504].includes(rawStatus) ? rawStatus : undefined;
  const code = typeof rawCode === "number" && [1, 10, 12, 13, 14, 15, 16, 18, 20, 21, 1000, 1002, 1006, 1008, 1011].includes(rawCode) ? rawCode : undefined;
  let category: VoiceErrorCategory = "voice_failed";
  if (errorType === "max_duration_exceeded") category = "voice_time_limit";
  else if (status === 429) category = "voice_rate_limit";
  else if (errorType && ["custom_llm_error", "llm_error", "llm_timeout", "cascade_brain_error", "safety_violation"].includes(errorType)) category = "voice_reply";
  else if (errorType && ["asr_transcription_error", "vad_error", "turn_probability_error"].includes(errorType)) category = "voice_transcription";
  else if (errorType === "tts_cascade_error") category = "voice_speech";
  else if (errorType && ["override_error", "missing_dynamic_variable", "missing_dynamic_variable_transfer", "missing_fields", "invalid_message"].includes(errorType)) category = "voice_configuration";
  else if (name && ["NotAllowedError", "PermissionDeniedError", "SecurityError"].includes(name)) category = "microphone_permission";
  else if (name && ["NotFoundError", "DevicesNotFoundError", "OverconstrainedError", "ConstraintNotSatisfiedError"].includes(name)) category = "microphone_missing";
  else if (name && ["NotReadableError", "TrackStartError"].includes(name)) category = "microphone_busy";
  else if (name === "DeviceUnsupportedError") category = "audio_unsupported";
  else if (name && ["TrackInvalidError", "PublishTrackError"].includes(name)) category = "voice_audio";
  else if (reason === "NotAllowed" || status === 401 || status === 403 || (name === "SessionConnectionError" && code === 1008)) category = "voice_auth";
  else if (reason === "Cancelled" || name === "AbortError") category = "voice_cancelled";
  else if ((reason && ["ServerUnreachable", "Timeout", "WebSocket"].includes(reason))
    || (name && ["NegotiationError", "SignalReconnectError"].includes(name))
    || (errorType && ["websocket_disconnect", "transport_receive_timeout", "asyncio_timeout"].includes(errorType))
    || field(nested, "type") === "connection_state_changed" || (name === "SessionConnectionError" && code === 1006)) category = "voice_network";
  else if (name === "UnsupportedServer" || reason === "ServiceNotFound") category = "voice_configuration";
  else if (errorType) category = "voice_reply";
  return { message: messages[category], diagnostic: { category, ...(name ? { name } : {}), ...(errorType ? { errorType } : {}),
    ...(reason ? { reason } : {}), ...(status !== undefined ? { status } : {}), ...(code !== undefined ? { code } : {}) } };
}
