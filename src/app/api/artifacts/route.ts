import { database } from "@/db";
import { requestActor } from "@/lib/auth";
import { apiError, assertSameOrigin, json, readJson } from "@/lib/http";
import { createArtifact, listArtifacts } from "@/services/artifacts";

export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    return json(await listArtifacts(database(), await requestActor(request), { ...(params.has("includeArchived") ? { includeArchived: params.get("includeArchived") === "true" } : {}), ...(params.has("kind") ? { kind: params.get("kind") } : {}), ...(params.has("q") ? { query: params.get("q") } : {}) }));
  } catch (error) { return apiError(error); }
}
export async function POST(request: Request) {
  try { assertSameOrigin(request); return json(await createArtifact(database(), await requestActor(request), await readJson(request)), 201); }
  catch (error) { return apiError(error); }
}
