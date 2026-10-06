import { createHash, randomUUID } from "node:crypto";
import { createGateway } from "@ai-sdk/gateway";
import { generateImage } from "ai";
import { and, eq, isNull, lt, or, sql } from "drizzle-orm";
import sharp from "sharp";
import { z } from "zod";
import { database } from "@/db";
import { coverAttempts, coverDailyBudgets, coverRequests, photos } from "@/db/schema";
import { coverPrompt, enhancementPrompt } from "@/domain/cover";
import { env } from "@/lib/env";
import { MAX_PHOTO_BYTES, readPhotoObject, writePhotoObject, writeUploadObject } from "@/lib/r2";
import { reportedGatewayCost } from "@/services/ai-usage";
import { resolveGatewayCredential } from "@/services/credentials";
import { getPhoto } from "@/services/photos";
import { assertMembership } from "@/services/workspaces";
import { inngest } from "./client";

export async function dispatchCoverRequests() {
  const db = database();
  const queued = await db.select({ id: coverRequests.id, updatedAt: coverRequests.updatedAt }).from(coverRequests).where(and(eq(coverRequests.status, "queued"), or(isNull(coverRequests.dispatchedAt), lt(coverRequests.dispatchedAt, new Date(Date.now() - 300000))))).limit(30);
  for (const request of queued) {
    await inngest.send({ id: `cover-${request.id}-${request.updatedAt.getTime()}`, name: "sift/cover.requested", data: { requestId: request.id } });
    await db.update(coverRequests).set({ dispatchedAt: new Date() }).where(eq(coverRequests.id, request.id));
  }
  return { dispatched: queued.length };
}
export const dispatchCoversJob = inngest.createFunction({ id: "dispatch-covers", triggers: { cron: "* * * * *" } }, () => dispatchCoverRequests());

