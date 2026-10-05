import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { connectDatabase } from "@/db/connection";
import { recipes, recipeVersions, users } from "@/db/schema";
import { ensurePersonalWorkspace, type Actor } from "@/services/workspaces";
import { addRecipeNote, createRecipe, getRecipe, listRecipeNotes, listRecipes, listVersions, restoreVersion, setFavorite, setRecipeStatus, updateRecipe } from "@/services/recipes";
import { testDatabaseUrl } from "./database";

const { db, pool } = connectDatabase(testDatabaseUrl);
let actorA: Actor, actorB: Actor;
const content = { title: "Turkey Chili", description: "A weeknight keeper", servings: 4, ingredientSections: [{ name: "Chili", items: [{ text: "1 14-oz can beans" }, { text: "½ tsp salt" }] }], instructionSections: [{ name: "", steps: ["Simmer gently."] }], tags: ["Weeknight"] };

beforeAll(async () => {
  const ids = [randomUUID(), randomUUID()];
  await db.insert(users).values(ids.map((id) => ({ id, email: `${id}@example.test`, name: "Cook" })));
  actorA = { userId: ids[0], workspaceId: await ensurePersonalWorkspace(db, ids[0]) };
  actorB = { userId: ids[1], workspaceId: await ensurePersonalWorkspace(db, ids[1]) };
});
afterAll(async () => {
  // Clear current pointers before cascading test fixture cleanup through versions.
  await db.update(recipes).set({ currentVersionId: null }).where(inArray(recipes.workspaceId, [actorA.workspaceId, actorB.workspaceId]));
  await db.delete(users).where(inArray(users.id, [actorA.userId, actorB.userId])); await pool.end();
});

describe("workspace-scoped recipe services", () => {
  it("creates a canonical version and preserves rich ingredient text", async () => {
    const recipe = await createRecipe(db, actorA, { content });
    const stored = await getRecipe(db, actorA, recipe.id);
    expect(stored.version.content.ingredientSections[0].items[0].text).toBe("1 14-oz can beans");
    expect(stored.version.number).toBe(1);
    expect(stored.currentVersionId).toBe(stored.version.id);
  });

  it("appends immutable versions, rejects stale writes, restores as a new version", async () => {
    const recipe = await createRecipe(db, actorA, { content });
    const v2 = await updateRecipe(db, actorA, recipe.id, { content: { ...content, title: "Smoky Turkey Chili" }, expectedVersionId: recipe.version.id, changeSummary: "Add smoke" });
    await expect(updateRecipe(db, actorA, recipe.id, { content, expectedVersionId: recipe.version.id, changeSummary: "Stale edit" })).rejects.toMatchObject({ code: "CONFLICT" });
    const restored = await restoreVersion(db, actorA, recipe.id, { versionId: recipe.version.id, expectedVersionId: v2.id });
    expect(restored.number).toBe(3);
    expect(restored.content.title).toBe("Turkey Chili");
    const versions = await listVersions(db, actorA, recipe.id);
    expect(versions.map((v) => v.content.title)).toEqual(["Turkey Chili", "Smoky Turkey Chili", "Turkey Chili"]);
  });

  it("serializes racing writes without duplicate version numbers", async () => {
    const recipe = await createRecipe(db, actorA, { content });
    const outcomes = await Promise.allSettled(["A", "B"].map((title) => updateRecipe(db, actorA, recipe.id, { content: { ...content, title }, expectedVersionId: recipe.version.id, changeSummary: title })));
    expect(outcomes.filter((o) => o.status === "fulfilled")).toHaveLength(1);
    expect(await listVersions(db, actorA, recipe.id)).toHaveLength(2);
  });

  it("notes and favorites do not mutate canonical versions", async () => {
    const recipe = await createRecipe(db, actorA, { content });
    await addRecipeNote(db, actorA, recipe.id, { body: "This needed more salt" });
    await setFavorite(db, actorA, recipe.id, true);
    await setFavorite(db, actorA, recipe.id, true);
    expect((await getRecipe(db, actorA, recipe.id)).favorite).toBe(true);
    expect(await listVersions(db, actorA, recipe.id)).toHaveLength(1);
    expect(await listRecipeNotes(db, actorA, recipe.id)).toHaveLength(1);
    expect((await listRecipes(db, actorA, "needed more salt")).some((r) => r.id === recipe.id)).toBe(true);
  });

  it("prevents all reads and writes across workspaces, even with valid guessed IDs", async () => {
    const recipe = await createRecipe(db, actorB, { content });
    const operations = [
      () => getRecipe(db, actorA, recipe.id), () => listRecipeNotes(db, actorA, recipe.id),
      () => listVersions(db, actorA, recipe.id), () => setFavorite(db, actorA, recipe.id, true),
      () => addRecipeNote(db, actorA, recipe.id, { body: "Injected note" }),
      () => setRecipeStatus(db, actorA, recipe.id, "archived"),
      () => updateRecipe(db, actorA, recipe.id, { content, expectedVersionId: recipe.version.id, changeSummary: "Intrusion" }),
      () => restoreVersion(db, actorA, recipe.id, { versionId: recipe.version.id, expectedVersionId: recipe.version.id }),
      () => getRecipe(db, { ...actorA, workspaceId: actorB.workspaceId }, recipe.id),
    ];
    for (const operation of operations) await expect(operation()).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await listRecipes(db, actorA)).some((r) => r.id === recipe.id)).toBe(false);
    expect((await db.select().from(recipeVersions).where(eq(recipeVersions.recipeId, recipe.id)))).toHaveLength(1);
  });
});
