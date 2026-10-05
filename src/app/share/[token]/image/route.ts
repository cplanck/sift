import { database } from "@/db";
import { apiError } from "@/lib/http";
import { readPhotoObject } from "@/lib/r2";
import { readSharedPhoto } from "@/services/shares";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  try {
    const photo = await readSharedPhoto(database(), (await params).token);
    const bytes = await readPhotoObject(photo.objectKey);
    return new Response(new Uint8Array(bytes), { headers: { "Content-Type": "image/webp", "Content-Length": String(bytes.byteLength), "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "X-Robots-Tag": "noindex, nofollow, noarchive", "Referrer-Policy": "no-referrer" } });
  } catch (error) { return apiError(error); }
}
