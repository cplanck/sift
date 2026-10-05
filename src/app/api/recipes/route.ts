import { database } from "@/db";
import { requestActor } from "@/lib/auth";
import { apiError, assertSameOrigin, json } from "@/lib/http";
import { createRecipe, listRecipes } from "@/services/recipes";

export async function GET(request: Request) {
  try { return json(await listRecipes(database(), await requestActor(request), new URL(request.url).searchParams.get("q") ?? "")); }
  catch (error) { return apiError(error); }
}
export async function POST(request: Request) {
  try { assertSameOrigin(request); return json(await createRecipe(database(), await requestActor(request), await request.json()), 201); }
  catch (error) { return apiError(error); }
}
