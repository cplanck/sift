import { and, eq } from "drizzle-orm";
import { z } from "zod";
import type { Database, Executor } from "@/db/connection";
import { users, workspaceMembers, workspaces } from "@/db/schema";
import { DomainError } from "@/domain/errors";

export const actorSchema = z.object({ userId: z.uuid(), workspaceId: z.uuid() });
export type Actor = z.infer<typeof actorSchema>;

export async function assertMembership(db: Executor, actor: Actor) {
  if (!actorSchema.safeParse(actor).success) throw new DomainError("NOT_FOUND", "Cookbook not found.");
  const [membership] = await db.select().from(workspaceMembers).where(and(
    eq(workspaceMembers.workspaceId, actor.workspaceId), eq(workspaceMembers.userId, actor.userId),
  )).limit(1);
  if (!membership) throw new DomainError("NOT_FOUND", "Cookbook not found.");
  return membership;
}

// Serialized on the user row, so concurrent sign-in/bootstrap requests cannot
// create orphan workspaces or duplicate owner memberships.
export async function ensurePersonalWorkspace(db: Database, userId: string) {
  return db.transaction(async (tx) => {
    const [user] = await tx.select().from(users).where(eq(users.id, userId)).for("update");
    if (!user) throw new DomainError("UNAUTHENTICATED", "Please sign in.");
    if (user.activeWorkspaceId) {
      await assertMembership(tx, { userId, workspaceId: user.activeWorkspaceId });
      return user.activeWorkspaceId;
    }
    const [existing] = await tx.select().from(workspaces).where(eq(workspaces.personalForUserId, userId));
    if (existing) {
      await assertMembership(tx, { userId, workspaceId: existing.id });
      await tx.update(users).set({ activeWorkspaceId: existing.id, updatedAt: new Date() }).where(eq(users.id, userId));
      return existing.id;
    }
    const [workspace] = await tx.insert(workspaces).values({ name: "My cookbook", personalForUserId: userId }).returning();
    await tx.insert(workspaceMembers).values({ workspaceId: workspace.id, userId, role: "owner" });
    await tx.update(users).set({ activeWorkspaceId: workspace.id, updatedAt: new Date() }).where(eq(users.id, userId));
    return workspace.id;
  });
}

export async function getWorkspace(db: Database, actor: Actor) {
  await assertMembership(db, actor);
  const [workspace] = await db.select().from(workspaces).where(eq(workspaces.id, actor.workspaceId));
  if (!workspace) throw new DomainError("NOT_FOUND", "Cookbook not found.");
  return workspace;
}
