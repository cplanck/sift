import { cookingStartSchema } from "@/domain/cooking";
import { database } from "@/db";
import { requestActor } from "@/lib/auth";
import { apiError, assertSameOrigin, json, readJson } from "@/lib/http";
import { listActiveCookingSessions, startCookingSession } from "@/services/cooking";

/** The signed-in user's in-progress cooks, for the resume-cooking banner. */
export async function GET(request: Request) {
  try { return json({ cooks: await listActiveCookingSessions(database(), await requestActor(request)) }); }
  catch (error) { return apiError(error); }
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const actor = await requestActor(request), input = cookingStartSchema.parse(await readJson(request));
    return json(await startCookingSession(database(), actor, input), 201);
  } catch (error) { return apiError(error); }
}
