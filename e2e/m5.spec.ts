import type { APIRequestContext } from "@playwright/test";
import { clientHeaders, expect, test } from "./fixtures";

const origin = "http://localhost:3100", headers = { Origin: origin };
const content = {
  title: "Sunday Carrot Soup", description: "A pot of soup for the counter.", servings: 4,
  ingredientSections: [{ name: "Soup", items: [{ text: "2 cups broth", quantity: { kind: "exact", value: 2 }, unit: "cups", item: "broth" }, { text: "3 carrots" }] }, { name: "Finish", items: [{ text: "Salt to taste" }] }],
  instructionSections: [{ name: "Prepare", steps: ["Chop the carrots."] }, { name: "Cook", steps: ["Simmer the carrots in broth.", "Season and serve."] }],
};
async function signUp(request: APIRequestContext) {
  const response = await request.post(`${origin}/api/auth/sign-up/email`, { headers, data: { name: "Alex", email: `cooking-${crypto.randomUUID()}@example.test`, password: "a-good-test-password-42" } });
  expect(response.ok()).toBe(true);
}
async function createRecipe(request: APIRequestContext, title = content.title) {
  const response = await request.post("/api/recipes", { headers, data: { content: { ...content, title } } });
  expect(response.status()).toBe(201);
  return await response.json() as { id: string; version: { id: string } };
}

