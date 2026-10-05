import { database } from "@/db";
import { requestActor } from "@/lib/auth";
import { apiError, assertSameOrigin, json, readJson } from "@/lib/http";
import { deriveGroceryList } from "@/services/artifacts";

export async function POST(request: Request) {
  try { assertSameOrigin(request); return json(await deriveGroceryList(database(), await requestActor(request), await readJson(request)), 201); }
  catch (error) { return apiError(error); }
}
