import { database } from "@/db";
import { requestActor } from "@/lib/auth";
import { apiError, json } from "@/lib/http";
import { getArtifact } from "@/services/artifacts";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try { return json(await getArtifact(database(), await requestActor(request), (await params).id)); }
  catch (error) { return apiError(error); }
}
