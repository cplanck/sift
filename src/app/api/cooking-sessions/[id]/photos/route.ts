import { database } from "@/db";
import { requestActor } from "@/lib/auth";
import { apiError, json } from "@/lib/http";
import { listCookingPhotos } from "@/services/cooking";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requestActor(request), { id } = await params;
    return json(await listCookingPhotos(database(), actor, id));
  } catch (error) { return apiError(error); }
}
