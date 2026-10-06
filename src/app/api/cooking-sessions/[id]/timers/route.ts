import { database } from "@/db";
import { requestActor } from "@/lib/auth";
import { apiError, assertSameOrigin, json, readJson } from "@/lib/http";
import { createCookingTimer, listCookingTimers } from "@/services/cooking-timers";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requestActor(request), { id } = await params;
    return json(await listCookingTimers(database(), actor, id));
  } catch (error) { return apiError(error); }
}
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const actor = await requestActor(request), { id } = await params;
    return json(await createCookingTimer(database(), actor, id, await readJson(request)));
  } catch (error) { return apiError(error); }
}
