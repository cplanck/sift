import { database } from "@/db";
import { requestActor } from "@/lib/auth";
import { apiError, json } from "@/lib/http";
import { getRecipeStockPhoto } from "@/services/recipe-stock-photos";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const db = database(), actor = await requestActor(request);
    return json({ photo: await getRecipeStockPhoto(db, actor, (await params).id) });
  } catch (error) { return apiError(error); }
}
