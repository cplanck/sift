import { timingSafeEqual } from "node:crypto";
import { DomainError } from "@/domain/errors";
import { requireConfig } from "@/lib/env";
import { apiError, json } from "@/lib/http";
import { ElevenLabsProviderError } from "./elevenlabs";

export function assertVoiceCallback(request: Request) {
  const expected = `Bearer ${requireConfig(["ELEVENLABS_LLM_SECRET"]).ELEVENLABS_LLM_SECRET}`;
  const provided = request.headers.get("authorization") ?? "";
  const expectedBytes = Buffer.from(expected), providedBytes = Buffer.from(provided);
  if (providedBytes.length !== expectedBytes.length || !timingSafeEqual(providedBytes, expectedBytes)) throw new DomainError("UNAUTHENTICATED", "Voice callback authentication failed.");
}
export function voiceApiError(error: unknown) {
  if (error instanceof ElevenLabsProviderError) return json({ error: error.message, code: error.code }, error.status);
  return apiError(error);
}
export async function readVoiceWebhook(request: Request) {
  const reader = request.body?.getReader();
  if (!reader) throw new DomainError("INVALID_INPUT", "Missing voice event.");
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > 1024 * 1024) { await reader.cancel(); throw new DomainError("INVALID_INPUT", "Voice event is too large."); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(chunks).toString("utf8");
}
