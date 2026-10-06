import { and, asc, eq, ne } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "@/db/connection";
import { cookingSessions, cookingTimers, recipeVersions } from "@/db/schema";
import { changeTimer, createCookingTimerSchema, timerPhase, updateCookingTimerSchema, type CookingTimerRecord } from "@/domain/cooking-timer";
import { DomainError } from "@/domain/errors";
import { assertMembership, type Actor } from "./workspaces";

function serialize(row: typeof cookingTimers.$inferSelect): CookingTimerRecord {
  return { id: row.id, sessionId: row.sessionId, label: row.label, stepKey: row.stepKey, durationSeconds: row.durationSeconds, remainingMs: row.remainingMs, dueAt: row.dueAt?.toISOString() ?? null, status: row.status, revision: row.revision };
}
async function sessionForTimers(db: Database, actor: Actor, id: string, editing: boolean) {
  await assertMembership(db, actor);
  if (!z.uuid().safeParse(id).success) throw new DomainError("NOT_FOUND", "Cook not found.");
  const query = db.select().from(cookingSessions).where(and(eq(cookingSessions.workspaceId, actor.workspaceId), eq(cookingSessions.id, id)));
  const [session] = await (editing ? query.for("update") : query);
  if (!session || (editing && session.startedByUserId !== actor.userId)) throw new DomainError("NOT_FOUND", "Cook not found.");
  if (editing && session.status !== "active") throw new DomainError("CONFLICT", "This cook has ended.");
  return session;
}
export async function listCookingTimers(db: Database, actor: Actor, sessionId: string) {
  await sessionForTimers(db, actor, sessionId, false);
  const rows = await db.select().from(cookingTimers).where(and(eq(cookingTimers.workspaceId, actor.workspaceId), eq(cookingTimers.sessionId, sessionId), ne(cookingTimers.status, "dismissed"))).orderBy(asc(cookingTimers.createdAt));
  return { timers: rows.map(serialize), serverNow: new Date().toISOString() };
}
export async function createCookingTimer(db: Database, actor: Actor, sessionId: string, input: unknown) {
  const data = createCookingTimerSchema.parse(input);
  return db.transaction(async (tx) => {
    const session = await sessionForTimers(tx, actor, sessionId, true);
    if (data.id) {
      const [existing] = await tx.select().from(cookingTimers).where(and(eq(cookingTimers.id, data.id), eq(cookingTimers.workspaceId, actor.workspaceId), eq(cookingTimers.sessionId, sessionId)));
      if (existing) {
        if (existing.label !== data.label || existing.durationSeconds !== data.durationSeconds || existing.stepKey !== (data.stepKey ?? null)) throw new DomainError("CONFLICT", "That timer request was already used.");
        return { timer: serialize(existing), serverNow: new Date().toISOString() };
      }
    }
    if (data.stepKey) {
      const [version] = await tx.select().from(recipeVersions).where(and(eq(recipeVersions.workspaceId, actor.workspaceId), eq(recipeVersions.id, session.recipeVersionId)));
      const [section, index] = data.stepKey.split(":").map(Number);
      if (!version?.content.instructionSections[section]?.steps[index]) throw new DomainError("INVALID_INPUT", "Choose a step from this cook.");
    }
    const existing = await tx.select({ id: cookingTimers.id }).from(cookingTimers).where(and(eq(cookingTimers.workspaceId, actor.workspaceId), eq(cookingTimers.sessionId, sessionId), ne(cookingTimers.status, "dismissed")));
    if (existing.length >= 20) throw new DomainError("INVALID_INPUT", "Dismiss a timer before adding more. A cook can have up to 20 timers.");
    const now = new Date();
    const [created] = await tx.insert(cookingTimers).values({ ...data, workspaceId: actor.workspaceId, sessionId, remainingMs: data.durationSeconds * 1000, dueAt: new Date(now.getTime() + data.durationSeconds * 1000) }).returning();
    return { timer: serialize(created), serverNow: now.toISOString() };
  });
}
export async function updateCookingTimer(db: Database, actor: Actor, sessionId: string, timerId: string, input: unknown) {
  const data = updateCookingTimerSchema.parse(input);
  if (!z.uuid().safeParse(timerId).success) throw new DomainError("NOT_FOUND", "Timer not found.");
  return db.transaction(async (tx) => {
    await sessionForTimers(tx, actor, sessionId, true);
    const where = and(eq(cookingTimers.workspaceId, actor.workspaceId), eq(cookingTimers.sessionId, sessionId), eq(cookingTimers.id, timerId));
    const [row] = await tx.select().from(cookingTimers).where(where).for("update");
    if (!row) throw new DomainError("NOT_FOUND", "Timer not found.");
    if (row.revision !== data.expectedRevision || row.status === "dismissed") throw new DomainError("CONFLICT", "This timer changed on another device or through Sift. Refresh and try again.");
    const now = new Date();
    const phase = timerPhase(serialize(row), now.getTime());
    if ((data.action === "pause" && phase !== "running") || (data.action === "resume" && phase !== "paused")) throw new DomainError("CONFLICT", "That timer is no longer in a state that supports this action.");
    const next = changeTimer(serialize(row), data, now.getTime());
    const [saved] = await tx.update(cookingTimers).set({ status: next.status, dueAt: next.dueAt ? new Date(next.dueAt) : null, remainingMs: next.remainingMs, revision: next.revision, updatedAt: now }).where(where).returning();
    return { timer: serialize(saved), serverNow: now.toISOString() };
  });
}
