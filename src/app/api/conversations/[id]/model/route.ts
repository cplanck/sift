import { database } from "@/db";
import { requestActor } from "@/lib/auth";
import { apiError, assertSameOrigin, json, readJson } from "@/lib/http";
import { setConversationModel } from "@/services/conversations";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const actor = await requestActor(request);
    return json(await setConversationModel(database(), actor, (await params).id, await readJson(request)));
  } catch (error) { return apiError(error); }
}
