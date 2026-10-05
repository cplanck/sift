import { database } from "@/db";
import { requestActor } from "@/lib/auth";
import { apiError, assertSameOrigin, json, readJson } from "@/lib/http";
import { deleteGatewayCredential, getGatewayCredentialStatus, saveGatewayCredential } from "@/services/credentials";

export async function GET(request: Request) {
  try { return json(await getGatewayCredentialStatus(database(), (await requestActor(request)).userId)); }
  catch (error) { return apiError(error); }
}
export async function PUT(request: Request) {
  try {
    assertSameOrigin(request);
    const actor = await requestActor(request);
    return json(await saveGatewayCredential(database(), actor.userId, await readJson(request)));
  } catch (error) { return apiError(error); }
}
export async function DELETE(request: Request) {
  try {
    assertSameOrigin(request);
    return json(await deleteGatewayCredential(database(), (await requestActor(request)).userId));
  } catch (error) { return apiError(error); }
}
