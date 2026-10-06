import { z } from "zod";
import { after } from "next/server";
import { dispatchCookingNotes } from "@/jobs/organize-cooking-notes";
import { cookingFinishSchema, cookingNoteSchema } from "@/domain/cooking";
import { database } from "@/db";
import { requestActor } from "@/lib/auth";
import { apiError, assertSameOrigin, json, readJson } from "@/lib/http";
import { addCookingSessionNote, discardCookingSession, finishCookingSession } from "@/services/cooking";

const actionSchema = z.discriminatedUnion("action", [
  cookingFinishSchema.extend({ action: z.literal("finish") }).strict(),
  cookingNoteSchema.extend({ action: z.literal("note") }).strict(),
  z.object({ action: z.literal("discard"), expectedRevision: z.number().int().positive() }).strict(),
]);
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const actor = await requestActor(request), { id } = await params, input = actionSchema.parse(await readJson(request));
    if (input.action === "note") return json(await addCookingSessionNote(database(), actor, id, { body: input.body }), 201);
    if (input.action === "discard") return json(await discardCookingSession(database(), actor, id, { expectedRevision: input.expectedRevision }));
    const session = await finishCookingSession(database(), actor, id, { expectedRevision: input.expectedRevision, status: input.status, rating: input.rating, summary: input.summary, notes: input.notes });
    if (session.notes.some((note) => note.cleanupStatus === "queued")) after(async () => { await dispatchCookingNotes().catch(() => { /* Durable notes will be picked up by the dispatcher. */ }); });
    return json(session);
  } catch (error) { return apiError(error); }
}
