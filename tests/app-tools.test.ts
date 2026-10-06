import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { inArray } from "drizzle-orm";
import { connectDatabase } from "@/db/connection";
import { photos, recipes, users } from "@/db/schema";
import { assistantRequestSchema } from "@/domain/assistant";
import { beginConversationTurn, createConversation, getConversation } from "@/services/conversations";
import { attachChatPhoto } from "@/services/photos";
import { isAppPath, mergeLabels } from "@/ai/recipe-tools";
import { clearCheckedGroceryItems, createArtifact, deleteArtifact, getArtifact, listArtifacts, renameArtifact, setGroceryItemChecked, updateGroceryItem, updateMealPlanEntry } from "@/services/artifacts";
import { listActiveCookingSessions, startCookingSession } from "@/services/cooking";
import { createRecipe, getRecipe } from "@/services/recipes";
import { ensurePersonalWorkspace, type Actor } from "@/services/workspaces";
import { testDatabaseUrl } from "./database";

const { db, pool } = connectDatabase(testDatabaseUrl);
const userIds = [randomUUID(), randomUUID()];
let actorA: Actor, actorB: Actor;
const content = { title: "Leek soup", servings: 4, ingredientSections: [{ name: "", items: [{ text: "3 leeks" }] }], instructionSections: [{ name: "", steps: ["Simmer."] }] };

beforeAll(async () => {
  await db.insert(users).values(userIds.map((id) => ({ id, email: `${id}@example.test`, name: "Tools test cook" })));
  [actorA, actorB] = await Promise.all(userIds.map(async (userId) => ({ userId, workspaceId: await ensurePersonalWorkspace(db, userId) })));
});
afterAll(async () => {
  await db.update(recipes).set({ currentVersionId: null }).where(inArray(recipes.workspaceId, [actorA.workspaceId, actorB.workspaceId]));
  await db.delete(users).where(inArray(users.id, userIds));
  await pool.end();
});

