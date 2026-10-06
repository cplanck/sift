import { database } from "@/db";
import { requestActor } from "@/lib/auth";
import { apiError, assertSameOrigin, json, readJson } from "@/lib/http";
import { deleteArtifact, renameArtifact, getArtifact } from "@/services/artifacts";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try { return json(await getArtifact(database(), await requestActor(request), (await params).id)); }
  catch (error) { return apiError(error); }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try { assertSameOrigin(request); return json(await renameArtifact(database(), await requestActor(request), (await params).id, await readJson(request))); }
  catch (error) { return apiError(error); }
}
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try { assertSameOrigin(request); return json(await deleteArtifact(database(), await requestActor(request), (await params).id, await readJson(request))); }
  catch (error) { return apiError(error); }
}
