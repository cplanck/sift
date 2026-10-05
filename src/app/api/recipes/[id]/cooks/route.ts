import { database } from "@/db";
import { requestActor } from "@/lib/auth";
import { apiError, json } from "@/lib/http";
import { listCookingHistory } from "@/services/cooking";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requestActor(request), { id } = await params;
    return json(await listCookingHistory(database(), actor, id));
  } catch (error) { return apiError(error); }
}
