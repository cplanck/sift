import { cookingStartSchema } from "@/domain/cooking";
import { database } from "@/db";
import { requestActor } from "@/lib/auth";
import { apiError, assertSameOrigin, json, readJson } from "@/lib/http";
import { startCookingSession } from "@/services/cooking";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const actor = await requestActor(request), input = cookingStartSchema.parse(await readJson(request));
    return json(await startCookingSession(database(), actor, input), 201);
  } catch (error) { return apiError(error); }
}
