import { database } from "@/db";
import { requestActor } from "@/lib/auth";
import { apiError, assertSameOrigin, json, readJson } from "@/lib/http";
import { approveImport, importReview } from "@/services/imports";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try { return json(await importReview(database(), await requestActor(request), (await params).id)); }
  catch (error) { return apiError(error); }
}
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const actor = await requestActor(request);
    return json(await approveImport(database(), actor, (await params).id, await readJson(request)));
  } catch (error) { return apiError(error); }
}
