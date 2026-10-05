import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { connectDatabase } from "@/db/connection";
import { usageLimits, users, workspaceMembers } from "@/db/schema";
import { assertLimitAvailable, consumeLimit } from "@/services/rate-limit";
import { ensurePersonalWorkspace, type Actor } from "@/services/workspaces";
import { testDatabaseUrl } from "./database";

const { db, pool } = connectDatabase(testDatabaseUrl);
const userIds = [randomUUID(), randomUUID()];
const now = Math.floor(Date.now() / 3_600_000) * 3_600_000 + 10 * 60_000;
let actor: Actor, other: Actor;
const rows = () => db.select().from(usageLimits).where(eq(usageLimits.userId, actor.userId));
beforeAll(async () => {
  await db.insert(users).values(userIds.map((id) => ({ id, email: `${id}@example.test`, name: "Quota test" })));
  actor = { userId: userIds[0], workspaceId: await ensurePersonalWorkspace(db, userIds[0]) };
  other = { userId: userIds[1], workspaceId: await ensurePersonalWorkspace(db, userIds[1]) };
});
beforeEach(() => { vi.spyOn(Date, "now").mockReturnValue(now); });
afterEach(async () => { vi.restoreAllMocks(); await db.delete(usageLimits).where(inArray(usageLimits.userId, userIds)); });
afterAll(async () => { await db.delete(users).where(inArray(users.id, userIds)); await pool.end(); });

describe("authenticated operation quotas", () => {
  it("checks availability without creating or consuming a bucket and reports an actionable Sift limit", async () => {
    await Promise.all(Array.from({ length: 4 }, () => assertLimitAvailable(db, actor, "assistant", 2)));
    expect(await rows()).toHaveLength(0);
    await consumeLimit(db, actor, "assistant", 2);
    await assertLimitAvailable(db, actor, "assistant", 2);
    expect((await rows())[0].count).toBe(1);
    await consumeLimit(db, actor, "assistant", 2);
    const expiry = new Date(Math.floor(now / 3_600_000) * 3_600_000 + 3_600_000);
    const message = `You’ve reached Sift’s hourly assistant limit. Try again in 50 minutes (${expiry.toISOString().slice(11, 16)} UTC).`;
    await expect(assertLimitAvailable(db, actor, "assistant", 2)).rejects.toMatchObject({ code: "RATE_LIMITED", message });
    await expect(consumeLimit(db, actor, "assistant", 2)).rejects.toMatchObject({ code: "RATE_LIMITED", message });
    expect((await rows())[0].count).toBe(2);
  });

  it("admits exactly the maximum under real concurrent PostgreSQL writes without counting rejections", async () => {
    const results = await Promise.allSettled(Array.from({ length: 20 }, () => consumeLimit(db, actor, "assistant", 4)));
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(4);
    const rejected = results.filter((result) => result.status === "rejected");
    expect(rejected).toHaveLength(16);
    for (const result of rejected) if (result.status === "rejected") expect(result.reason).toMatchObject({ code: "RATE_LIMITED" });
    expect((await rows()).map((row) => row.count)).toEqual([4]);
  });

  it("rejects a previously inflated bucket without increasing or silently repairing it", async () => {
    const key = `${actor.userId}:assistant:${Math.floor(now / 3_600_000)}`;
    const expiresAt = new Date(now + 50 * 60_000);
    await db.insert(usageLimits).values({ key, userId: actor.userId, count: 190, expiresAt });
    await expect(assertLimitAvailable(db, actor, "assistant", 60)).rejects.toMatchObject({ code: "RATE_LIMITED" });
    await expect(consumeLimit(db, actor, "assistant", 60)).rejects.toMatchObject({ code: "RATE_LIMITED" });
    expect((await rows())[0]).toMatchObject({ count: 190, expiresAt });
  });

  it("rolls back consumption with the admitted operation and permits the next time window", async () => {
    await expect(db.transaction(async (tx) => {
      await consumeLimit(tx, actor, "assistant", 1);
      throw new Error("admission rolled back");
    })).rejects.toThrow("admission rolled back");
    expect(await rows()).toHaveLength(0);
    await consumeLimit(db, actor, "assistant", 1);
    vi.mocked(Date.now).mockReturnValue(now + 3_600_000);
    await assertLimitAvailable(db, actor, "assistant", 1);
    await consumeLimit(db, actor, "assistant", 1);
    expect((await rows()).map((row) => row.count)).toEqual([1, 1]);
  });

  it("preserves separate feature, user, and scoped short-window buckets", async () => {
    await consumeLimit(db, actor, "voice", 1);
    await assertLimitAvailable(db, actor, "assistant", 1);
    await consumeLimit(db, other, "voice", 1);
    await consumeLimit(db, actor, "mcp", 1, 60, "client-a");
    await expect(assertLimitAvailable(db, actor, "mcp", 1, 60, "client-a")).rejects.toMatchObject({ code: "RATE_LIMITED" });
    await assertLimitAvailable(db, actor, "mcp", 1, 60, "client-b");
    await consumeLimit(db, actor, "mcp", 1, 60, "client-b");
    const saved = await rows();
    expect(saved).toHaveLength(3);
    expect(saved.every((row) => row.count === 1 && !row.key.includes("client-"))).toBe(true);
  });

  it("authorizes both availability checks and consumption before touching another workspace", async () => {
    const unauthorized = { userId: actor.userId, workspaceId: other.workspaceId };
    await expect(assertLimitAvailable(db, unauthorized, "assistant", 1)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(consumeLimit(db, unauthorized, "assistant", 1)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await db.delete(workspaceMembers).where(eq(workspaceMembers.userId, other.userId));
    await expect(assertLimitAvailable(db, other, "voice", 1)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(consumeLimit(db, other, "voice", 1)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await rows()).toHaveLength(0);
  });
});
