import { database } from "@/db";
import { DomainError } from "@/domain/errors";
import { requestActor } from "@/lib/auth";
import { apiError, assertSameOrigin, json } from "@/lib/http";
import { readPhotoObject } from "@/lib/r2";
import { deleteRecipePhoto, getPhoto } from "@/services/photos";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    return json(await deleteRecipePhoto(database(), await requestActor(request), (await params).id));
  } catch (error) { return apiError(error); }
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const photo = await getPhoto(database(), await requestActor(request), (await params).id);
    if (photo.status !== "ready") throw new DomainError("NOT_FOUND", "Photo not found.");
    // A photo is written once before it becomes ready, so its bytes never change under this id.
    const width = Number(new URL(request.url).searchParams.get("width"));
    const variant = photo.derivatives?.find((item) => item.width === width);
    const bytes = await readPhotoObject(variant?.objectKey ?? photo.objectKey);
    return new Response(new Uint8Array(bytes), { headers: { "Content-Type": "image/webp", "Content-Length": String(bytes.byteLength), "Cache-Control": "private, max-age=31536000, immutable", "X-Content-Type-Options": "nosniff", "Content-Disposition": "inline" } });
  } catch (error) { return apiError(error); }
}