test("a cook pins its version, persists progress and session notes, and finishes into recipe history", async ({ page }, testInfo) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await signUp(page.request);
  const recipe = await createRecipe(page.request);
  await page.goto(`/recipes/${recipe.id}`);
  await expect(page.getByRole("heading", { name: content.title, exact: true })).toBeVisible();
  expect(await (await page.request.get(`/api/recipes/${recipe.id}/cooks`)).json()).toEqual([]);
  await page.reload();
  expect(await (await page.request.get(`/api/recipes/${recipe.id}/cooks`)).json()).toEqual([]);
  await page.getByRole("button", { name: "Cook", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/recipes/${recipe.id}\\?cook=[0-9a-f-]+$`));
  const sessionId = new URL(page.url()).searchParams.get("cook")!;
  const getSession = async () => await (await page.request.get(`/api/cooking-sessions/${sessionId}`)).json();
  expect(await getSession()).toMatchObject({ recipeVersionId: recipe.version.id, status: "active", servings: 4, revision: 1 });
  await expect(page.getByRole("region", { name: "Current cooking step" }).getByText("Chop the carrots.", { exact: true })).toBeVisible();
  await page.getByText("Ingredients & details", { exact: true }).click();
  await page.getByRole("tabpanel", { name: "Ingredients" }).getByRole("checkbox", { name: "2 cups broth", exact: true }).check();
  await expect.poll(async () => (await getSession()).progress.checkedIngredients).toEqual(["0:0"]);
  await page.getByRole("button", { name: "Mark step done", exact: true }).click();
  await expect.poll(async () => (await getSession()).progress.checkedSteps).toEqual(["0:0"]);
  await page.getByRole("button", { name: "Next step", exact: true }).click();
  await expect.poll(async () => (await getSession()).progress.currentStep).toBe(1);
  await page.getByRole("button", { name: "More cooking servings", exact: true }).click();
  await expect.poll(async () => (await getSession()).servings).toBe(5);
  await expect(page.getByRole("tabpanel", { name: "Ingredients" }).getByRole("checkbox", { name: "2½ cups broth", exact: true })).toBeChecked();

  await page.getByRole("tab", { name: "Cook notes", exact: true }).click();
  await page.getByRole("textbox", { name: "Cooking note", exact: true }).fill("Roasted the carrots first. Keep this observation with this cook.");
  await page.getByRole("button", { name: "Add cooking note", exact: true }).click();
  await expect(page.getByText("Roasted the carrots first. Keep this observation with this cook.", { exact: true })).toBeVisible();
  const canonical = await (await page.request.get(`/api/recipes/${recipe.id}`)).json();
  expect(canonical.recipe.version.id).toBe(recipe.version.id);
  expect(canonical.notes).toEqual([]);
  const rename = await page.request.post(`/api/recipes/${recipe.id}/actions`, { headers, data: { action: "rename", title: "Updated canonical soup", expectedVersionId: recipe.version.id } });
  expect(rename.status()).toBe(200);
  await page.reload();
  await expect(page.getByRole("heading", { name: content.title, exact: true })).toBeVisible();
  expect((await getSession()).version.id).toBe(recipe.version.id);
  await page.getByRole("link", { name: "Back to recipe", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Updated canonical soup", exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Resume cooking", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`cook=${sessionId}$`));
  expect(await (await page.request.get(`/api/recipes/${recipe.id}/cooks`)).json()).toHaveLength(1);
  await expect(page.getByRole("region", { name: "Current cooking step" }).getByText("Simmer the carrots in broth.", { exact: true })).toBeVisible();
  await page.screenshot({ path: `test-results/cooking-mode-${testInfo.project.name}.png` });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

  await page.getByText("Ingredients & details", { exact: true }).click();
  await page.context().setOffline(true);
  await page.getByRole("tabpanel", { name: "Ingredients" }).getByRole("checkbox", { name: "3¾ carrots", exact: true }).check();
  await expect(page.getByText(/Checkoffs on this screen won’t save or sync/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Finish cooking", exact: true })).toBeDisabled();
  await page.context().setOffline(false);
  await page.getByRole("button", { name: "Reload saved progress", exact: true }).click();
  await expect(page.getByRole("tabpanel", { name: "Ingredients" }).getByRole("checkbox", { name: "3¾ carrots", exact: true })).not.toBeChecked();
  expect((await getSession()).progress.checkedIngredients).toEqual(["0:0"]);

  await page.getByRole("button", { name: "Open Sift", exact: true }).click();
  const panel = page.getByRole("dialog", { name: "sift", exact: true });
  await panel.getByRole("textbox", { name: "Message Sift", exact: true }).fill("What step am I on?");
  const requestPromise = page.waitForRequest((request) => request.url().endsWith("/api/assistant") && request.method() === "POST");
  await panel.getByRole("button", { name: "Send message", exact: true }).click();
  expect((await requestPromise).postDataJSON().context).toEqual({ route: `/recipes/${recipe.id}?cook=${sessionId}`, activeRecipeId: recipe.id, activeRecipeVersionId: recipe.version.id, activeCookingSessionId: sessionId });
  await expect(panel.getByRole("alert").filter({ hasText: "AI_GATEWAY_API_KEY" })).toBeVisible();
  await panel.getByRole("button", { name: "Close Sift", exact: true }).click();
  await page.getByRole("button", { name: "Finish cooking", exact: true }).click();
  const finish = page.getByRole("dialog", { name: "How did it go?", exact: true });
  await finish.getByRole("combobox", { name: "Rating (optional)", exact: true }).selectOption("5");
  await finish.getByRole("textbox", { name: "Summary (optional)", exact: true }).fill("Roasting made the difference.");
  await finish.getByRole("button", { name: "Save completed cook", exact: true }).click();
  await expect(page.getByText("Another one for the cookbook.", { exact: true })).toBeVisible();
  expect(await getSession()).toMatchObject({ status: "completed", rating: 5, summary: "Roasting made the difference." });
  await page.getByRole("link", { name: "Back to recipe", exact: true }).click();
  await page.getByRole("tab", { name: "History", exact: true }).click();
  await expect(page.getByRole("link").filter({ hasText: "Completed cook" })).toContainText("Roasting made the difference.");
  await expect(page.getByRole("heading", { name: "Every version, kept.", exact: true })).toBeVisible();
});

test("cooking boundaries reject cross-user and stale writes; ending early keeps the observation", async ({ page, browser }) => {
  await signUp(page.request);
  const recipe = await createRecipe(page.request), otherRecipe = await createRecipe(page.request, "Different recipe");
  const start = await page.request.post("/api/cooking-sessions", { headers, data: { recipeId: recipe.id, expectedVersionId: recipe.version.id } });
  expect(start.status()).toBe(201);
  const session = await start.json();
  const repeated = await page.request.post("/api/cooking-sessions", { headers, data: { recipeId: recipe.id, expectedVersionId: recipe.version.id } });
  expect((await repeated.json()).id).toBe(session.id);
  const progress = { checkedIngredients: ["0:1"], checkedSteps: [], currentStep: 1 };
  expect((await page.request.patch(`/api/cooking-sessions/${session.id}`, { headers, data: { expectedRevision: 1, progress } })).status()).toBe(200);
  expect((await page.request.patch(`/api/cooking-sessions/${session.id}`, { headers, data: { expectedRevision: 1, progress: { ...progress, currentStep: 2 } } })).status()).toBe(409);
  expect((await page.request.patch(`/api/cooking-sessions/${session.id}`, { headers, data: { expectedRevision: 2, progress: { ...progress, checkedIngredients: ["99:999"] } } })).status()).toBe(400);
  expect((await page.request.patch(`/api/cooking-sessions/${session.id}`, { headers: { Origin: "https://wrong.example" }, data: { expectedRevision: 2, progress } })).status()).toBe(400);
  await page.goto(`/recipes/${otherRecipe.id}?cook=${session.id}`);
  await expect(page.getByRole("heading", { name: "Nothing here just yet.", exact: true })).toBeVisible();
  const outsider = await browser.newContext({ baseURL: origin, extraHTTPHeaders: clientHeaders() });
  try {
    await signUp(outsider.request);
    expect((await outsider.request.get(`/api/cooking-sessions/${session.id}`)).status()).toBe(404);
    expect((await outsider.request.patch(`/api/cooking-sessions/${session.id}`, { headers, data: { expectedRevision: 2, progress } })).status()).toBe(404);
    expect((await outsider.request.post(`/api/cooking-sessions/${session.id}/actions`, { headers, data: { action: "note", body: "Not yours" } })).status()).toBe(404);
    expect((await outsider.request.get(`/api/cooking-sessions/${session.id}/photos`)).status()).toBe(404);
    expect((await outsider.request.get(`/api/recipes/${recipe.id}/cooks`)).status()).toBe(404);
  } finally { await outsider.close(); }
  await page.goto(`/recipes/${recipe.id}?cook=${session.id}`);
  await page.getByRole("button", { name: "End cook early", exact: true }).click();
  const end = page.getByRole("dialog", { name: "End this cook early?", exact: true });
  await end.getByRole("textbox", { name: "Summary (optional)", exact: true }).fill("Ran out of carrots.");
  await end.getByRole("button", { name: "End this cook", exact: true }).click();
  await expect(page.getByText("Saved for your cooking history.", { exact: true })).toBeVisible();
  expect(await (await page.request.get(`/api/cooking-sessions/${session.id}`)).json()).toMatchObject({ status: "abandoned", summary: "Ran out of carrots.", progress });
  await page.getByRole("tab", { name: "Cook notes", exact: true }).click();
  await page.getByRole("textbox", { name: "Cooking note", exact: true }).fill("Buy extra carrots next time.");
  await page.getByRole("button", { name: "Add cooking note", exact: true }).click();
  await expect(page.getByText("Buy extra carrots next time.", { exact: true })).toBeVisible();
});
