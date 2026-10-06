import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { connectDatabase } from "@/db/connection";
import { recipes, recipeStockPhotos, users } from "@/db/schema";
import { getRecipeStockPhoto } from "@/services/recipe-stock-photos";
import { createRecipe, getRecipe, listRecipes, restoreVersion, updateRecipe } from "@/services/recipes";
import { ensurePersonalWorkspace, type Actor } from "@/services/workspaces";
import { testDatabaseUrl } from "./database";

const { db, pool } = connectDatabase(testDatabaseUrl);
let actor: Actor, other: Actor;
const content = { title: "Lemon Chicken", ingredientSections: [{ name: "", items: [{ text: "1 lemon" }] }], instructionSections: [{ name: "", steps: ["Cook and serve."] }], tags: [] };
function result(id: number) {
  return Response.json({ results: [{ alt_description: "A plate of lemon chicken", urls: { regular: `https://images.unsplash.com/photo-${id}?ixid=keep-this` }, links: { html: `https://unsplash.com/photos/chicken-${id}` }, user: { name: "Photographer", links: { html: "https://unsplash.com/@cook" } } }] });
}
beforeAll(async () => {
  const ids = [randomUUID(), randomUUID()];
  await db.insert(users).values(ids.map((id) => ({ id, email: `${id}@example.test`, name: "Cook" })));
  actor = { userId: ids[0], workspaceId: await ensurePersonalWorkspace(db, ids[0]) };
  other = { userId: ids[1], workspaceId: await ensurePersonalWorkspace(db, ids[1]) };
});
beforeEach(() => { vi.stubEnv("UNSPLASH_ACCESS_KEY", "test-only-key"); vi.stubEnv("PEXELS_API_KEY", ""); });
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
afterAll(async () => {
  await db.update(recipes).set({ currentVersionId: null }).where(inArray(recipes.workspaceId, [actor.workspaceId, other.workspaceId]));
  await db.delete(users).where(inArray(users.id, [actor.userId, other.userId]));
  await pool.end();
});

it("pins the first provider photo across title edits, restores, and fresh database connections", async () => {
  const recipe = await createRecipe(db, actor, { content });
  const before = await getRecipe(db, actor, recipe.id);
  const fetcher = vi.fn().mockImplementation(() => result(1)); vi.stubGlobal("fetch", fetcher);
  const photo = await getRecipeStockPhoto(db, actor, recipe.id);
  expect(photo?.src).toBe("https://images.unsplash.com/photo-1?ixid=keep-this");
  expect((await getRecipe(db, actor, recipe.id)).updatedAt).toEqual(before.updatedAt);
  fetcher.mockImplementation(() => result(2));
  const v2 = await updateRecipe(db, actor, recipe.id, { content: { ...content, title: "Completely different dish", tags: ["Baking"] }, expectedVersionId: recipe.version.id, changeSummary: "Rename" });
  expect(await getRecipeStockPhoto(db, actor, recipe.id)).toEqual(photo);
  await restoreVersion(db, actor, recipe.id, { versionId: recipe.version.id, expectedVersionId: v2.id });
  const fresh = connectDatabase(testDatabaseUrl);
  try {
    vi.stubEnv("UNSPLASH_ACCESS_KEY", "");
    expect(await getRecipeStockPhoto(fresh.db, actor, recipe.id)).toEqual(photo);
    expect((await getRecipe(fresh.db, actor, recipe.id)).stockPhoto).toEqual(photo);
    expect((await listRecipes(fresh.db, actor)).find((r) => r.id === recipe.id)?.stockPhoto).toEqual(photo);
  } finally { await fresh.pool.end(); }
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it("does not pin an outage fallback and saves the first later success", async () => {
  const recipe = await createRecipe(db, actor, { content });
  const fetcher = vi.fn().mockResolvedValue(new Response(null, { status: 503 })); vi.stubGlobal("fetch", fetcher);
  expect((await getRecipeStockPhoto(db, actor, recipe.id))?.src).toMatch(/^\/stock\//);
  expect(await db.select().from(recipeStockPhotos).where(eq(recipeStockPhotos.recipeId, recipe.id))).toHaveLength(0);
  fetcher.mockImplementation(() => result(3));
  expect((await getRecipeStockPhoto(db, actor, recipe.id))?.src).toContain("photo-3");
  expect(await db.select().from(recipeStockPhotos).where(eq(recipeStockPhotos.recipeId, recipe.id))).toHaveLength(1);
});

it("returns one stored winner for simultaneous selections", async () => {
  const recipe = await createRecipe(db, actor, { content });
  let release!: () => void;
  const bothSearching = new Promise<void>((resolve) => { release = resolve; });
  let calls = 0;
  vi.stubGlobal("fetch", vi.fn(async () => {
    const id = ++calls;
    if (calls === 2) release();
    await bothSearching;
    return result(id);
  }));
  const [a, b] = await Promise.all([getRecipeStockPhoto(db, actor, recipe.id), getRecipeStockPhoto(db, actor, recipe.id)]);
  expect(a).toEqual(b);
  expect(a).not.toBeNull();
  expect(await db.select().from(recipeStockPhotos).where(eq(recipeStockPhotos.recipeId, recipe.id))).toHaveLength(1);
});

it("checks ownership, gives uploaded covers priority, and retains the saved stock selection", async () => {
  const recipe = await createRecipe(db, actor, { content });
  const fetcher = vi.fn().mockImplementation(() => result(4)); vi.stubGlobal("fetch", fetcher);
  await expect(getRecipeStockPhoto(db, other, recipe.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
  expect(fetcher).not.toHaveBeenCalled();
  const saved = await getRecipeStockPhoto(db, actor, recipe.id);
  await db.update(recipes).set({ coverPhotoId: randomUUID() }).where(eq(recipes.id, recipe.id));
  expect(await getRecipeStockPhoto(db, actor, recipe.id)).toBeNull();
  await db.update(recipes).set({ coverPhotoId: null }).where(eq(recipes.id, recipe.id));
  expect(await getRecipeStockPhoto(db, actor, recipe.id)).toEqual(saved);
  expect(fetcher).toHaveBeenCalledTimes(1);
});
