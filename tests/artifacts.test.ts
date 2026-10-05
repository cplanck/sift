import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import { connectDatabase } from "@/db/connection";
import { recipes, users, workspaceMembers } from "@/db/schema";
import { artifactToText } from "@/domain/artifact";
import {
  addGroceryItems, addMealPlanEntry, createArtifact, deriveGroceryList, getArtifact,
  listArtifacts, removeGroceryItem, removeMealPlanEntry, setGroceryItemChecked,
} from "@/services/artifacts";
import { createRecipe, getRecipe, listVersions, updateRecipe } from "@/services/recipes";
import { ensurePersonalWorkspace, type Actor } from "@/services/workspaces";
import { testDatabaseUrl } from "./database";

const { db, pool } = connectDatabase(testDatabaseUrl);
const userIds = [randomUUID(), randomUUID(), randomUUID()];
let actorA: Actor, actorB: Actor, fellowCook: Actor;
const content = {
  title: "Rice and beans", servings: 4,
  ingredientSections: [{ name: "Dinner", items: [{ text: "2 cups rice" }, { text: "1 14-oz can beans" }, { text: "Salt to taste" }] }],
  instructionSections: [{ name: "", steps: ["Cook the rice and warm the beans."] }],
};

beforeAll(async () => {
  await db.insert(users).values(userIds.map((id) => ({ id, email: `${id}@example.test`, name: "Artifact test cook" })));
  [actorA, actorB] = await Promise.all(userIds.slice(0, 2).map(async (userId) => ({ userId, workspaceId: await ensurePersonalWorkspace(db, userId) })));
  fellowCook = { userId: userIds[2], workspaceId: actorA.workspaceId };
  await db.insert(workspaceMembers).values({ ...fellowCook, role: "member" });
});
afterAll(async () => {
  await db.update(recipes).set({ currentVersionId: null }).where(inArray(recipes.workspaceId, [actorA.workspaceId, actorB.workspaceId]));
  await db.delete(users).where(inArray(users.id, userIds));
  await pool.end();
});

