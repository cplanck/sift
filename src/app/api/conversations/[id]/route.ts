import { database } from "@/db";
import { requestActor } from "@/lib/auth";
import { apiError, assertSameOrigin, json, readJson } from "@/lib/http";
import { deleteConversation, getConversation, renameConversation } from "@/services/conversations";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try { return json(await getConversation(database(), await requestActor(request), (await params).id)); }
  catch (error) { return apiError(error); }
}
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const actor = await requestActor(request);
    return json(await renameConversation(database(), actor, (await params).id, await readJson(request)));
  } catch (error) { return apiError(error); }
}
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    return json(await deleteConversation(database(), await requestActor(request), (await params).id));
  } catch (error) { return apiError(error); }
}
