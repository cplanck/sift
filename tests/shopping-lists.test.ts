import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import { inArray } from "drizzle-orm";
import { connectDatabase } from "@/db/connection";
import { recipes, users } from "@/db/schema";
import type { ArtifactDetail, RemovedGroceryItem } from "@/domain/artifact";
import { ensurePersonalWorkspace, type Actor } from "@/services/workspaces";
import { createRecipe, getRecipe } from "@/services/recipes";
import { setShoppingListArchived, categorizeGroceryItems, updateGroceryItem, restoreGroceryItems, clearCheckedGroceryItems, addGroceryItems, addShoppingRecipe, createArtifact, deleteArtifact, getArtifact, listArtifacts, removeGroceryItem, removeShoppingRecipe, renameArtifact, setGroceryItemChecked, updateShoppingRecipe } from "@/services/artifacts";
import { testDatabaseUrl } from "./database";

const { db, pool } = connectDatabase(testDatabaseUrl), ids = [randomUUID(), randomUUID()];
let owner: Actor, outsider: Actor;
beforeAll(async () => {
  await db.insert(users).values(ids.map((id) => ({ id, email: `${id}@example.test`, name: "Shopping test" })));
  [owner, outsider] = await Promise.all(ids.map(async (userId) => ({ userId, workspaceId: await ensurePersonalWorkspace(db, userId) })));
});
afterAll(async () => {
  await db.update(recipes).set({ currentVersionId: null }).where(inArray(recipes.workspaceId, [owner.workspaceId, outsider.workspaceId]));
  await db.delete(users).where(inArray(users.id, ids)); await pool.end();
});
const savedRecipe = (actor: Actor, title: string, ingredients: string[]) => createRecipe(db, actor, { content: { title, servings: 4, ingredientSections: [{ items: ingredients.map((text) => ({ text })) }], instructionSections: [{ steps: ["Cook and serve."] }] } });
const items = (list: ArtifactDetail) => { if (list.content.kind !== "grocery") throw new Error("Expected shopping list"); return list.content.groups.flatMap((group) => group.items); };
const add = (list: ArtifactDetail, recipe: Awaited<ReturnType<typeof savedRecipe>>) => addShoppingRecipe(db, owner, list.id, { expectedRevision: list.revision, recipeId: recipe.id, versionId: recipe.version.id });

