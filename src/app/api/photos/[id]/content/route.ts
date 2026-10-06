import { database } from "@/db";
import { DomainError } from "@/domain/errors";
import { requestActor } from "@/lib/auth";
import { apiError, assertSameOrigin, json } from "@/lib/http";
import { MAX_PHOTO_BYTES } from "@/lib/r2";
import { receivePhotoUpload } from "@/services/photos";

export const runtime = "nodejs";
export const maxDuration = 120;

/** Same-origin photo upload: the browser never talks to R2 directly. */
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const actor = await requestActor(request);
    const declared = Number(request.headers.get("content-length") ?? 0);
    if (declared > MAX_PHOTO_BYTES) throw new DomainError("INVALID_INPUT", "Choose a smaller photo.");
    const reader = request.body?.getReader();
    if (!reader) throw new DomainError("INVALID_INPUT", "The photo didn’t arrive. Please try again.");
    const chunks: Uint8Array[] = []; let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read(); if (done) break;
        size += value.byteLength;
        if (size > MAX_PHOTO_BYTES) { await reader.cancel(); throw new DomainError("INVALID_INPUT", "Choose a smaller photo."); }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    return json(await receivePhotoUpload(database(), actor, (await params).id, Buffer.concat(chunks)));
  } catch (error) { return apiError(error); }
}
