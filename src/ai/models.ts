import "server-only";
import { createGateway } from "@ai-sdk/gateway";
import { env, requireConfig } from "@/lib/env";

export const models = { assistant: "anthropic/claude-sonnet-4.5", extraction: "anthropic/claude-sonnet-4.5" } as const;
export function gatewayModel(purpose: keyof typeof models, userKey?: string) {
  const apiKey = userKey ?? requireConfig(["AI_GATEWAY_API_KEY"]).AI_GATEWAY_API_KEY;
  return createGateway({ apiKey })(env().AI_MODEL ?? models[purpose]);
}
