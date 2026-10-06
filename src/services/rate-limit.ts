import { eq, lt, sql } from "drizzle-orm";
import { createHash } from "node:crypto";
import type { Database } from "@/db/connection";
import { usageLimits } from "@/db/schema";
import { DomainError } from "@/domain/errors";
import { assertMembership, type Actor } from "./workspaces";

type LimitFeature = "import" | "photo" | "photo_finalize" | "assistant" | "voice" | "mcp" | "web";

function limitWindow(actor: Actor, feature: LimitFeature, seconds: number, bucket?: string) {
  const window = Math.floor(Date.now() / (seconds * 1000));
  const key = `${actor.userId}:${feature}${bucket ? `:${createHash("sha256").update(bucket).digest("hex")}` : ""}:${window}`;
  return { key, expiresAt: new Date((window + 1) * seconds * 1000) };
}

function limitReached(feature: LimitFeature, seconds: number, expiresAt: Date) {
  const labels: Record<LimitFeature, string> = { import: "recipe-import", photo: "photo-upload", photo_finalize: "photo-processing", assistant: "assistant", voice: "voice-start", mcp: "connected-app request", web: "web page" };
  const minutes = Math.max(1, Math.ceil((expiresAt.getTime() - Date.now()) / 60_000));
  const time = expiresAt.toISOString().slice(11, 16);
  return new DomainError("RATE_LIMITED", `You’ve reached Sift’s ${seconds === 3600 ? "hourly " : ""}${labels[feature]} limit. Try again in ${minutes} ${minutes === 1 ? "minute" : "minutes"} (${time} UTC).`);
}

/** Availability only; the admitted operation must still consume atomically. */
export async function assertLimitAvailable(db: Database, actor: Actor, feature: LimitFeature, max: number, seconds = 3600, bucket?: string) {
  await assertMembership(db, actor);
  const { key } = limitWindow(actor, feature, seconds, bucket);
  const [limit] = await db.select({ count: usageLimits.count, expiresAt: usageLimits.expiresAt }).from(usageLimits).where(eq(usageLimits.key, key));
  if (limit && limit.count >= max) throw limitReached(feature, seconds, limit.expiresAt);
}

export async function consumeLimit(db: Database, actor: Actor, feature: LimitFeature, max: number, seconds = 3600, bucket?: string) {
  await assertMembership(db, actor);
  const { key, expiresAt } = limitWindow(actor, feature, seconds, bucket);
  const [limit] = await db.insert(usageLimits).values({ key, userId: actor.userId, count: 1, expiresAt })
    .onConflictDoUpdate({ target: usageLimits.key, set: { count: sql`${usageLimits.count} + 1` }, setWhere: lt(usageLimits.count, max) }).returning();
  if (!limit) {
    const [existing] = await db.select({ expiresAt: usageLimits.expiresAt }).from(usageLimits).where(eq(usageLimits.key, key));
    throw limitReached(feature, seconds, existing?.expiresAt ?? expiresAt);
  }
  await db.delete(usageLimits).where(lt(usageLimits.expiresAt, new Date(Date.now() - 86400000)));
}
