import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import { inArray } from "drizzle-orm";
import { connectDatabase } from "@/db/connection";
import { recipes, users, workspaceMembers } from "@/db/schema";
import { changeTimer, timerPhase, timerRemainingMs, type CookingTimerRecord } from "@/domain/cooking-timer";
import { createCookingTimer, listCookingTimers, updateCookingTimer } from "@/services/cooking-timers";
import { finishCookingSession, startCookingSession } from "@/services/cooking";
import { createRecipe } from "@/services/recipes";
import { ensurePersonalWorkspace, type Actor } from "@/services/workspaces";
import { testDatabaseUrl } from "./database";

const { db, pool } = connectDatabase(testDatabaseUrl);
const ids = [randomUUID(), randomUUID(), randomUUID()];
let owner: Actor, outsider: Actor, member: Actor;
beforeAll(async () => {
  await db.insert(users).values(ids.map((id) => ({ id, email: `${id}@example.test`, name: "Timer test" })));
  owner = { userId: ids[0], workspaceId: await ensurePersonalWorkspace(db, ids[0]) };
  outsider = { userId: ids[1], workspaceId: await ensurePersonalWorkspace(db, ids[1]) };
  member = { userId: ids[2], workspaceId: owner.workspaceId };
  await db.insert(workspaceMembers).values({ ...member, role: "member" });
});
afterAll(async () => {
  if (owner && outsider) await db.update(recipes).set({ currentVersionId: null }).where(inArray(recipes.workspaceId, [owner.workspaceId, outsider.workspaceId]));
  await db.delete(users).where(inArray(users.id, ids));
  await pool.end();
});
async function cook() {
  const recipe = await createRecipe(db, owner, { content: {
    title: "Timer test soup", servings: 2,
    ingredientSections: [{ name: "", items: [{ text: "2 carrots" }] }],
    instructionSections: [{ name: "", steps: ["Simmer the carrots.", "Serve."] }],
  } });
  return startCookingSession(db, owner, { recipeId: recipe.id, expectedVersionId: recipe.version.id });
}

it("keeps elapsed time across inactive pages and freezes only when paused", () => {
  const base: CookingTimerRecord = { id: ids[0], sessionId: ids[1], label: "Soup", stepKey: "0:0", status: "running", dueAt: new Date(60000).toISOString(), durationSeconds: 60, remainingMs: 60000, revision: 1 };
  expect(timerRemainingMs(base, 25000)).toBe(35000);
  const paused = changeTimer(base, { action: "pause", expectedRevision: 1 }, 25000);
  expect(timerRemainingMs(paused, 500000)).toBe(35000);
  const resumed = changeTimer(paused, { action: "resume", expectedRevision: 2 }, 500000);
  expect(timerPhase(resumed, 536000)).toBe("elapsed");
  const extended = changeTimer(resumed, { action: "extend", seconds: 60, expectedRevision: 3 }, 536000);
  expect(timerRemainingMs(extended, 536000)).toBe(60000);
});

it("deduplicates repeated starts and runs multiple timers independently", async () => {
  const session = await cook();
  const input = { id: randomUUID(), label: "Noodles", durationSeconds: 120, stepKey: "0:0" };
  const [a, b] = await Promise.all([createCookingTimer(db, owner, session.id, input), createCookingTimer(db, owner, session.id, input)]);
  expect(a.timer.id).toBe(b.timer.id);
  await createCookingTimer(db, owner, session.id, { label: "Sauce", durationSeconds: 300 });
  expect((await listCookingTimers(db, owner, session.id)).timers).toHaveLength(2);
  await updateCookingTimer(db, owner, session.id, a.timer.id, { action: "pause", expectedRevision: 1 });
  const timers = (await listCookingTimers(db, owner, session.id)).timers;
  expect(timers.find((timer) => timer.label === "Noodles")?.status).toBe("paused");
  expect(timers.find((timer) => timer.label === "Sauce")?.status).toBe("running");
});

it("rejects competing revisions instead of overwriting another device", async () => {
  const session = await cook();
  const { timer } = await createCookingTimer(db, owner, session.id, { label: "Soup", durationSeconds: 120 });
  const results = await Promise.allSettled([1, 2].map(() => updateCookingTimer(db, owner, session.id, timer.id, { action: "extend", seconds: 60, expectedRevision: 1 })));
  expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
  expect(results.find((result) => result.status === "rejected")).toMatchObject({ reason: { code: "CONFLICT" } });
  expect((await listCookingTimers(db, owner, session.id)).timers[0].revision).toBe(2);
});

it("isolates workspaces, limits writes to the cook's owner, and validates step references", async () => {
  const session = await cook();
  const input = { label: "Soup", durationSeconds: 120 };
  await expect(listCookingTimers(db, outsider, session.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
  for (const actor of [outsider, member]) await expect(createCookingTimer(db, actor, session.id, input)).rejects.toMatchObject({ code: "NOT_FOUND" });
  await expect(createCookingTimer(db, owner, session.id, { ...input, stepKey: "0:99" })).rejects.toMatchObject({ code: "INVALID_INPUT" });
  const { timer } = await createCookingTimer(db, owner, session.id, input);
  await expect(updateCookingTimer(db, member, session.id, timer.id, { action: "dismiss", expectedRevision: 1 })).rejects.toMatchObject({ code: "NOT_FOUND" });
  expect((await listCookingTimers(db, member, session.id)).timers).toHaveLength(1);
});

it("dismisses timers when the cook ends and prevents new starts", async () => {
  const session = await cook();
  await createCookingTimer(db, owner, session.id, { label: "Soup", durationSeconds: 120 });
  await finishCookingSession(db, owner, session.id, { status: "completed", expectedRevision: session.revision });
  expect((await listCookingTimers(db, owner, session.id)).timers).toEqual([]);
  await expect(createCookingTimer(db, owner, session.id, { label: "Late", durationSeconds: 120 })).rejects.toMatchObject({ code: "CONFLICT" });
});
