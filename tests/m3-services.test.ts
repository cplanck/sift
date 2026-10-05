import { createHash, randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import { connectDatabase } from "@/db/connection";
import { photos, recipeImports, recipes, recipeShares, usageLimits, users, workspaceMembers } from "@/db/schema";
import { parsePastedRecipe } from "@/domain/import";
import { createImport, approveImport, getImport, importForJob, importReview, listPendingImports, markImportFailed, markImportProcessing, saveExtractedImport } from "@/services/imports";
import { addRecipeNote, createRecipe, getRecipe, listVersions, setRecipeStatus, updateRecipe } from "@/services/recipes";
import { createRecipeShare, listRecipeShares, readSharedPhoto, readSharedRecipe, revokeRecipeShare } from "@/services/shares";
import { consumeLimit } from "@/services/rate-limit";
import { ensurePersonalWorkspace, type Actor } from "@/services/workspaces";
import { testDatabaseUrl } from "./database";

const { db, pool } = connectDatabase(testDatabaseUrl);
const actorIds = [randomUUID(), randomUUID(), randomUUID()];
let actorA: Actor, actorB: Actor, revoked: Actor;
const pasted = "Turkey Chili\nServes: 4\nIngredients\n½ cup broth\n1 14-oz can beans\n2–3 tbsp oil\nInstructions\nSimmer gently.\nTaste and serve.";
const content = parsePastedRecipe(pasted)!;
const source = { type: "paste" as const, rawText: pasted };

beforeAll(async () => {
  await db.insert(users).values(actorIds.map((id) => ({ id, email: `${id}@example.test`, name: "Import test cook" })));
  const actors = await Promise.all(actorIds.map(async (userId) => ({ userId, workspaceId: await ensurePersonalWorkspace(db, userId) })));
  [actorA, actorB, revoked] = actors;
});
afterAll(async () => {
  vi.unstubAllEnvs();
  await db.update(recipes).set({ currentVersionId: null }).where(inArray(recipes.workspaceId, [actorA.workspaceId, actorB.workspaceId, revoked.workspaceId]));
  await db.delete(users).where(inArray(users.id, actorIds));
  await pool.end();
});

describe("durable import review with real PostgreSQL", () => {
  it("keeps pasted imports as drafts, preserves provenance, and appends approved corrections", async () => {
    const record = await createImport(db, actorA, { kind: "paste", text: pasted });
    const review = await importReview(db, actorA, record.id);
    expect(review.status).toBe("review");
    expect(review.recipe?.status).toBe("draft");
    expect(review.recipe?.source).toMatchObject(source);
    expect((await listPendingImports(db, actorA)).map((item) => item.id)).toContain(record.id);
    const draft = review.recipe!;
    await expect(setRecipeStatus(db, actorA, draft.id, "active")).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(setRecipeStatus(db, actorA, draft.id, "archived")).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(createRecipeShare(db, actorA, draft.id, draft.version.id, null)).rejects.toMatchObject({ code: "INVALID_INPUT" });
    const corrected = { ...draft.version.content, title: "Smoky Turkey Chili", servings: 6 };
    await approveImport(db, actorA, record.id, { content: corrected, expectedVersionId: draft.version.id });
    const approved = await getRecipe(db, actorA, draft.id);
    expect(approved.status).toBe("active");
    expect(approved.version.content).toEqual(corrected);
    expect((await getImport(db, actorA, record.id)).status).toBe("saved");
    expect((await listPendingImports(db, actorA)).map((item) => item.id)).not.toContain(record.id);
    const versions = await listVersions(db, actorA, draft.id);
    expect(versions).toHaveLength(2);
    expect(versions[1].content).toEqual(draft.version.content);
    expect(versions[0].changeSummary).toBe("Reviewed and approved import");
  });

  it("serializes extraction and approval retries without duplicate recipes or versions", async () => {
    const [record] = await db.insert(recipeImports).values({ workspaceId: actorA.workspaceId, createdByUserId: actorA.userId, kind: "paste", rawText: pasted }).returning();
    const ids = await Promise.all(Array.from({ length: 5 }, () => saveExtractedImport(db, actorA, record.id, content, source)));
    expect(new Set(ids).size).toBe(1);
    const recipe = await getRecipe(db, actorA, ids[0]);
    expect(await listVersions(db, actorA, recipe.id)).toHaveLength(1);
    const approvals = await Promise.all(Array.from({ length: 5 }, () => approveImport(db, actorA, record.id, { content: { ...content, title: "Reviewed once" }, expectedVersionId: recipe.version.id })));
    expect(approvals.every((result) => result.recipeId === recipe.id)).toBe(true);
    expect(await listVersions(db, actorA, recipe.id)).toHaveLength(2);
    await expect(approveImport(db, actorA, record.id, { content: { ...content, title: "A different review from a stale tab" }, expectedVersionId: recipe.version.id })).rejects.toMatchObject({ code: "CONFLICT" });
    await markImportProcessing(db, record.id);
    await markImportFailed(db, record.id, "Late retry failure");
    expect((await getImport(db, actorA, record.id)).status).toBe("saved");
    expect(await saveExtractedImport(db, actorA, record.id, { ...content, title: "Late extraction" }, source)).toBe(recipe.id);
    expect((await getRecipe(db, actorA, recipe.id)).version.content.title).toBe("Reviewed once");
  });

  it("rolls back approval on stale versions and keeps the draft available for review", async () => {
    const record = await createImport(db, actorA, { kind: "paste", text: pasted });
    const draft = (await importReview(db, actorA, record.id)).recipe!;
    await updateRecipe(db, actorA, draft.id, { content: { ...content, title: "Concurrent correction" }, expectedVersionId: draft.version.id, changeSummary: "Correct title" });
    await expect(approveImport(db, actorA, record.id, { content, expectedVersionId: draft.version.id })).rejects.toMatchObject({ code: "CONFLICT" });
    expect((await getImport(db, actorA, record.id)).status).toBe("review");
    expect((await getRecipe(db, actorA, draft.id)).status).toBe("draft");
    expect(await listVersions(db, actorA, draft.id)).toHaveLength(2);
  });

  it("rejects cross-workspace import reads, writes, photo guesses, and forged workspace actors", async () => {
    const record = await createImport(db, actorB, { kind: "paste", text: pasted });
    const draft = (await importReview(db, actorB, record.id)).recipe!;
    const [photo] = await db.insert(photos).values({ workspaceId: actorB.workspaceId, createdByUserId: actorB.userId, purpose: "import", status: "ready", objectKey: `test/${randomUUID()}`, contentType: "image/webp", byteSize: 100 }).returning();
    const operations = [
      () => getImport(db, actorA, record.id),
      () => importReview(db, actorA, record.id),
      () => saveExtractedImport(db, actorA, record.id, content, source),
      () => approveImport(db, actorA, record.id, { content, expectedVersionId: draft.version.id }),
      () => createImport(db, actorA, { kind: "image", photoId: photo.id }),
      () => getImport(db, { ...actorA, workspaceId: actorB.workspaceId }, record.id),
      () => createImport(db, { ...actorA, workspaceId: actorB.workspaceId }, { kind: "paste", text: pasted }),
    ];
    for (const operation of operations) await expect(operation()).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await listPendingImports(db, actorA)).map((item) => item.id)).not.toContain(record.id);
    expect((await getRecipe(db, actorB, draft.id)).version.number).toBe(1);
  });

  it("requires real job configuration for unstructured input before creating an import", async () => {
    vi.stubEnv("INNGEST_EVENT_KEY", ""); vi.stubEnv("INNGEST_SIGNING_KEY", ""); vi.stubEnv("INNGEST_DEV", "0");
    try {
      const before = await db.select().from(recipeImports).where(eq(recipeImports.workspaceId, actorA.workspaceId));
      await expect(createImport(db, actorA, { kind: "paste", text: "A long enough passage without a structured recipe to extract." })).rejects.toMatchObject({ name: "ConfigurationError" });
      await expect(createImport(db, actorA, { kind: "url", url: "http://169.254.169.254/recipe" })).rejects.toMatchObject({ code: "INVALID_INPUT" });
      expect(await db.select().from(recipeImports).where(eq(recipeImports.workspaceId, actorA.workspaceId))).toHaveLength(before.length);
    } finally { vi.unstubAllEnvs(); }
  });

  it("keeps older review drafts reachable when many newer imports have failed", async () => {
    const draft = await createImport(db, actorA, { kind: "paste", text: pasted });
    await db.insert(recipeImports).values(Array.from({ length: 21 }, () => ({ workspaceId: actorA.workspaceId, createdByUserId: actorA.userId, kind: "paste" as const, rawText: pasted, status: "failed" as const, createdAt: new Date(Date.now() + 1000), errorMessage: "Provider unavailable" })));
    expect((await listPendingImports(db, actorA)).map((record) => record.id)).toContain(draft.id);
  });

  it("rechecks membership before durable job work and never restores revoked access", async () => {
    const record = await createImport(db, revoked, { kind: "paste", text: pasted });
    const draft = (await importReview(db, revoked, record.id)).recipe!;
    await db.delete(workspaceMembers).where(and(eq(workspaceMembers.workspaceId, revoked.workspaceId), eq(workspaceMembers.userId, revoked.userId)));
    for (const operation of [() => importForJob(db, record.id), () => markImportProcessing(db, record.id), () => markImportFailed(db, record.id, "Stopped"), () => saveExtractedImport(db, revoked, record.id, content, source), () => approveImport(db, revoked, record.id, { content, expectedVersionId: draft.version.id })]) {
      await expect(operation()).rejects.toMatchObject({ code: "NOT_FOUND" });
    }
  });
});

