import { z } from "zod";
import { database } from "@/db";
import { requestActor } from "@/lib/auth";
import { apiError, assertSameOrigin, json, readJson } from "@/lib/http";
import { createRecipeShare, listRecipeShares } from "@/services/shares";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try { return json(await listRecipeShares(database(), await requestActor(request), (await params).id)); }
  catch (error) { return apiError(error); }
}
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const actor = await requestActor(request);
    const data = z.object({ expectedVersionId: z.uuid(), expectedCoverPhotoId: z.uuid().nullable() }).parse(await readJson(request));
    return json(await createRecipeShare(database(), actor, (await params).id, data.expectedVersionId, data.expectedCoverPhotoId), 201);
  } catch (error) { return apiError(error); }
}
