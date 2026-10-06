import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "@/db/connection";
import { coverAttempts, coverDailyBudgets, coverRequests, recipes, workspaces } from "@/db/schema";
import { COVER_PROMPT_VERSION, ENHANCE_PROMPT_VERSION, coverContentHash } from "@/domain/cover";
import { DomainError } from "@/domain/errors";
import { env } from "@/lib/env";
import { r2 } from "@/lib/r2";
import { requireJobs } from "@/jobs/client";
import { getPhoto } from "./photos";
import { getRecipe } from "./recipes";
import { assertMembership, type Actor } from "./workspaces";

export function coverGenerationConfig() {
  const config = env();
  const enabled = config.COVER_GENERATION_ENABLED === "1" && !!config.COVER_IMAGE_MODEL && !!config.COVER_DAILY_BUDGET_USD && !!config.COVER_REQUEST_RESERVATION_USD && config.COVER_REQUEST_RESERVATION_USD <= config.COVER_DAILY_BUDGET_USD;
  return { enabled, model: config.COVER_IMAGE_MODEL, editModel: config.COVER_IMAGE_EDIT_MODEL, budget: config.COVER_DAILY_BUDGET_USD, reservation: config.COVER_REQUEST_RESERVATION_USD };
}
export async function getRecipeCoverState(db: Database, actor: Actor, recipeId: string) {
  const recipe = await getRecipe(db, actor, recipeId);
  const requests = await db.select({ id: coverRequests.id, status: coverRequests.status, sourcePhotoId: coverRequests.sourcePhotoId, candidatePhotoId: coverRequests.candidatePhotoId, contentHash: coverRequests.contentHash, errorMessage: coverRequests.errorMessage, createdAt: coverRequests.createdAt, retainedOutput: sql<boolean>`${coverAttempts.outputBase64} is not null` }).from(coverRequests).leftJoin(coverAttempts, eq(coverAttempts.requestId, coverRequests.id)).where(and(eq(coverRequests.workspaceId, actor.workspaceId), eq(coverRequests.recipeId, recipeId))).orderBy(desc(coverRequests.createdAt)).limit(8);
  return { recipeId, coverPhotoId: recipe.coverPhotoId, coverRevision: recipe.coverRevision, coverSelection: recipe.coverSelection, generationEnabled: coverGenerationConfig().enabled, requests: requests.map(({ contentHash, ...request }) => ({ ...request, basedOnEarlierRecipe: contentHash !== coverContentHash(recipe.version.content) })) };
}
export async function requestRecipeCover(db: Database, actor: Actor, recipeId: string, input: unknown) {
  const { idempotencyKey, expectedVersionId, sourcePhotoId } = z.object({ idempotencyKey: z.string().min(1).max(200), expectedVersionId: z.uuid(), sourcePhotoId: z.uuid().optional() }).strict().parse(input);
  return db.transaction(async (tx) => {
    await assertMembership(tx, actor);
    // Workspace lock serializes budget reservations and cross-recipe idempotency.
    await tx.select({ id: workspaces.id }).from(workspaces).where(eq(workspaces.id, actor.workspaceId)).for("update");
    const recipe = await getRecipe(tx, actor, recipeId);
    await tx.select({ id: recipes.id }).from(recipes).where(eq(recipes.id, recipeId)).for("update");
    const [existing] = await tx.select().from(coverRequests).where(and(eq(coverRequests.workspaceId, actor.workspaceId), eq(coverRequests.idempotencyKey, idempotencyKey)));
    if (existing) {
      if (existing.recipeId !== recipeId || existing.sourcePhotoId !== (sourcePhotoId ?? null)) throw new DomainError("CONFLICT", "This request belongs to another recipe.");
      return { requestId: existing.id, status: existing.status };
    }
    const [active] = await tx.select().from(coverRequests).where(and(eq(coverRequests.recipeId, recipeId), inArray(coverRequests.status, ["queued", "running"])));
    if (active) {
      if (active.sourcePhotoId !== (sourcePhotoId ?? null)) throw new DomainError("CONFLICT", "Another photo is already being prepared. Wait for it to finish.");
      return { requestId: active.id, status: active.status };
    }
    if (sourcePhotoId) {
      const photo = await getPhoto(tx, actor, sourcePhotoId);
      if (photo.recipeId !== recipeId || photo.status !== "ready" || !["recipe", "cooking"].includes(photo.purpose) || photo.origin === "generated") throw new DomainError("NOT_FOUND", "Original recipe photo not found.");
    }
    const config = coverGenerationConfig();
    if (!config.enabled) throw new DomainError("INVALID_INPUT", "Photo enhancement and cover generation are not configured yet.");
    if (recipe.version.id !== expectedVersionId) throw new DomainError("CONFLICT", "The recipe changed. Reload before generating its cover.");
    r2(); requireJobs();
    const day = new Date().toISOString().slice(0, 10);
    const [spend] = await tx.select().from(coverDailyBudgets).where(and(eq(coverDailyBudgets.workspaceId, actor.workspaceId), eq(coverDailyBudgets.day, day)));
    if (Number(spend?.committedUsd ?? 0) + config.reservation! > config.budget! + 1e-10) throw new DomainError("RATE_LIMITED", "This workspace has reached its daily cover budget. Try again tomorrow.");
    await tx.insert(coverDailyBudgets).values({ workspaceId: actor.workspaceId, day, committedUsd: config.reservation!.toFixed(10) }).onConflictDoUpdate({ target: [coverDailyBudgets.workspaceId, coverDailyBudgets.day], set: { committedUsd: sql`${coverDailyBudgets.committedUsd} + ${config.reservation!.toFixed(10)}` } });
    const [request] = await tx.insert(coverRequests).values({ workspaceId: actor.workspaceId, recipeId, requestedByUserId: actor.userId, idempotencyKey, sourcePhotoId, snapshot: recipe.version.content, contentHash: coverContentHash(recipe.version.content), expectedCoverRevision: recipe.coverRevision, model: sourcePhotoId ? config.editModel : config.model!, promptVersion: sourcePhotoId ? ENHANCE_PROMPT_VERSION : COVER_PROMPT_VERSION, reservedUsd: config.reservation!.toFixed(10) }).returning();
    return { requestId: request.id, status: request.status };
  });
}
export async function cancelRecipeCover(db: Database, actor: Actor, recipeId: string, requestId: string) {
  await getRecipe(db, actor, recipeId);
  z.uuid().parse(requestId);
  await db.update(coverRequests).set({ status: "cancelled", updatedAt: new Date() }).where(and(eq(coverRequests.id, requestId), eq(coverRequests.workspaceId, actor.workspaceId), eq(coverRequests.recipeId, recipeId), inArray(coverRequests.status, ["queued", "running"])));
  return { cancelled: true };
}

