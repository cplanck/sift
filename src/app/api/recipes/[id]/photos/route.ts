import { z } from "zod";
import { database } from "@/db";
import { requestActor } from "@/lib/auth";
import { apiError, assertSameOrigin, json, readJson } from "@/lib/http";
import { listRecipePhotos, setCoverPhoto } from "@/services/photos";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try { return json(await listRecipePhotos(database(), await requestActor(request), (await params).id)); }
  catch (error) { return apiError(error); }
}
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const actor = await requestActor(request), data = z.object({ photoId: z.uuid() }).parse(await readJson(request));
    return json(await setCoverPhoto(database(), actor, (await params).id, data.photoId));
  } catch (error) { return apiError(error); }
}
