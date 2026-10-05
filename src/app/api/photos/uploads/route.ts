import { database } from "@/db";
import { requestActor } from "@/lib/auth";
import { apiError, assertSameOrigin, json, readJson } from "@/lib/http";
import { preparePhotoUpload } from "@/services/photos";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const actor = await requestActor(request);
    return json(await preparePhotoUpload(database(), actor, await readJson(request)), 201);
  } catch (error) { return apiError(error); }
}
