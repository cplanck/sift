import { database } from "@/db";
import { DomainError } from "@/domain/errors";
import { requestActor } from "@/lib/auth";
import { apiError } from "@/lib/http";
import { readPhotoObject } from "@/lib/r2";
import { getPhoto } from "@/services/photos";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const photo = await getPhoto(database(), await requestActor(request), (await params).id);
    if (photo.status !== "ready") throw new DomainError("NOT_FOUND", "Photo not found.");
    const bytes = await readPhotoObject(photo.objectKey);
    return new Response(new Uint8Array(bytes), { headers: { "Content-Type": "image/webp", "Content-Length": String(bytes.byteLength), "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Content-Disposition": "inline" } });
  } catch (error) { return apiError(error); }
}
