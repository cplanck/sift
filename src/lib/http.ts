import { ZodError } from "zod";
import { DomainError } from "@/domain/errors";
import { ConfigurationError, env } from "./env";

export function json(data: unknown, status = 200) { return Response.json(data, { status, headers: { "Cache-Control": "private, no-store" } }); }

export function assertSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin || origin !== new URL(env().BETTER_AUTH_URL).origin) throw new DomainError("INVALID_INPUT", "This request did not originate from Sift.");
}

export function apiError(error: unknown) {
  if (error instanceof ZodError) return json({ error: "Please check the supplied values.", code: "INVALID_INPUT" }, 400);
  if (error instanceof ConfigurationError) return json({ error: error.message, code: "CONFIGURATION_REQUIRED" }, 503);
  if (error instanceof DomainError) {
    const status = { UNAUTHENTICATED: 401, NOT_FOUND: 404, INVALID_INPUT: 400, CONFLICT: 409, RATE_LIMITED: 429 }[error.code];
    return json({ error: error.message, code: error.code }, status);
  }
  console.error(JSON.stringify({ event: "request.failed", requestId: crypto.randomUUID() }));
  return json({ error: "Sift couldn’t complete that request. Please try again.", code: "INTERNAL_ERROR" }, 500);
}