export async function resumeRecipeCover(db: Database, actor: Actor, recipeId: string, requestId: string) {
  z.uuid().parse(requestId);
  return db.transaction(async (tx) => {
    await getRecipe(tx, actor, recipeId);
    await tx.select({ id: workspaces.id }).from(workspaces).where(eq(workspaces.id, actor.workspaceId)).for("update");
    const [active] = await tx.select({ id: coverRequests.id }).from(coverRequests).where(and(eq(coverRequests.recipeId, recipeId), inArray(coverRequests.status, ["queued", "running"])));
    if (active) throw new DomainError("CONFLICT", "Another cover is already being prepared.");
    const [request] = await tx.select({ id: coverRequests.id }).from(coverRequests).innerJoin(coverAttempts, eq(coverAttempts.requestId, coverRequests.id)).where(and(eq(coverRequests.id, requestId), eq(coverRequests.recipeId, recipeId), eq(coverRequests.workspaceId, actor.workspaceId), eq(coverRequests.status, "failed"), sql`${coverAttempts.outputBase64} is not null`));
    if (!request) throw new DomainError("INVALID_INPUT", "This request has no saved image to recover. Start a new cover instead.");
    await tx.update(coverRequests).set({ status: "queued", dispatchedAt: null, errorMessage: null, updatedAt: new Date() }).where(eq(coverRequests.id, requestId));
    return { requestId, status: "queued" as const };
  });
}
