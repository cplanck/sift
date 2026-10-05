import "server-only";
import { createGateway } from "@ai-sdk/gateway";
import { env, requireConfig } from "@/lib/env";

export const models = { assistant: "anthropic/claude-sonnet-4.5", extraction: "anthropic/claude-sonnet-4.5" } as const;
export const assistantModelOptions = [
  { id: "anthropic/claude-haiku-4.5", label: "Claude Haiku 4.5", description: "Quick questions and lighter recipe edits." },
  { id: "anthropic/claude-sonnet-4.5", label: "Claude Sonnet 4.5", description: "Everyday cookbook conversations and edits." },
  { id: "anthropic/claude-sonnet-5.5", label: "Claude Sonnet 5.5", description: "Advanced recipe reasoning and edits." },
  { id: "anthropic/claude-opus-5.5", label: "Claude Opus 5.5", description: "Complex planning and recipe transformations." },
] as const;

export function getAssistantModels() {
  return { defaultId: env().AI_MODEL ?? models.assistant, options: assistantModelOptions };
}

// Prepare credentials/configuration before saving a user message, then choose
// the model returned by the conversation's locked turn reservation. A model
// change racing that reservation cannot silently affect a running response.
export function prepareAssistantModel(userKey?: string) {
  const defaultId = getAssistantModels().defaultId;
  const apiKey = userKey ?? requireConfig(["AI_GATEWAY_API_KEY"]).AI_GATEWAY_API_KEY;
  const gateway = createGateway({ apiKey });
  return (modelId: string | null) => gateway(modelId ?? defaultId);
}

export function gatewayModel(purpose: keyof typeof models, userKey?: string) {
  const apiKey = userKey ?? requireConfig(["AI_GATEWAY_API_KEY"]).AI_GATEWAY_API_KEY;
  return createGateway({ apiKey })(env().AI_MODEL ?? models[purpose]);
}