export async function produceCover(requestId: string) {
  const db = database();
  const [request] = await db.select().from(coverRequests).where(eq(coverRequests.id, requestId));
  if (!request || !["queued", "running"].includes(request.status)) return;
  const actor = { workspaceId: request.workspaceId, userId: request.requestedByUserId };
  await assertMembership(db, actor);
  let [attempt] = await db.select().from(coverAttempts).where(eq(coverAttempts.requestId, requestId));
  if (!attempt) {
    if (env().COVER_GENERATION_ENABLED !== "1") throw new Error("Cover generation is disabled.");
    const userKey = await resolveGatewayCredential(db, actor.userId), key = userKey ?? env().AI_GATEWAY_API_KEY;
    if (!key) throw new Error("Image credentials are unavailable.");
    let prompt: Parameters<typeof generateImage>[0]["prompt"] = coverPrompt(request.snapshot);
    if (request.sourcePhotoId) {
      const photo = await getPhoto(db, actor, request.sourcePhotoId);
      if (photo.recipeId !== request.recipeId || photo.status !== "ready" || !["recipe", "cooking"].includes(photo.purpose)) throw new Error("Original photo is unavailable.");
      prompt = { images: [await readPhotoObject(photo.objectKey)], text: enhancementPrompt(request.snapshot) };
    }
    // Claim BEFORE calling the provider. An interrupted or ambiguous call is
    // never automatically purchased again, including job/SDK retries.
    const claimed = await db.transaction(async (tx) => {
      const [current] = await tx.select().from(coverRequests).where(eq(coverRequests.id, requestId)).for("update");
      if (!current || current.status !== "queued") return false;
      await tx.insert(coverAttempts).values({ requestId, credentialSource: userKey ? "user" : "app" });
      await tx.update(coverRequests).set({ status: "running", updatedAt: new Date() }).where(eq(coverRequests.id, requestId));
      return true;
    });
    if (!claimed) return;
    const start = Date.now();
    const result = await generateImage({ model: createGateway({ apiKey: key }).imageModel(request.model), prompt, n: 1, maxImagesPerCall: 1, aspectRatio: "4:3", maxRetries: 0, abortSignal: AbortSignal.timeout(75000) });
    const bytes = result.image.uint8Array;
    const metadata = result.calls[0]?.providerMetadata;
    const gateway = metadata?.gateway as Record<string, unknown> | undefined;
    const generationId = typeof gateway?.generationId === "string" ? gateway.generationId.slice(0, 200) : null;
    const cost = reportedGatewayCost(metadata);
    await db.transaction(async (tx) => {
      await tx.update(coverAttempts).set({ costUsd: cost, generationId, latencyMs: Date.now() - start }).where(eq(coverAttempts.requestId, requestId));
      const overage = Math.max(0, Number(cost ?? 0) - Number(request.reservedUsd));
      if (overage) await tx.update(coverDailyBudgets).set({ committedUsd: sql`${coverDailyBudgets.committedUsd} + ${overage.toFixed(10)}` }).where(and(eq(coverDailyBudgets.workspaceId, request.workspaceId), eq(coverDailyBudgets.day, request.createdAt.toISOString().slice(0, 10))));
    });
    if (!bytes.byteLength || bytes.byteLength > MAX_PHOTO_BYTES) throw new Error("Image exceeds the size limit.");
    [attempt] = await db.update(coverAttempts).set({ outputBase64: Buffer.from(bytes).toString("base64"), mediaType: result.image.mediaType }).where(eq(coverAttempts.requestId, requestId)).returning();
  }
  if (attempt?.outputBase64 && request.status === "queued") await db.update(coverRequests).set({ status: "running", updatedAt: new Date() }).where(and(eq(coverRequests.id, requestId), eq(coverRequests.status, "queued")));
  if (!attempt?.outputBase64) throw new Error("The provider outcome is unknown. Start a new request explicitly to try again.");
  const bytes = Buffer.from(attempt.outputBase64, "base64");
  const source = sharp(bytes, { limitInputPixels: 40_000_000, animated: false });
  const meta = await source.metadata();
  if (!["png", "jpeg", "webp"].includes(meta.format ?? "") || !meta.width || !meta.height || (meta.pages ?? 1) > 1) throw new Error("Unsupported generated image.");
  const oriented = meta.orientation && meta.orientation >= 5 ? { width: meta.height, height: meta.width } : { width: meta.width, height: meta.height };
  const maxWidth = Math.min(1200, oriented.width, Math.floor(oriented.height * 4 / 3));
  if (maxWidth < 320) throw new Error("Generated image is too small.");
  const base = `workspaces/${request.workspaceId}/generated/${requestId}`;
  const originalObjectKey = `${base}/original.${meta.format}`;
  await writeUploadObject(originalObjectKey, bytes, `image/${meta.format}`);
  const variants: { objectKey: string; width: number; height: number; byteSize: number }[] = [];
  for (const width of [...new Set([320, 640, maxWidth].filter((width) => width <= maxWidth))]) {
    const output = await source.clone().rotate().resize(width, Math.round(width * 3 / 4), { fit: "cover", withoutEnlargement: true }).webp({ quality: 85 }).toBuffer({ resolveWithObject: true });
    const objectKey = `${base}/${output.info.width}.webp`;
    await writePhotoObject(objectKey, output.data);
    variants.push({ objectKey, width: output.info.width, height: output.info.height, byteSize: output.data.byteLength });
  }
  await db.transaction(async (tx) => {
    const [current] = await tx.select().from(coverRequests).where(eq(coverRequests.id, requestId)).for("update");
    if (!current || current.status !== "running") {
      await tx.update(coverAttempts).set({ outputBase64: null }).where(eq(coverAttempts.requestId, requestId));
      return;
    }
    await assertMembership(tx, actor);
    const largest = variants.at(-1)!;
    const [photo] = await tx.insert(photos).values({ id: randomUUID(), workspaceId: request.workspaceId, recipeId: request.recipeId, purpose: "recipe", status: "ready", origin: "generated", objectKey: largest.objectKey, originalObjectKey, contentType: "image/webp", byteSize: largest.byteSize, width: largest.width, height: largest.height, derivatives: variants.map(({ objectKey, width, height }) => ({ objectKey, width, height })), provenance: { requestId, ...(request.sourcePhotoId ? { sourcePhotoId: request.sourcePhotoId } : {}), model: request.model, promptVersion: request.promptVersion, contentHash: request.contentHash, checksum: createHash("sha256").update(bytes).digest("hex") }, createdByUserId: actor.userId }).returning();
    await tx.update(coverRequests).set({ status: "ready", candidatePhotoId: photo.id, updatedAt: new Date() }).where(eq(coverRequests.id, requestId));
    await tx.update(coverAttempts).set({ outputBase64: null }).where(eq(coverAttempts.requestId, requestId));
    // Deliberately no recipe cover update: a candidate always needs acceptance.
  });
}
export const generateCoverJob = inngest.createFunction({ id: "generate-cover", triggers: { event: "sift/cover.requested" }, retries: 2, concurrency: [{ limit: 2 }, { limit: 1, key: "event.data.requestId" }], onFailure: async ({ event }) => {
  const { requestId } = z.object({ requestId: z.uuid() }).parse(event.data.event.data);
  await database().update(coverRequests).set({ status: "failed", errorMessage: "This image couldn’t be completed. Your original photo is unchanged. Please try again.", updatedAt: new Date() }).where(and(eq(coverRequests.id, requestId), or(eq(coverRequests.status, "queued"), eq(coverRequests.status, "running"))));
} }, async ({ event, step }) => {
  const { requestId } = z.object({ requestId: z.uuid() }).parse(event.data);
  await step.run("generate-and-publish-candidate", async () => {
    try { await produceCover(requestId); } catch { throw new Error("Cover processing failed; provider calls are not repeated."); }
  });
  return { requestId };
});