describe("agent list and plan editing", () => {
  it("edits, clears checked items, renames and deletes a grocery list with revision checks", async () => {
    const list = await createArtifact(db, actorA, { kind: "grocery", title: "Market", groups: [{ name: "Produce", items: [{ text: "2 leeks" }, { text: "1 lemon" }] }, { name: "Dairy", items: [{ text: "Butter" }] }] });
    if (list.content.kind !== "grocery") throw new Error("grocery expected");
    const [leeks, lemon] = list.content.groups[0].items, butter = list.content.groups[1].items[0];
    const edited = await updateGroceryItem(db, actorA, list.id, { expectedRevision: list.revision, itemId: leeks.id, text: "4 leeks" });
    await expect(updateGroceryItem(db, actorA, list.id, { expectedRevision: list.revision, itemId: leeks.id, text: "stale" })).rejects.toMatchObject({ code: "CONFLICT" });
    const checkedLemon = await setGroceryItemChecked(db, actorA, list.id, { expectedRevision: edited.revision, itemId: lemon.id, checked: true });
    const checkedButter = await setGroceryItemChecked(db, actorA, list.id, { expectedRevision: checkedLemon.revision, itemId: butter.id, checked: true });
    const cleared = await clearCheckedGroceryItems(db, actorA, list.id, { expectedRevision: checkedButter.revision });
    expect(cleared.removed).toBe(2);
    expect(cleared.content).toEqual({ kind: "grocery", groups: [{ id: list.content.groups[0].id, name: "Produce", items: [{ id: leeks.id, text: "4 leeks", checked: false }] }] });
    const renamed = await renameArtifact(db, actorA, list.id, { expectedRevision: cleared.revision, title: "Saturday market" });
    expect(renamed).toMatchObject({ title: "Saturday market", revision: cleared.revision + 1 });
    await expect(deleteArtifact(db, actorB, list.id, { expectedRevision: renamed.revision })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(deleteArtifact(db, actorA, list.id, { expectedRevision: cleared.revision })).rejects.toMatchObject({ code: "CONFLICT" });
    await deleteArtifact(db, actorA, list.id, { expectedRevision: renamed.revision });
    await expect(getArtifact(db, actorA, list.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await listArtifacts(db, actorA)).some((item) => item.id === list.id)).toBe(false);
  });

  it("reschedules one meal and changes only the supplied fields", async () => {
    const plan = await createArtifact(db, actorA, { kind: "meal-plan", title: "Week", entries: [{ date: "2026-10-06", meal: "Dinner", title: "Tacos", note: "Use leftovers" }, { meal: "Lunch", title: "Salad" }] });
    if (plan.content.kind !== "meal-plan") throw new Error("plan expected");
    const [tacos, salad] = plan.content.entries;
    const moved = await updateMealPlanEntry(db, actorA, plan.id, { expectedRevision: plan.revision, entryId: tacos.id, date: "2026-10-08", servings: 6 });
    if (moved.content.kind !== "meal-plan") throw new Error("plan expected");
    expect(moved.content.entries[0]).toEqual({ ...tacos, date: "2026-10-08", servings: 6 });
    expect(moved.content.entries[1]).toEqual(salad);
    const unscheduled = await updateMealPlanEntry(db, actorA, plan.id, { expectedRevision: moved.revision, entryId: tacos.id, date: null });
    if (unscheduled.content.kind !== "meal-plan") throw new Error("plan expected");
    expect(unscheduled.content.entries[0].date).toBeNull();
    await expect(updateMealPlanEntry(db, actorA, plan.id, { expectedRevision: unscheduled.revision, entryId: randomUUID(), meal: "Brunch" })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("lists only this user's active cooks across recipes", async () => {
    const recipe = await createRecipe(db, actorA, { content, source: { type: "manual" }, status: "active" });
    const session = await startCookingSession(db, actorA, { recipeId: recipe.id, expectedVersionId: recipe.version.id });
    expect(await listActiveCookingSessions(db, actorA)).toEqual([expect.objectContaining({ sessionId: session.id, recipeId: recipe.id, title: "Leek soup" })]);
    expect(await listActiveCookingSessions(db, actorB)).toEqual([]);
  });
});

describe("agent tool guards", () => {
  it("opens only Sift's own pages", () => {
    const id = randomUUID(), cook = randomUUID();
    for (const path of ["/", "/library", "/recipes/new", `/recipes/${id}`, `/recipes/${id}?cook=${cook}`, `/artifacts/${id}`, `/imports/${id}`]) expect(isAppPath(path)).toBe(true);
    for (const path of ["https://evil.example", "//evil.example", "/api/me", `/recipes/${id}?cook=x`, "/library/../api", "javascript:alert(1)", `/recipes/${id}#x`, "/settings"]) expect(isAppPath(path)).toBe(false);
  });

  it("merges labels case-insensitively without duplicates", () => {
    expect(mergeLabels(["Soup", "Winter"], ["soup", "Quick"], ["WINTER"])).toEqual(["Soup", "Quick"]);
    expect(mergeLabels(Array.from({ length: 30 }, (_, i) => `t${i}`), ["extra"], [])).toHaveLength(30);
  });
});

describe("chat photos", () => {
  async function photo(actor: Actor, overrides: Partial<typeof photos.$inferInsert> = {}) {
    const id = randomUUID();
    await db.insert(photos).values({ id, workspaceId: actor.workspaceId, purpose: "chat", status: "ready", objectKey: `test/${id}.webp`, contentType: "image/webp", byteSize: 10, createdByUserId: actor.userId, ...overrides });
    return id;
  }

  it("saves photo messages by reference and accepts photos without text", async () => {
    const conversation = await createConversation(db, actorA, {});
    const first = await photo(actorA), second = await photo(actorA);
    const run = await beginConversationTurn(db, actorA, { conversationId: conversation.id, requestId: randomUUID(), context: { route: "/library" }, message: { id: randomUUID(), photoIds: [first, second] } });
    expect(run.messages.at(-1)?.parts).toEqual([{ type: "file", mediaType: "image/webp", url: `/api/photos/${first}` }, { type: "file", mediaType: "image/webp", url: `/api/photos/${second}` }]);
    expect((await getConversation(db, actorA, conversation.id)).title).toBe("Photo");
  });

  it("rejects photos that aren't the sender's finished uploads", async () => {
    const conversation = await createConversation(db, actorA, {});
    const send = (photoId: string) => beginConversationTurn(db, actorA, { conversationId: conversation.id, requestId: randomUUID(), context: { route: "/library" }, message: { id: randomUUID(), text: "Look", photoIds: [photoId] } });
    await expect(send(await photo(actorB))).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(send(await photo(actorA, { status: "pending" }))).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(send(await photo(actorA, { purpose: "import" }))).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(() => assistantRequestSchema.parse({ conversationId: randomUUID(), requestId: randomUUID(), context: { route: "/" }, message: { id: randomUUID() } })).toThrow();
  });

  it("moves a chat photo onto a recipe (as cover when it has none) or the user's cook", async () => {
    const recipe = await createRecipe(db, actorA, { content: { ...content, title: "Photo soup" }, source: { type: "manual" }, status: "active" });
    const dish = await photo(actorA);
    expect(await attachChatPhoto(db, actorA, dish, { recipeId: recipe.id })).toMatchObject({ recipeId: recipe.id, cover: true });
    expect((await getRecipe(db, actorA, recipe.id)).coverPhotoId).toBe(dish);
    await expect(attachChatPhoto(db, actorA, dish, { recipeId: recipe.id })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    const second = await photo(actorA);
    expect(await attachChatPhoto(db, actorA, second, { recipeId: recipe.id })).toMatchObject({ cover: false });
    const session = await startCookingSession(db, actorA, { recipeId: recipe.id, expectedVersionId: recipe.version.id });
    const cookPhoto = await photo(actorA);
    expect(await attachChatPhoto(db, actorA, cookPhoto, { sessionId: session.id })).toMatchObject({ sessionId: session.id, recipeId: recipe.id });
    await expect(attachChatPhoto(db, actorB, await photo(actorA), { recipeId: recipe.id })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