describe("unlisted recipe capabilities with real PostgreSQL", () => {
  it("stores token hashes, exposes one immutable snapshot, excludes private notes/provenance, and revokes access", async () => {
    const privateRaw = "Private raw import source not meant for sharing";
    const recipe = await createRecipe(db, actorA, { content, source: { type: "paste", rawText: privateRaw } });
    const note = await addRecipeNote(db, actorA, recipe.id, { body: "Private family cooking note" });
    const share = await createRecipeShare(db, actorA, recipe.id, recipe.version.id, null);
    expect(share.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const [stored] = await db.select().from(recipeShares).where(eq(recipeShares.id, share.id));
    expect(stored.tokenHash).toBe(createHash("sha256").update(share.token).digest("hex"));
    expect(JSON.stringify(stored)).not.toContain(share.token);
    const listed = await listRecipeShares(db, actorA, recipe.id);
    expect(listed.map((item) => item.id)).toContain(share.id);
    expect(JSON.stringify(listed)).not.toContain(share.token);
    expect(JSON.stringify(listed)).not.toContain(stored.tokenHash);
    await updateRecipe(db, actorA, recipe.id, { content: { ...content, title: "Later private title" }, expectedVersionId: recipe.version.id, changeSummary: "Private edit" });
    await expect(createRecipeShare(db, actorA, recipe.id, recipe.version.id, null)).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await listRecipeShares(db, actorA, recipe.id)).toHaveLength(1);
    const shared = await readSharedRecipe(db, share.token);
    expect(shared.content).toEqual(recipe.version.content);
    expect(JSON.stringify(shared)).not.toContain(note.body);
    expect(JSON.stringify(shared)).not.toContain(privateRaw);
    expect(JSON.stringify(shared)).not.toContain(actorA.userId);
    await expect(readSharedRecipe(db, randomBytes(32).toString("base64url"))).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(readSharedRecipe(db, share.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await revokeRecipeShare(db, actorA, share.id);
    await revokeRecipeShare(db, actorA, share.id);
    await expect(readSharedRecipe(db, share.token)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await listRecipeShares(db, actorA, recipe.id)).toHaveLength(0);
  });

  it("restricts share management and binds anonymous photos to the original recipe cover", async () => {
    const recipe = await createRecipe(db, actorB, { content });
    const [cover, later] = await db.insert(photos).values(["original", "later"].map((name) => ({ workspaceId: actorB.workspaceId, createdByUserId: actorB.userId, recipeId: recipe.id, purpose: "recipe" as const, status: "ready" as const, objectKey: `test/${name}/${randomUUID()}`, contentType: "image/webp", byteSize: 100 }))).returning();
    await db.update(recipes).set({ coverPhotoId: cover.id }).where(eq(recipes.id, recipe.id));
    const share = await createRecipeShare(db, actorB, recipe.id, recipe.version.id, cover.id);
    for (const operation of [() => createRecipeShare(db, actorA, recipe.id, recipe.version.id, cover.id), () => listRecipeShares(db, actorA, recipe.id), () => revokeRecipeShare(db, actorA, share.id), () => revokeRecipeShare(db, { ...actorA, workspaceId: actorB.workspaceId }, share.id)]) {
      await expect(operation()).rejects.toMatchObject({ code: "NOT_FOUND" });
    }
    await db.update(recipes).set({ coverPhotoId: later.id }).where(eq(recipes.id, recipe.id));
    await expect(createRecipeShare(db, actorB, recipe.id, recipe.version.id, cover.id)).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await listRecipeShares(db, actorB, recipe.id)).toHaveLength(1);
    expect((await readSharedPhoto(db, share.token)).id).toBe(cover.id);
    await revokeRecipeShare(db, actorB, share.id);
    await expect(readSharedPhoto(db, share.token)).rejects.toMatchObject({ code: "NOT_FOUND" });
    const noCover = await createRecipe(db, actorA, { content });
    const noCoverShare = await createRecipeShare(db, actorA, noCover.id, noCover.version.id, null);
    await expect(readSharedPhoto(db, noCoverShare.token)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("atomic provider usage limits", () => {
  it("admits exactly the configured number under concurrent requests and isolates users and features", async () => {
    const outcomes = await Promise.allSettled(Array.from({ length: 20 }, () => consumeLimit(db, actorA, "assistant", 5)));
    expect(outcomes.filter((result) => result.status === "fulfilled")).toHaveLength(5);
    const failures = outcomes.filter((result) => result.status === "rejected");
    expect(failures).toHaveLength(15);
    for (const failure of failures) expect(failure.reason).toMatchObject({ code: "RATE_LIMITED" });
    await expect(consumeLimit(db, actorB, "assistant", 5)).resolves.toBeUndefined();
    await expect(consumeLimit(db, actorA, "voice", 5)).resolves.toBeUndefined();
    const before = await db.select().from(usageLimits).where(eq(usageLimits.userId, actorA.userId));
    await expect(consumeLimit(db, { ...actorA, workspaceId: actorB.workspaceId }, "photo", 5)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await db.select().from(usageLimits).where(eq(usageLimits.userId, actorA.userId))).toHaveLength(before.length);
  });
});
