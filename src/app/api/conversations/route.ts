import { database } from "@/db";
import { requestActor } from "@/lib/auth";
import { apiError, assertSameOrigin, json, readJson } from "@/lib/http";
import { createConversation, listConversations } from "@/services/conversations";

export async function GET(request: Request) {
  try { return json(await listConversations(database(), await requestActor(request))); }
  catch (error) { return apiError(error); }
}
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const actor = await requestActor(request);
    return json(await createConversation(database(), actor, await readJson(request)), 201);
  } catch (error) { return apiError(error); }
}
