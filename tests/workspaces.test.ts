import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { connectDatabase } from "@/db/connection";
import { users, workspaceMembers, workspaces } from "@/db/schema";
import { ensurePersonalWorkspace, getWorkspace } from "@/services/workspaces";
import { testDatabaseUrl } from "./database";

const { db, pool } = connectDatabase(testDatabaseUrl);
const userA = randomUUID(), userB = randomUUID();
beforeAll(async () => {
  await db.insert(users).values([userA, userB].map((id) => ({ id, email: `${id}@example.test`, name: "Test cook" })));
});
afterAll(async () => { await db.delete(users).where(inArray(users.id, [userA, userB])); await pool.end(); });
describe("personal workspace and authorization", () => {
  it("bootstraps one workspace atomically under concurrent requests", async () => {
    const ids = await Promise.all(Array.from({ length: 4 }, () => ensurePersonalWorkspace(db, userA)));
    expect(new Set(ids).size).toBe(1);
    const [user] = await db.select().from(users).where(eq(users.id, userA));
    expect(user.activeWorkspaceId).toBe(ids[0]);
    const members = await db.select().from(workspaceMembers).where(eq(workspaceMembers.userId, userA));
    expect(members).toHaveLength(1);
    expect(members[0].role).toBe("owner");
    expect(await db.select().from(workspaces).where(eq(workspaces.personalForUserId, userA))).toHaveLength(1);
  });
  it("never authorizes another user's workspace from a guessed ID", async () => {
    const workspaceId = await ensurePersonalWorkspace(db, userB);
    await expect(getWorkspace(db, { userId: userA, workspaceId })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await getWorkspace(db, { userId: userB, workspaceId })).personalForUserId).toBe(userB);
  });
  it("does not restore revoked membership during bootstrap", async () => {
    const workspaceId = await ensurePersonalWorkspace(db, userB);
    await db.delete(workspaceMembers).where(eq(workspaceMembers.workspaceId, workspaceId));
    await expect(ensurePersonalWorkspace(db, userB)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
