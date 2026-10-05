import { lt, sql } from "drizzle-orm";
import type { Database } from "@/db/connection";
import { usageLimits } from "@/db/schema";
import { DomainError } from "@/domain/errors";
import { assertMembership, type Actor } from "./workspaces";

export async function consumeLimit(db: Database, actor: Actor, feature: "import" | "photo" | "photo_finalize" | "assistant" | "voice", max: number, seconds = 3600) {
  await assertMembership(db, actor);
  const window = Math.floor(Date.now() / (seconds * 1000));
  const key = `${actor.userId}:${feature}:${window}`;
  const [limit] = await db.insert(usageLimits).values({ key, userId: actor.userId, count: 1, expiresAt: new Date((window + 1) * seconds * 1000) })
    .onConflictDoUpdate({ target: usageLimits.key, set: { count: sql`${usageLimits.count} + 1` } }).returning();
  await db.delete(usageLimits).where(lt(usageLimits.expiresAt, new Date(Date.now() - 86400000)));
  if (limit.count > max) throw new DomainError("RATE_LIMITED", "You’ve reached the limit for now. Please try again later.");
}
