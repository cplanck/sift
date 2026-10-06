import { and, eq, isNull, lt, or } from "drizzle-orm";
import { z } from "zod";
import { database } from "@/db";
import type { Database } from "@/db/connection";
import { cookingSessionNotes } from "@/db/schema";
import { organizeCookingNotes } from "@/ai/organize-cooking-notes";
import { assertCookingSessionOwner } from "@/services/cooking";
import { inngest, requireJobs } from "./client";

export async function dispatchCookingNotes() {
  requireJobs();
  const db = database();
  // An interrupted provider call isn't automatically purchased a second time.
  await db.update(cookingSessionNotes).set({ cleanupStatus: "failed" }).where(and(eq(cookingSessionNotes.cleanupStatus, "processing"), lt(cookingSessionNotes.cleanupStartedAt, new Date(Date.now() - 600000))));
  const notes = await db.select({ id: cookingSessionNotes.id }).from(cookingSessionNotes).where(and(eq(cookingSessionNotes.cleanupStatus, "queued"), or(isNull(cookingSessionNotes.cleanupDispatchedAt), lt(cookingSessionNotes.cleanupDispatchedAt, new Date(Date.now() - 300000))))).limit(30);
  for (const note of notes) {
    await inngest.send({ id: `cook-note-${note.id}-${Math.floor(Date.now() / 300000)}`, name: "sift/cooking-note.requested", data: { noteId: note.id } });
    await db.update(cookingSessionNotes).set({ cleanupDispatchedAt: new Date() }).where(eq(cookingSessionNotes.id, note.id));
  }
  return { dispatched: notes.length };
}

export async function processCookingNote(db: Database, noteId: string) {
  const [note] = await db.update(cookingSessionNotes).set({ cleanupStatus: "processing", cleanupStartedAt: new Date() })
    .where(and(eq(cookingSessionNotes.id, noteId), eq(cookingSessionNotes.cleanupStatus, "queued"))).returning();
  if (!note) return;
  try {
    if (!note.createdByUserId) throw new Error("Note owner unavailable.");
    const actor = { userId: note.createdByUserId, workspaceId: note.workspaceId };
    await assertCookingSessionOwner(db, actor, note.sessionId);
    const organizedBody = await organizeCookingNotes(db, actor, note);
    await db.update(cookingSessionNotes).set({ organizedBody, cleanupStatus: "ready" }).where(and(eq(cookingSessionNotes.id, note.id), eq(cookingSessionNotes.cleanupStatus, "processing")));
  } catch {
    // Original notes remain readable, including when credentials or jobs fail.
    await db.update(cookingSessionNotes).set({ cleanupStatus: "failed" }).where(and(eq(cookingSessionNotes.id, note.id), eq(cookingSessionNotes.cleanupStatus, "processing")));
  }
}

export const dispatchCookingNotesJob = inngest.createFunction({ id: "dispatch-cooking-notes", triggers: { cron: "* * * * *" } }, () => dispatchCookingNotes());
export const organizeCookingNotesJob = inngest.createFunction({ id: "organize-cooking-notes", triggers: { event: "sift/cooking-note.requested" }, retries: 0, concurrency: { limit: 3 } }, async ({ event, step }) => {
  const { noteId } = z.object({ noteId: z.uuid() }).parse(event.data);
  await step.run("organize-and-save", async () => { await processCookingNote(database(), noteId); });
  return { noteId };
});
