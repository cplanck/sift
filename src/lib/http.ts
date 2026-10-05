import { ZodError } from "zod";
import { DomainError } from "@/domain/errors";
import { ConfigurationError, env } from "./env";

export function json(data: unknown, status = 200) { return Response.json(data, { status, headers: { "Cache-Control": "private, no-store" } }); }

export async function readJson(request: Request, maxBytes = 256 * 1024): Promise<unknown> {
  if (!request.headers.get("content-type")?.includes("application/json")) throw new DomainError("INVALID_INPUT", "Send a JSON request.");
  const reader = request.body?.getReader();
  if (!reader) throw new DomainError("INVALID_INPUT", "Request body is missing.");
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) { await reader.cancel(); throw new DomainError("INVALID_INPUT", "This request is too large."); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw new DomainError("INVALID_INPUT", "The request is not valid JSON."); }
}

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
