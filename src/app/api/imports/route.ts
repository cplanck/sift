import { database } from "@/db";
import { requestActor } from "@/lib/auth";
import { apiError, assertSameOrigin, json, readJson } from "@/lib/http";
import { createImport, listPendingImports } from "@/services/imports";

export async function GET(request: Request) {
  try { return json(await listPendingImports(database(), await requestActor(request))); }
  catch (error) { return apiError(error); }
}
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const actor = await requestActor(request);
    const record = await createImport(database(), actor, await readJson(request));
    return json({ id: record.id, status: record.status }, 201);
  } catch (error) { return apiError(error); }
}
