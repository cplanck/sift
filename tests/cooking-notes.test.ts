import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { connectDatabase } from "@/db/connection";
import { cookingSessionNotes, recipes, users } from "@/db/schema";
import { createRecipe, getRecipe } from "@/services/recipes";
import { ensurePersonalWorkspace, type Actor } from "@/services/workspaces";
import { finishCookingSession, getCookingSession, listCookingHistory, startCookingSession } from "@/services/cooking";
import { dispatchCookingNotes, processCookingNote } from "@/jobs/organize-cooking-notes";
import { testDatabaseUrl } from "./database";

const mocks = vi.hoisted(() => ({ organize: vi.fn(), send: vi.fn() }));
vi.mock("@/ai/organize-cooking-notes", () => ({ organizeCookingNotes: mocks.organize }));
vi.mock("@/jobs/client", () => ({ requireJobs: () => {}, inngest: { createFunction: () => ({}), send: mocks.send } }));
const { db, pool } = connectDatabase(testDatabaseUrl);
vi.mock("@/db", () => ({ database: () => db }));
const ids = [randomUUID(), randomUUID()];
let owner: Actor, outsider: Actor;
beforeAll(async () => {
  await db.insert(users).values(ids.map(id => ({ id, name: "Cook note test", email: `${id}@example.test` })));
  [owner, outsider] = await Promise.all(ids.map(async userId => ({ userId, workspaceId: await ensurePersonalWorkspace(db, userId) })));
});
beforeEach(() => { mocks.organize.mockReset(); mocks.send.mockReset(); });
afterAll(async () => {
  await db.update(recipes).set({ currentVersionId: null }).where(inArray(recipes.workspaceId, [owner.workspaceId, outsider.workspaceId]));
  await db.delete(users).where(inArray(users.id, ids)); await pool.end();
});
async function cook() {
  const recipe = await createRecipe(db, owner, { content: { title: "Soup", servings: 2, ingredientSections: [{ name: "", items: [{ text: "2 cups broth" }] }], instructionSections: [{ name: "", steps: ["Heat the broth."] }] } });
  const session = await startCookingSession(db, owner, { recipeId: recipe.id, expectedVersionId: recipe.version.id });
  return { recipe, session };
}
it("finishes immediately, saves original notes once, and queues only an opaque note ID", async () => {
  const { recipe, session } = await cook();
  const input = { expectedRevision: session.revision, status: "completed", notes: "Um I used 3 cups broth. More lemon next time." };
  await expect(finishCookingSession(db, outsider, session.id, input)).rejects.toMatchObject({ code: "NOT_FOUND" });
  const [a, b] = await Promise.all([finishCookingSession(db, owner, session.id, input), finishCookingSession(db, owner, session.id, input)]);
  expect(a.status).toBe("completed"); expect(a.notes).toHaveLength(1); expect(a.notes[0].id).toBe(b.notes[0].id);
  expect(a.notes[0]).toMatchObject({ body: input.notes, cleanupStatus: "queued", organizedBody: null });
  await expect(finishCookingSession(db, owner, session.id, { ...input, notes: "Different notes" })).rejects.toMatchObject({ code: "CONFLICT" });
  await dispatchCookingNotes();
  expect(mocks.send).toHaveBeenCalledWith(expect.objectContaining({ name: "sift/cooking-note.requested", data: { noteId: a.notes[0].id } }));
  expect(JSON.stringify(mocks.send.mock.calls)).not.toContain(input.notes);
  expect((await getRecipe(db, owner, recipe.id)).version.id).toBe(recipe.version.id);
});
it("organizes once, preserves the original, and keeps notes tied to the right cook", async () => {
  const { recipe, session } = await cook();
  const first = await finishCookingSession(db, owner, session.id, { expectedRevision: 1, status: "completed", notes: "Used extra broth." });
  const second = await startCookingSession(db, owner, { recipeId: recipe.id, expectedVersionId: recipe.version.id });
  await finishCookingSession(db, owner, second.id, { expectedRevision: 1, status: "completed", notes: "Less salt this time." });
  mocks.organize.mockResolvedValue("- Used extra broth.");
  await Promise.all([processCookingNote(db, first.notes[0].id), processCookingNote(db, first.notes[0].id)]);
  expect(mocks.organize).toHaveBeenCalledTimes(1);
  const history = await listCookingHistory(db, owner, recipe.id);
  expect(history.find(cook => cook.id === session.id)?.notes[0]).toMatchObject({ body: "Used extra broth.", organizedBody: "- Used extra broth.", cleanupStatus: "ready" });
  expect(history.find(cook => cook.id === second.id)?.notes[0].body).toBe("Less salt this time.");
});
it("retains raw notes on provider failure and does not repurchase a failed job", async () => {
  const { session } = await cook();
  const finished = await finishCookingSession(db, owner, session.id, { expectedRevision: 1, status: "abandoned", notes: "Burned the sauce, try lower heat." });
  mocks.organize.mockRejectedValue(new Error("Sensitive provider payload"));
  await processCookingNote(db, finished.notes[0].id);
  await processCookingNote(db, finished.notes[0].id);
  expect(mocks.organize).toHaveBeenCalledTimes(1);
  const saved = await getCookingSession(db, owner, session.id);
  expect(saved.notes[0]).toMatchObject({ body: "Burned the sauce, try lower heat.", cleanupStatus: "failed", organizedBody: null });
  expect(JSON.stringify(saved)).not.toContain("Sensitive provider payload");
  const [row] = await db.select().from(cookingSessionNotes).where(eq(cookingSessionNotes.id, finished.notes[0].id));
  expect(row.wrapUp).toBe(true);
});
