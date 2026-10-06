import { database } from "@/db";
import { requestActor } from "@/lib/auth";
import { apiError, assertSameOrigin, json, readJson } from "@/lib/http";
import { updateCookingTimer } from "@/services/cooking-timers";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string; timerId: string }> }) {
  try {
    assertSameOrigin(request);
    const actor = await requestActor(request), { id, timerId } = await params;
    return json(await updateCookingTimer(database(), actor, id, timerId, await readJson(request)));
  } catch (error) { return apiError(error); }
}
