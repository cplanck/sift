import { database } from "@/db";
import { requestActor } from "@/lib/auth";
import { apiError, assertSameOrigin, json, readJson } from "@/lib/http";
import { getCookingSession, updateCookingProgress } from "@/services/cooking";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requestActor(request), { id } = await params;
    return json(await getCookingSession(database(), actor, id));
  } catch (error) { return apiError(error); }
}
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const actor = await requestActor(request), { id } = await params;
    return json(await updateCookingProgress(database(), actor, id, await readJson(request)));
  } catch (error) { return apiError(error); }
}
