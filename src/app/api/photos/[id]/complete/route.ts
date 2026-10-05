import { database } from "@/db";
import { requestActor } from "@/lib/auth";
import { apiError, assertSameOrigin, json } from "@/lib/http";
import { finishPhotoUpload } from "@/services/photos";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    return json(await finishPhotoUpload(database(), await requestActor(request), (await params).id));
  } catch (error) { return apiError(error); }
}
