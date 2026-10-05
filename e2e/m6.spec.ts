import type { APIRequestContext } from "@playwright/test";
import type { UIMessage } from "ai";
import { Pool } from "pg";
import { testDatabaseUrl } from "../tests/database";
import type { ArtifactDetail } from "../src/domain/artifact";
import { clientHeaders, expect, test } from "./fixtures";

const origin = "http://localhost:3100", headers = { Origin: origin };
async function signUp(request: APIRequestContext) {
  expect((await request.post(`${origin}/api/auth/sign-up/email`, { headers, data: { name: "List cook", email: `artifacts-${crypto.randomUUID()}@example.test`, password: "a-good-test-password-42" } })).ok()).toBe(true);
}
async function create(request: APIRequestContext, data: unknown) {
  const response = await request.post("/api/artifacts", { headers, data });
  expect(response.status()).toBe(201);
  return await response.json() as ArtifactDetail;
}
const grocery = { kind: "grocery", title: "Weekend groceries", groups: [{ name: "Produce", items: [{ text: "2 lemons" }, { text: "A bunch of parsley" }] }] };

test("a grocery list persists checkoffs, additions, removal and copied text; offline writes roll back and other users cannot access it", async ({ page, context, browser }, testInfo) => {
  await signUp(page.request);
  const list = await create(page.request, grocery);
  await page.goto(`/artifacts/${list.id}`);
  await expect(page.getByRole("heading", { name: grocery.title, exact: true })).toBeVisible();
  await page.getByRole("checkbox", { name: "2 lemons", exact: true }).check();
  const get = async () => await (await page.request.get(`/api/artifacts/${list.id}`)).json() as ArtifactDetail;
  await expect.poll(async () => (await get()).revision).toBe(2);
  await page.getByRole("button", { name: "Add items", exact: true }).click();
  await page.getByLabel("Items, one per line", { exact: true }).fill("Olive oil\nRice");
  await page.getByLabel("Group (optional)", { exact: true }).fill("Cupboard");
  await page.getByRole("button", { name: "Save items", exact: true }).click();
  await expect(page.getByRole("checkbox", { name: "Rice", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Remove A bunch of parsley", exact: true }).click();
  await expect.poll(async () => (await get()).revision).toBe(4);
  await expect(page.getByRole("checkbox", { name: "A bunch of parsley", exact: true })).toHaveCount(0);
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.getByRole("button", { name: "Copy text", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Copied." })).toBeVisible();
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).toContain("[x] 2 lemons"); expect(copied).toContain("Cupboard\n[ ] Olive oil\n[ ] Rice");
  expect(copied).not.toContain("parsley");
  await context.setOffline(true);
  await page.getByRole("checkbox", { name: "Rice", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "This change wasn’t saved" })).toBeVisible();
  await expect(page.getByRole("checkbox", { name: "Rice", exact: true })).not.toBeChecked();
  await context.setOffline(false);
  await page.reload();
  await expect(page.getByRole("checkbox", { name: "2 lemons", exact: true })).toBeChecked();
  await expect(page.getByRole("checkbox", { name: "Rice", exact: true })).not.toBeChecked();
  await page.screenshot({ path: `test-results/grocery-list-${testInfo.project.name}.png` });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const outsider = await browser.newContext({ baseURL: origin, extraHTTPHeaders: clientHeaders() });
  try {
    expect((await outsider.request.get(`/api/artifacts/${list.id}`)).status()).toBe(401);
    await signUp(outsider.request);
    expect((await outsider.request.get(`/api/artifacts/${list.id}`)).status()).toBe(404);
    expect((await outsider.request.post(`/api/artifacts/${list.id}/actions`, { headers, data: { action: "addItems", expectedRevision: 4, groupName: "", items: [{ text: "intrusion" }] } })).status()).toBe(404);
    expect(await (await outsider.request.get("/api/artifacts")).json()).toEqual([]);
  } finally { await outsider.close(); }
  expect((await page.request.post(`/api/artifacts/${list.id}/actions`, { headers, data: { action: "addItems", expectedRevision: 1, items: [{ text: "stale" }] } })).status()).toBe(409);
  expect((await page.request.post(`/api/artifacts/${list.id}/actions`, { headers: { Origin: "https://wrong.example" }, data: { action: "addItems", expectedRevision: 4, items: [{ text: "wrong origin" }] } })).status()).toBe(400);
  await page.getByRole("link", { name: "Back to Library", exact: true }).click();
  await page.getByRole("link", { name: /Weekend groceries Grocery list/ }).click();
  await expect(page.getByRole("checkbox", { name: "2 lemons", exact: true })).toBeChecked();
});

test("a meal plan uses pinned recipes and servings to build groceries, keeps freeform meals, and gives Sift artifact context", async ({ page }, testInfo) => {
  await signUp(page.request);
  const recipeResponse = await page.request.post("/api/recipes", { headers, data: { content: { title: "Lemon soup", servings: 4, ingredientSections: [{ name: "Soup", items: [{ text: "2 cups broth" }, { text: "1 lemon" }] }], instructionSections: [{ steps: ["Warm broth and add lemon."] }] }, source: { type: "manual" } } });
  expect(recipeResponse.status()).toBe(201);
  const recipe = await recipeResponse.json();
  const plan = await create(page.request, { kind: "meal-plan", title: "A quiet weekend", entries: [] });
  await page.goto(`/artifacts/${plan.id}`);
  await expect(page.getByRole("button", { name: "Build grocery list", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Add meal", exact: true }).click();
  await page.getByRole("combobox", { name: "Recipe", exact: true }).selectOption(recipe.id);
  await page.getByLabel("Date (optional)", { exact: true }).fill("2026-10-10");
  await page.getByLabel("Servings (optional)", { exact: true }).fill("8");
  await page.getByLabel("Note (optional)", { exact: true }).fill("Make enough for tomorrow.");
  await page.getByRole("button", { name: "Save meal", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Lemon soup", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Add meal", exact: true }).click();
  await page.getByLabel("What’s for this meal?", { exact: true }).fill("Leftovers and salad");
  await page.getByRole("button", { name: "Save meal", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Leftovers and salad", exact: true })).toBeVisible();
  await page.screenshot({ path: `test-results/meal-plan-${testInfo.project.name}.png` });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const updated = await page.request.patch(`/api/recipes/${recipe.id}`, { headers, data: { expectedVersionId: recipe.version.id, changeSummary: "Use a different broth amount", content: { ...recipe.version.content, title: "New soup", ingredientSections: [{ name: "Soup", items: [{ text: "5 cups broth" }] }] } } });
  expect(updated.ok()).toBe(true);
  await page.getByRole("button", { name: "Ask Sift", exact: true }).click();
  const panel = page.getByRole("dialog", { name: "sift", exact: true });
  await panel.getByRole("textbox", { name: "Message Sift", exact: true }).fill("What is in this plan?");
  const sent = page.waitForRequest((request) => request.url().endsWith("/api/assistant") && request.method() === "POST");
  await panel.getByRole("button", { name: "Send message", exact: true }).click();
  expect((await sent).postDataJSON().context).toEqual({ route: `/artifacts/${plan.id}`, activeArtifactId: plan.id });
  await expect(panel.getByRole("alert").filter({ hasText: "AI_GATEWAY_API_KEY" })).toBeVisible();
  await panel.getByRole("button", { name: "Close Sift", exact: true }).click();
  await page.getByRole("button", { name: "Build grocery list", exact: true }).click();
  await expect(page.getByRole("heading", { name: "A quiet weekend groceries", exact: true })).toBeVisible();
  await expect(page.getByRole("checkbox", { name: "4 cups broth", exact: true })).toBeVisible();
  await expect(page.getByRole("checkbox", { name: "2 lemon", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Lemon soup · Soup", exact: true })).toBeVisible();
  await page.goto(`/artifacts/${plan.id}`);
  await expect(page.getByRole("heading", { name: "Leftovers and salad", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Remove Leftovers and salad", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Leftovers and salad", exact: true })).toHaveCount(0);
});

test("repeated saved receipts show one current card and one initial fetch, then sync edits with the full list", async ({ page }, testInfo) => {
  await signUp(page.request);
  const list = await create(page.request, grocery);
  const conversation = await (await page.request.post("/api/conversations", { headers, data: { title: "Our shopping list" } })).json();
  // Test-only persisted SDK tool results exercise rendering. Real tool-loop
  // execution and authorization are covered separately in agent tests.
  const messages: UIMessage[] = [0, 1].map((message) => ({ id: crypto.randomUUID(), role: "assistant", parts: ["createGroceryList", "getArtifact"].map((name, index) => ({ type: `tool-${name}`, toolCallId: `artifact-card-${message}-${index}`, state: "output-available", input: {}, output: { ok: true, artifactId: list.id, kind: list.kind, title: list.title, revision: list.revision } })) }));
  const pool = new Pool({ connectionString: testDatabaseUrl });
  try { await pool.query("UPDATE conversations SET messages=$1::jsonb WHERE id=$2", [JSON.stringify(messages), conversation.id]); }
  finally { await pool.end(); }
  await page.goto("/library");
  let artifactReads = 0;
  page.on("request", (request) => { if (request.method() === "GET" && request.url().endsWith(`/api/artifacts/${list.id}`)) artifactReads++; });
  await page.getByRole("button", { name: "Open Sift", exact: true }).click();
  const panel = page.getByRole("dialog", { name: "sift", exact: true }), cards = panel.getByRole("region", { name: `Grocery list: ${list.title}`, exact: true });
  await expect(cards).toHaveCount(1);
  await expect(cards.getByRole("checkbox", { name: "2 lemons", exact: true })).toBeVisible();
  expect(artifactReads).toBe(1);
  await cards.getByRole("checkbox", { name: "2 lemons", exact: true }).check();
  // The checked value is optimistic; reload only after the server commits it.
  await expect.poll(async () => (await (await page.request.get(`/api/artifacts/${list.id}`)).json()).revision).toBe(2);
  await page.reload();
  await page.getByRole("button", { name: "Open Sift", exact: true }).click();
  await expect(cards.first().getByRole("checkbox", { name: "2 lemons", exact: true })).toBeChecked();
  await cards.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `test-results/artifact-card-${testInfo.project.name}.png` });
  await cards.first().getByRole("link", { name: "Open full list", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/artifacts/${list.id}$`));
  await expect(page.getByRole("dialog", { name: "sift", exact: true })).toHaveCount(0);
  await expect(page.getByRole("checkbox", { name: "2 lemons", exact: true })).toBeChecked();
  await page.getByRole("checkbox", { name: "2 lemons", exact: true }).uncheck();
  await expect.poll(async () => (await (await page.request.get(`/api/artifacts/${list.id}`)).json()).revision).toBe(3);
  await page.getByRole("button", { name: "Open Sift", exact: true }).click();
  await expect(cards).toHaveCount(1);
  await expect(cards.getByRole("checkbox", { name: "2 lemons", exact: true })).not.toBeChecked();
});