it("combines recipe ingredients, deduplicates recipe additions, and preserves manual checkoffs through serving edits and removal", async () => {
  const chili = await savedRecipe(owner, "Chili", ["2 onions", "1 tbsp olive oil"]), soup = await savedRecipe(owner, "Soup", ["1 onion", "2 tbsp olive oil"]);
  let list = await createArtifact(db, owner, { kind: "grocery", title: "This week", groups: [{ name: "", items: [{ text: "Paper towels" }] }] });
  const manual = items(list)[0];
  list = await setGroceryItemChecked(db, owner, list.id, { expectedRevision: list.revision, itemId: manual.id, checked: true });
  list = await add(list, chili); list = await add(list, soup);
  expect(items(list).map((item) => item.text)).toEqual(["Paper towels", "3 onions", "3 tbsp olive oil"]);
  expect(list.content).toMatchObject({ recipes: [{ recipeId: chili.id }, { recipeId: soup.id }] });
  const same = await add(list, soup); expect(same.content).toEqual(list.content); list = same;
  list = await updateShoppingRecipe(db, owner, list.id, { expectedRevision: list.revision, recipeId: soup.id, servings: 8 });
  expect(items(list).map((item) => item.text)).toEqual(["Paper towels", "4 onions", "5 tbsp olive oil"]);
  list = await removeShoppingRecipe(db, owner, list.id, { expectedRevision: list.revision, recipeId: chili.id });
  expect(items(list).map((item) => item.text)).toEqual(["Paper towels", "2 onion", "4 tbsp olive oil"]);
  expect(items(list)[0]).toMatchObject({ id: manual.id, checked: true });
  expect((await getArtifact(db, owner, list.id)).content).toEqual(list.content);
  expect((await listArtifacts(db, owner, { kind: "grocery", query: "This week" }))[0].recipeIds).toEqual([soup.id]);
  expect((await getRecipe(db, owner, soup.id)).version.content.servings).toBe(4);
});
it("keeps removed ingredients removed when another recipe changes", async () => {
  const recipe = await savedRecipe(owner, "Noodles", ["2 onions", "1 cup noodles"]);
  let list = await add(await createArtifact(db, owner, { kind: "grocery", title: "Skip onions" }), recipe);
  list = await removeGroceryItem(db, owner, list.id, { expectedRevision: list.revision, itemId: items(list)[0].id });
  list = await updateShoppingRecipe(db, owner, list.id, { expectedRevision: list.revision, recipeId: recipe.id, servings: 8 });
  expect(items(list).map((item) => item.text)).toEqual(["2 cup noodles"]);
});
it("retains unaffected ingredient IDs/checkmarks and unchecks an increased requirement", async () => {
  const recipe = await savedRecipe(owner, "Dinner", ["1 onion", "1 cup rice"]);
  let list = await add(await createArtifact(db, owner, { kind: "grocery", title: "Checked list" }), recipe);
  const onion = items(list)[0];
  list = await setGroceryItemChecked(db, owner, list.id, { expectedRevision: list.revision, itemId: onion.id, checked: true });
  const another = await savedRecipe(owner, "Dessert", ["2 apples"]); list = await add(list, another);
  expect(items(list).find((item) => item.id === onion.id)?.checked).toBe(true);
  list = await updateShoppingRecipe(db, owner, list.id, { expectedRevision: list.revision, recipeId: recipe.id, servings: 8 });
  expect(items(list).find((item) => item.id === onion.id)).toMatchObject({ checked: false, text: "2 onion" });
});
it("scopes mutations and recipe references to the workspace and rejects stale concurrent edits", async () => {
  const recipe = await savedRecipe(owner, "Own dish", ["2 eggs"]), foreign = await savedRecipe(outsider, "Private dish", ["Secret ingredient"]);
  const list = await createArtifact(db, owner, { kind: "grocery", title: "Private list" });
  await expect(addShoppingRecipe(db, outsider, list.id, { expectedRevision: list.revision, recipeId: foreign.id, versionId: foreign.version.id })).rejects.toMatchObject({ code: "NOT_FOUND" });
  await expect(add(list, foreign)).rejects.toMatchObject({ code: "NOT_FOUND" });
  const results = await Promise.allSettled([add(list, recipe), add(list, recipe)]);
  expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
  expect(results.find((result) => result.status === "rejected")).toMatchObject({ reason: { code: "CONFLICT" } });
  expect(items(await getArtifact(db, owner, list.id))).toHaveLength(1);
});
it("renames and deletes only the chosen list, retaining cookbook recipes and other lists", async () => {
  const recipe = await savedRecipe(owner, "Still here", ["2 eggs"]);
  const first = await add(await createArtifact(db, owner, { kind: "grocery", title: "Old week" }), recipe);
  const next = await createArtifact(db, owner, { kind: "grocery", title: "Next week" });
  const renamed = await renameArtifact(db, owner, first.id, { expectedRevision: first.revision, title: "Finished week" });
  await expect(deleteArtifact(db, owner, first.id, { expectedRevision: first.revision })).rejects.toMatchObject({ code: "CONFLICT" });
  await deleteArtifact(db, owner, renamed.id, { expectedRevision: renamed.revision });
  await expect(getArtifact(db, owner, first.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
  expect((await getArtifact(db, owner, next.id)).title).toBe("Next week");
  expect((await getRecipe(db, owner, recipe.id)).version.content.title).toBe("Still here");
});
it("does not merge a manually added amount into recipe contributions", async () => {
  const recipe = await savedRecipe(owner, "Onion dinner", ["2 onions"]);
  let list = await add(await createArtifact(db, owner, { kind: "grocery", title: "Extra onions" }), recipe);
  list = await addGroceryItems(db, owner, list.id, { expectedRevision: list.revision, groupName: "", items: [{ text: "1 onion" }] });
  list = await removeShoppingRecipe(db, owner, list.id, { expectedRevision: list.revision, recipeId: recipe.id });
  expect(items(list).map((item) => item.text)).toEqual(["1 onion"]);
});

const removedItems = (list: ArtifactDetail, itemIds: string[]): RemovedGroceryItem[] => list.content.kind === "grocery" ? list.content.groups.flatMap((group, groupIndex) => group.items.flatMap((item, index) => itemIds.includes(item.id) ? [{ groupId: group.id, groupName: group.name, groupIndex, index, item }] : [])) : [];
it("undo restores checked items, positions and recipe provenance without losing later manual additions", async () => {
  const recipe = await savedRecipe(owner, "Undo dinner", ["2 onions", "1 cup rice"]);
  let list = await add(await createArtifact(db, owner, { kind: "grocery", title: "Undo list" }), recipe);
  list = await setGroceryItemChecked(db, owner, list.id, { expectedRevision: list.revision, itemId: items(list)[0].id, checked: true });
  const before = items(list), removed = removedItems(list, [before[0].id]);
  list = await clearCheckedGroceryItems(db, owner, list.id, { expectedRevision: list.revision, itemIds: [before[0].id] });
  expect(items(list)).toEqual([before[1]]);
  list = await addGroceryItems(db, owner, list.id, { expectedRevision: list.revision, groupName: "", items: [{ text: "Paper towels" }] });
  list = await restoreGroceryItems(db, owner, list.id, { expectedRevision: list.revision, items: removed });
  expect(items(list).slice(0, 2)).toEqual(before);
  expect(items(list)[2].text).toBe("Paper towels");
  await expect(restoreGroceryItems(db, owner, list.id, { expectedRevision: list.revision, items: removed })).rejects.toMatchObject({ code: "CONFLICT" });
});
it("clears only the selected checked items and can undo a removed final group", async () => {
  let list = await createArtifact(db, owner, { kind: "grocery", title: "Selective clear", groups: [{ name: "Produce", items: [{ text: "Apples" }] }, { name: "Other", items: [{ text: "Soap" }] }] });
  for (const item of items(list)) list = await setGroceryItemChecked(db, owner, list.id, { expectedRevision: list.revision, itemId: item.id, checked: true });
  const before = structuredClone(list.content), selected = [items(list)[0].id], removed = removedItems(list, selected);
  list = await clearCheckedGroceryItems(db, owner, list.id, { expectedRevision: list.revision, itemIds: selected });
  expect(items(list).map((item) => item.text)).toEqual(["Soap"]);
  list = await restoreGroceryItems(db, owner, list.id, { expectedRevision: list.revision, items: removed });
  expect(list.content).toEqual(before);
});
it("scopes undo to the workspace and rejects stale revisions or changed recipe servings", async () => {
  const recipe = await savedRecipe(owner, "Undo scoped", ["2 onions", "1 cup rice"]);
  let list = await add(await createArtifact(db, owner, { kind: "grocery", title: "Undo scoped" }), recipe);
  const removed = removedItems(list, [items(list)[0].id]), stale = list.revision;
  list = await removeGroceryItem(db, owner, list.id, { expectedRevision: list.revision, itemId: removed[0].item.id });
  await expect(restoreGroceryItems(db, outsider, list.id, { expectedRevision: list.revision, items: removed })).rejects.toMatchObject({ code: "NOT_FOUND" });
  await expect(restoreGroceryItems(db, owner, list.id, { expectedRevision: stale, items: removed })).rejects.toMatchObject({ code: "CONFLICT" });
  list = await updateShoppingRecipe(db, owner, list.id, { expectedRevision: list.revision, recipeId: recipe.id, servings: 8 });
  await expect(restoreGroceryItems(db, owner, list.id, { expectedRevision: list.revision, items: removed })).rejects.toMatchObject({ code: "CONFLICT" });
});

it("edits optional categories without changing provenance and preserves categories through merging, scaling, removal and undo", async () => {
  const soup = await savedRecipe(owner, "Category soup", ["1 onion", "1 cup rice"]), chili = await savedRecipe(owner, "Category chili", ["2 onions"]);
  let list = await add(await createArtifact(db, owner, { kind: "grocery", title: "Categorized" }), soup);
  const original = items(list)[0];
  list = await categorizeGroceryItems(db, owner, list.id, { expectedRevision: list.revision, items: [{ itemId: original.id, category: "Produce" }, { itemId: items(list)[1].id, category: "Pantry" }] });
  expect(items(list)[0]).toEqual({ ...original, category: "Produce" });
  list = await add(list, chili);
  expect(items(list)[0]).toMatchObject({ text: "3 onions", category: "Produce" });
  list = await updateShoppingRecipe(db, owner, list.id, { expectedRevision: list.revision, recipeId: soup.id, servings: 8 });
  expect(items(list)[0]).toMatchObject({ text: "4 onion", category: "Produce" });
  list = await removeShoppingRecipe(db, owner, list.id, { expectedRevision: list.revision, recipeId: chili.id });
  expect(items(list)[0]).toMatchObject({ text: "2 onion", category: "Produce" });
  const removed = removedItems(list, [items(list)[0].id]);
  list = await removeGroceryItem(db, owner, list.id, { expectedRevision: list.revision, itemId: removed[0].item.id });
  list = await restoreGroceryItems(db, owner, list.id, { expectedRevision: list.revision, items: removed });
  expect(items(list)[0]).toEqual(removed[0].item);
  const sourced = items(list)[0];
  list = await updateGroceryItem(db, owner, list.id, { expectedRevision: list.revision, itemId: sourced.id, category: null });
  expect(items(list)[0]).toEqual({ ...sourced, category: null });
  list = await updateGroceryItem(db, owner, list.id, { expectedRevision: list.revision, itemId: sourced.id, text: "3 shallots", category: "Produce" });
  expect(items(list)[0]).toMatchObject({ text: "3 shallots", category: "Produce" });
  expect(items(list)[0].source).toBeUndefined();
});
it("validates category batches atomically and scopes them to a workspace", async () => {
  const list = await createArtifact(db, owner, { kind: "grocery", title: "Categories", groups: [{ name: "", items: [{ text: "Milk", category: "Dairy" }] }] });
  const item = items(list)[0];
  const edit = { expectedRevision: list.revision, items: [{ itemId: item.id, category: "Cold" }] };
  await expect(categorizeGroceryItems(db, outsider, list.id, edit)).rejects.toMatchObject({ code: "NOT_FOUND" });
  await expect(categorizeGroceryItems(db, owner, list.id, { ...edit, items: [...edit.items, { itemId: randomUUID(), category: "Other" }] })).rejects.toMatchObject({ code: "NOT_FOUND" });
  expect(items(await getArtifact(db, owner, list.id))[0].category).toBe("Dairy");
  await categorizeGroceryItems(db, owner, list.id, edit);
  await expect(categorizeGroceryItems(db, owner, list.id, edit)).rejects.toMatchObject({ code: "CONFLICT" });
});

it("archives and restores lists without losing items, categories, recipes or checkmarks", async () => {
  const recipe = await savedRecipe(owner, "Archive dinner", ["2 carrots"]);
  let list = await add(await createArtifact(db, owner, { kind: "grocery", title: "Archive week" }), recipe);
  list = await categorizeGroceryItems(db, owner, list.id, { expectedRevision: list.revision, items: [{ itemId: items(list)[0].id, category: "Produce" }] });
  list = await setGroceryItemChecked(db, owner, list.id, { expectedRevision: list.revision, itemId: items(list)[0].id, checked: true });
  const before = list.content, revision = list.revision;
  await expect(setShoppingListArchived(db, outsider, list.id, { expectedRevision: revision, archived: true })).rejects.toMatchObject({ code: "NOT_FOUND" });
  list = await setShoppingListArchived(db, owner, list.id, { expectedRevision: revision, archived: true });
  expect(list.archivedAt).toEqual(expect.any(String));
  expect(list.content).toEqual({ ...before, archivedAt: list.archivedAt });
  expect((await listArtifacts(db, owner)).some((entry) => entry.id === list.id)).toBe(false);
  expect((await listArtifacts(db, owner, { includeArchived: true })).find((entry) => entry.id === list.id)?.archivedAt).toBe(list.archivedAt);
  await expect(setShoppingListArchived(db, owner, list.id, { expectedRevision: revision, archived: false })).rejects.toMatchObject({ code: "CONFLICT" });
  await expect(addGroceryItems(db, owner, list.id, { expectedRevision: list.revision, groupName: "", items: [{ text: "Soap" }] })).rejects.toMatchObject({ code: "CONFLICT" });
  await expect(add(list, recipe)).rejects.toMatchObject({ code: "CONFLICT" });
  await expect(setGroceryItemChecked(db, owner, list.id, { expectedRevision: list.revision, itemId: items(list)[0].id, checked: false })).rejects.toMatchObject({ code: "CONFLICT" });
  list = await setShoppingListArchived(db, owner, list.id, { expectedRevision: list.revision, archived: false });
  expect(list.content).toEqual({ ...before, archivedAt: null });
  expect((await listArtifacts(db, owner)).some((entry) => entry.id === list.id)).toBe(true);
});