describe("Durable grocery and meal-plan artifacts with PostgreSQL", () => {
  it("reopens grouped grocery checkoffs and item edits with stable identity", async () => {
    const list = await createArtifact(db, actorA, { kind: "grocery", title: "Preserved grocery list", groups: [{ name: "Produce", items: [{ text: "2 lemons" }, { text: "2 lemons" }] }] });
    if (list.content.kind !== "grocery") throw new Error("Expected a grocery list");
    const [first, second] = list.content.groups[0].items;
    expect(first.id).not.toBe(second.id);
    const checked = await setGroceryItemChecked(db, actorA, list.id, { expectedRevision: list.revision, itemId: first.id, checked: true });
    const expanded = await addGroceryItems(db, actorA, list.id, { expectedRevision: checked.revision, groupName: "Produce", items: [{ text: "Fresh parsley" }] });
    const trimmed = await removeGroceryItem(db, actorA, list.id, { expectedRevision: expanded.revision, itemId: second.id });
    const reopened = await getArtifact(db, actorA, list.id);
    expect(reopened).toMatchObject({ id: list.id, title: "Preserved grocery list", kind: "grocery", revision: trimmed.revision });
    if (reopened.content.kind !== "grocery") throw new Error("Expected a grocery list");
    const items = reopened.content.groups.flatMap((group) => group.items);
    expect(items).toHaveLength(2);
    expect(items.find((item) => item.id === first.id)).toMatchObject({ text: "2 lemons", checked: true });
    expect(items.find((item) => item.text === "Fresh parsley")?.checked).toBe(false);
    expect(items.some((item) => item.id === second.id)).toBe(false);
    expect(await listArtifacts(db, actorA, { kind: "grocery", query: "Preserved grocery" })).toEqual([expect.objectContaining({ id: list.id, kind: "grocery" })]);
    expect(artifactToText(reopened)).toContain("[x] 2 lemons");
    expect(artifactToText(reopened)).toContain("[ ] Fresh parsley");
  });

  it("derives quantities from the selected immutable version without changing the recipe", async () => {
    const recipe = await createRecipe(db, actorA, { content });
    const newer = await updateRecipe(db, actorA, recipe.id, { expectedVersionId: recipe.version.id, content: { ...recipe.version.content, title: "Later recipe", ingredientSections: [{ name: "", items: [{ text: "9 cups noodles" }] }] }, changeSummary: "Later recipe revision" });
    const list = await deriveGroceryList(db, actorA, { title: "Original dinner for eight", recipes: [{ recipeId: recipe.id, versionId: recipe.version.id, servings: 8 }] });
    if (list.content.kind !== "grocery") throw new Error("Expected a grocery list");
    const items = list.content.groups.flatMap((group) => group.items);
    expect(items.map((item) => item.text)).toEqual(["4 cups rice", "2 14-oz can beans", "Salt to taste"]);
    expect(items.every((item) => item.source?.recipeId === recipe.id && item.source.versionId === recipe.version.id && item.source.servings === 8)).toBe(true);
    expect((await getRecipe(db, actorA, recipe.id)).version.id).toBe(newer.id);
    expect(await listVersions(db, actorA, recipe.id)).toHaveLength(2);
    const saved = await getArtifact(db, actorA, list.id);
    expect(saved.content).toEqual(list.content);
    expect(artifactToText(saved)).not.toContain("noodles");
  });

  it("pins meal entries to a recipe version while also allowing unscheduled described meals", async () => {
    const recipe = await createRecipe(db, actorA, { content });
    const plan = await createArtifact(db, actorA, { kind: "meal-plan", title: "A small dinner plan", entries: [{ date: "2028-02-29", meal: "Dinner", recipeId: recipe.id, versionId: recipe.version.id, servings: 6 }] });
    const expanded = await addMealPlanEntry(db, actorA, plan.id, { expectedRevision: plan.revision, entry: { meal: "Lunch", title: "Leftovers", note: "Use the remaining rice." } });
    if (expanded.content.kind !== "meal-plan") throw new Error("Expected a meal plan");
    expect(expanded.content.entries[0]).toMatchObject({ date: "2028-02-29", title: "Rice and beans", recipeId: recipe.id, recipeVersionId: recipe.version.id, servings: 6 });
    expect(expanded.content.entries[1]).toMatchObject({ date: null, title: "Leftovers", recipeId: null, recipeVersionId: null, servings: null, note: "Use the remaining rice." });
    await updateRecipe(db, actorA, recipe.id, { expectedVersionId: recipe.version.id, content: { ...recipe.version.content, title: "New canonical title" }, changeSummary: "Rename after planning" });
    const reopened = await getArtifact(db, actorA, plan.id);
    expect(reopened.content).toEqual(expanded.content);
    expect(artifactToText(reopened)).toContain("2028-02-29 · Dinner: Rice and beans (6 servings)");
    const removed = await removeMealPlanEntry(db, actorA, plan.id, { expectedRevision: expanded.revision, entryId: expanded.content.entries[1].id });
    if (removed.content.kind !== "meal-plan") throw new Error("Expected a meal plan");
    expect(removed.content.entries).toHaveLength(1);
    expect(await listVersions(db, actorA, recipe.id)).toHaveLength(2);
  });

  it("preserves maximum-length source text and derived group names without truncation", async () => {
    const title = "T".repeat(160), name = "S".repeat(150), text = `9 ${"a".repeat(998)}`;
    const recipe = await createRecipe(db, actorA, { content: { ...content, title, ingredientSections: [{ name, items: [{ text }] }] } });
    const list = await deriveGroceryList(db, actorA, { title: "Long source wording", recipes: [{ recipeId: recipe.id, versionId: recipe.version.id, servings: 8 }] });
    if (list.content.kind !== "grocery") throw new Error("Expected a grocery list");
    expect(list.content.groups[0].name).toBe(`${title} · ${name}`);
    expect(list.content.groups[0].items[0].text).toBe(`18 ${"a".repeat(998)}`);
    const extended = await addGroceryItems(db, actorA, list.id, { expectedRevision: list.revision, groupName: list.content.groups[0].name, items: [{ text: "Additional garnish" }] });
    if (extended.content.kind !== "grocery") throw new Error("Expected a grocery list");
    expect(extended.content.groups).toHaveLength(1);
    expect(extended.content.groups[0].items).toHaveLength(2);
    await expect(addGroceryItems(db, actorA, list.id, { expectedRevision: extended.revision, groupName: "Unknown".repeat(20), items: [{ text: "Must not save" }] })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect((await getArtifact(db, actorA, list.id)).revision).toBe(extended.revision);
  });

  it("rejects unrepresentable scaling and oversized lists without partially saving changes", async () => {
    const recipe = await createRecipe(db, actorA, { content: { ...content, servings: Number.MIN_VALUE } });
    const before = await listArtifacts(db, actorA);
    await expect(deriveGroceryList(db, actorA, { title: "Unrepresentable scale", recipes: [{ recipeId: recipe.id, versionId: recipe.version.id, servings: 1000 }] })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(await listArtifacts(db, actorA)).toEqual(before);
    const groups = Array.from({ length: 5 }, (_, group) => ({ name: `Group ${group}`, items: Array.from({ length: 200 }, (_, item) => ({ text: `Item ${group}:${item}` })) }));
    const full = await createArtifact(db, actorA, { kind: "grocery", title: "At the size limit", groups });
    await expect(addGroceryItems(db, actorA, full.id, { expectedRevision: full.revision, groupName: groups[0].name, items: [{ text: "One item too many" }] })).rejects.toBeDefined();
    const saved = await getArtifact(db, actorA, full.id);
    expect(saved.revision).toBe(full.revision);
    expect(saved.content).toEqual(full.content);
    await expect(createArtifact(db, actorA, { kind: "grocery", title: "Too large", groups: [...groups, { name: "Overflow", items: [{ text: "Too many" }] }] })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(await listArtifacts(db, actorA, { query: "Too large" })).toEqual([]);
  });

  it("rejects concurrent stale writes without losing the successful checkoff", async () => {
    const list = await createArtifact(db, actorA, { kind: "grocery", title: "Shared checkoffs", groups: [{ name: "", items: [{ text: "Rice" }, { text: "Beans" }] }] });
    if (list.content.kind !== "grocery") throw new Error("Expected a grocery list");
    const attempts = await Promise.allSettled(list.content.groups[0].items.map((item) => setGroceryItemChecked(db, actorA, list.id, { expectedRevision: list.revision, itemId: item.id, checked: true })));
    expect(attempts.filter((attempt) => attempt.status === "fulfilled")).toHaveLength(1);
    expect(attempts.find((attempt) => attempt.status === "rejected")).toMatchObject({ reason: { code: "CONFLICT" } });
    const saved = await getArtifact(db, actorA, list.id);
    if (saved.content.kind !== "grocery") throw new Error("Expected a grocery list");
    expect(saved.content.groups[0].items.filter((item) => item.checked)).toHaveLength(1);
    expect(saved.revision).toBe(list.revision + 1);
    await expect(removeGroceryItem(db, actorA, list.id, { expectedRevision: list.revision, itemId: list.content.groups[0].items[0].id })).rejects.toMatchObject({ code: "CONFLICT" });
    expect((await getArtifact(db, actorA, list.id)).content).toEqual(saved.content);
  });

  it("isolates artifact reads and writes by workspace and rejects revoked members", async () => {
    const list = await createArtifact(db, actorB, { kind: "grocery", title: "Private shopping", groups: [{ name: "", items: [{ text: "Private ingredient" }] }] });
    if (list.content.kind !== "grocery") throw new Error("Expected a grocery list");
    const itemId = list.content.groups[0].items[0].id;
    await expect(getArtifact(db, actorA, list.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(addGroceryItems(db, actorA, list.id, { expectedRevision: list.revision, groupName: "", items: [{ text: "Injected" }] })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(setGroceryItemChecked(db, actorA, list.id, { expectedRevision: list.revision, itemId, checked: true })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(removeGroceryItem(db, actorA, list.id, { expectedRevision: list.revision, itemId })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await listArtifacts(db, actorA)).some((artifact) => artifact.id === list.id)).toBe(false);
    await expect(listArtifacts(db, { ...actorA, workspaceId: actorB.workspaceId })).rejects.toMatchObject({ code: "NOT_FOUND" });
    const plan = await createArtifact(db, actorB, { kind: "meal-plan", title: "Private plan", entries: [{ meal: "Dinner", title: "Private dinner" }] });
    if (plan.content.kind !== "meal-plan") throw new Error("Expected a meal plan");
    await expect(addMealPlanEntry(db, actorA, plan.id, { expectedRevision: plan.revision, entry: { meal: "Dinner", title: "Injected" } })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(removeMealPlanEntry(db, actorA, plan.id, { expectedRevision: plan.revision, entryId: plan.content.entries[0].id })).rejects.toMatchObject({ code: "NOT_FOUND" });
    const local = await createArtifact(db, actorA, { kind: "grocery", title: "Workspace list" });
    expect((await getArtifact(db, fellowCook, local.id)).id).toBe(local.id);
    await db.delete(workspaceMembers).where(and(eq(workspaceMembers.workspaceId, fellowCook.workspaceId), eq(workspaceMembers.userId, fellowCook.userId)));
    await expect(getArtifact(db, fellowCook, local.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(addGroceryItems(db, fellowCook, local.id, { expectedRevision: local.revision, groupName: "", items: [{ text: "Revoked write" }] })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("rejects foreign, mismatched, and unreviewed recipe references without partial artifacts", async () => {
    const recipe = await createRecipe(db, actorA, { content });
    const other = await createRecipe(db, actorA, { content });
    const foreign = await createRecipe(db, actorB, { content });
    const draft = await createRecipe(db, actorA, { content, status: "draft" });
    const before = await listArtifacts(db, actorA);
    for (const reference of [
      { recipeId: foreign.id, versionId: foreign.version.id },
      { recipeId: recipe.id, versionId: other.version.id },
      { recipeId: draft.id, versionId: draft.version.id },
    ]) {
      await expect(deriveGroceryList(db, actorA, { title: "Must not save partially", recipes: [{ recipeId: recipe.id, versionId: recipe.version.id }, reference] })).rejects.toBeDefined();
      await expect(createArtifact(db, actorA, { kind: "meal-plan", title: "Must not save invalid plan", entries: [{ meal: "Dinner", ...reference }] })).rejects.toBeDefined();
    }
    expect(await listArtifacts(db, actorA)).toEqual(before);
  });

  it("validates dates and kind-specific actions while preserving saved content on failure", async () => {
    const plan = await createArtifact(db, actorA, { kind: "meal-plan", title: "Valid plan" });
    for (const date of ["2027-02-29", "2026-04-31", "2026-13-01", "10/05/2026"]) {
      await expect(addMealPlanEntry(db, actorA, plan.id, { expectedRevision: plan.revision, entry: { date, meal: "Dinner", title: "Invalid day" } })).rejects.toBeDefined();
    }
    await expect(addMealPlanEntry(db, actorA, plan.id, { expectedRevision: plan.revision, entry: { meal: "Dinner", recipeId: randomUUID() } })).rejects.toBeDefined();
    await expect(addGroceryItems(db, actorA, plan.id, { expectedRevision: plan.revision, groupName: "", items: [{ text: "Wrong kind" }] })).rejects.toBeDefined();
    expect((await getArtifact(db, actorA, plan.id)).content).toEqual(plan.content);
    expect((await getArtifact(db, actorA, plan.id)).revision).toBe(plan.revision);
    const list = await createArtifact(db, actorA, { kind: "grocery", title: "Valid grocery list" });
    await expect(addMealPlanEntry(db, actorA, list.id, { expectedRevision: list.revision, entry: { meal: "Dinner", title: "Wrong kind" } })).rejects.toBeDefined();
    await expect(setGroceryItemChecked(db, actorA, list.id, { expectedRevision: list.revision, itemId: randomUUID(), checked: true })).rejects.toBeDefined();
    expect((await getArtifact(db, actorA, list.id)).revision).toBe(list.revision);
  });
});
