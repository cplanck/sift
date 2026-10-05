import "server-only";
import { APICallError, RetryError } from "ai";
import { GatewayError } from "@ai-sdk/gateway";

/** Inspect only recognized SDK failures. Never forward provider text: it may
 * contain credentials, prompts, URLs or other private request data. */
export function providerErrorMessage(error: unknown): string | null {
  const failure = RetryError.isInstance(error) ? error.lastError : error;
  if (!GatewayError.isInstance(failure) && !APICallError.isInstance(failure)) return null;
  switch (failure.statusCode) {
    case 401: return "The AI service rejected the configured Gateway key. Update the key, then try again.";
    case 402: return "The AI service needs billing setup or available credits. Check the Gateway account, then try again.";
    case 403: {
      // The Gateway currently wraps this provider restriction in a 403. Match
      // its specific wording, including nested SDK causes, without reflecting it.
      let current: unknown = failure;
      for (let depth = 0; depth < 5 && current && typeof current === "object"; depth++) {
        const item = current as { message?: unknown; responseBody?: unknown; cause?: unknown };
        const detail = [item.message, item.responseBody].filter((value): value is string => typeof value === "string").join(" ");
        if (/free tier users do not have access to this model/i.test(detail) && /paid credits/i.test(detail)) {
          return "This model requires paid AI Gateway credits. Purchase credits in your Gateway account, then try again. Adding a payment method alone does not unlock this model.";
        }
        current = item.cause;
      }
      return "The AI service denied this request. Check the Gateway account’s billing, credits, and model access.";
    }
    case 404: return "The configured AI model is unavailable. Check the Gateway model setting, then try again.";
    case 429: return "The AI service is busy or has reached a usage limit. Wait a moment, then try again.";
    default: return null;
  }
}
