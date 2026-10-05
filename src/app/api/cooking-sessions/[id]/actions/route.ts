import { z } from "zod";
import { cookingFinishSchema, cookingNoteSchema } from "@/domain/cooking";
import { database } from "@/db";
import { requestActor } from "@/lib/auth";
import { apiError, assertSameOrigin, json, readJson } from "@/lib/http";
import { addCookingSessionNote, finishCookingSession } from "@/services/cooking";

const actionSchema = z.discriminatedUnion("action", [
  cookingFinishSchema.extend({ action: z.literal("finish") }).strict(),
  cookingNoteSchema.extend({ action: z.literal("note") }).strict(),
]);
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const actor = await requestActor(request), { id } = await params, input = actionSchema.parse(await readJson(request));
    if (input.action === "note") return json(await addCookingSessionNote(database(), actor, id, { body: input.body }), 201);
    return json(await finishCookingSession(database(), actor, id, { expectedRevision: input.expectedRevision, status: input.status, rating: input.rating, summary: input.summary }));
  } catch (error) { return apiError(error); }
}
