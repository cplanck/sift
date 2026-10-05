import { database } from "@/db";
import { requestActor } from "@/lib/auth";
import { apiError, assertSameOrigin, json } from "@/lib/http";
import { getRecipe, listRecipeNotes, listVersions, updateRecipe } from "@/services/recipes";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requestActor(request), { id } = await params;
    const [recipe, notes, versions] = await Promise.all([getRecipe(database(), actor, id), listRecipeNotes(database(), actor, id), listVersions(database(), actor, id)]);
    return json({ recipe, notes, versions });
  } catch (error) { return apiError(error); }
}
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try { assertSameOrigin(request); return json(await updateRecipe(database(), await requestActor(request), (await params).id, await request.json())); }
  catch (error) { return apiError(error); }
}
