import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";

const headers = { Origin: "http://localhost:3100" };
async function startCook(page: Page) {
  expect((await page.request.post("/api/auth/sign-up/email", { headers, data: { name: "Cook", email: `cook-${crypto.randomUUID()}@example.test`, password: "a-good-test-password-42" } })).ok()).toBe(true);
  const created = await page.request.post("/api/recipes", { headers, data: { content: {
    title: "Weeknight Pad Thai", servings: 2,
    ingredientSections: [
      { name: "Sauce", items: [{ text: "3 tbsp tamarind paste" }, { text: "2 tbsp fish sauce" }, { text: "2 tbsp brown sugar" }] },
      { name: "Noodles", items: [{ text: "8 oz rice noodles" }, { text: "2 large eggs" }] },
    ],
    instructionSections: [{ name: "", steps: ["Soak the noodles in hot water for 10 minutes.", "Whisk together the tamarind, fish sauce, and sugar until the sugar dissolves.", "Scramble the eggs, then toss everything together."] }],
  } } });
  expect(created.status()).toBe(201);
  const recipe = await created.json() as { id: string; version: { id: string } };
  const cook = await page.request.post("/api/cooking-sessions", { headers, data: { recipeId: recipe.id, expectedVersionId: recipe.version.id, servings: 4 } });
  expect(cook.status()).toBe(201);
  return { recipe, session: await cook.json() as { id: string } };
}

test("each step lists its own ingredients, scaled for this cook", async ({ page }, info) => {
  const { recipe, session } = await startCook(page);
  await page.goto(`/recipes/${recipe.id}?cook=${session.id}`);
  const step = page.getByRole("region", { name: "Current cooking step" });
  const forStep = step.getByRole("region", { name: "Ingredients for this step" });
  await expect(forStep.getByRole("listitem")).toHaveText(["16 oz rice noodles"]);
  await step.getByRole("button", { name: "Next step", exact: true }).click();
  await expect(forStep.getByRole("listitem")).toHaveText(["6 tbsp tamarind paste", "4 tbsp fish sauce", "4 tbsp brown sugar"]);
  await expect(forStep.getByRole("heading")).toHaveText("For this step · scaled for 4");
  await forStep.getByRole("checkbox").first().check();
  await expect(forStep.getByRole("checkbox").first()).toBeChecked();
  await page.screenshot({ path: `test-results/cook-step-ingredients-${info.project.name}.png`, animations: "disabled" });
});

test("leaving a cook shows a resume card everywhere else until it's hidden", async ({ page }, info) => {
  const { recipe, session } = await startCook(page);
  await page.goto("/library");
  const card = page.getByRole("complementary", { name: "Cooking in progress" });
  await expect(card).toContainText("Weeknight Pad Thai");
  await expect(card).toContainText("Step 1 of 3");
  await page.screenshot({ path: `test-results/resume-cooking-${info.project.name}.png`, animations: "disabled" });
  await card.getByRole("link", { name: "Resume" }).click();
  await expect(page).toHaveURL(new RegExp(`/recipes/${recipe.id}\\?cook=${session.id}$`));
  await expect(card).toHaveCount(0);
  await page.goto("/library");
  await expect(card).toBeVisible();
  await card.getByRole("button", { name: "Hide for now", exact: true }).click();
  await expect(card).toHaveCount(0);
  await page.goto("/library");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(card).toHaveCount(0);
});

test("a cook can be discarded without leaving anything in history", async ({ page }) => {
  const { recipe, session } = await startCook(page);
  await page.goto(`/recipes/${recipe.id}?cook=${session.id}`);
  await page.getByRole("button", { name: "Stop cooking", exact: true }).click();
  const end = page.getByRole("dialog", { name: "Stop cooking?", exact: true });
  await expect(end).toContainText("Save this cook to your history, or delete it.");
  await page.screenshot({ path: `test-results/discard-cook-${test.info().project.name}.png`, animations: "disabled" });
  await end.getByRole("button", { name: "Delete cook", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/recipes/${recipe.id}$`));
  expect((await page.request.get(`/api/cooking-sessions/${session.id}`)).status()).toBe(404);
  expect(await (await page.request.get(`/api/recipes/${recipe.id}/cooks`)).json()).toEqual([]);
  await page.goto("/library");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByRole("complementary", { name: "Cooking in progress" })).toHaveCount(0);
});

test.describe("Sift docked beside a cook", () => {
  test.use({ siftDocked: true });
  test("wide screens keep Sift open, resizable and out of the page's way while cooking", async ({ page }, info) => {
    test.skip(info.project.name === "phone", "Phones keep the full-screen sheet.");
    const { recipe, session } = await startCook(page);
    await page.goto(`/recipes/${recipe.id}?cook=${session.id}`);
    const sidebar = page.getByRole("dialog", { name: "sift", exact: true });
    await expect(sidebar).toBeVisible();
    await expect(page.getByRole("button", { name: "Open Sift", exact: true })).toBeHidden();
    const step = page.getByRole("region", { name: "Current cooking step" });
    const sideBox = (await sidebar.boundingBox())!;
    expect((await step.boundingBox())!.x + (await step.boundingBox())!.width).toBeLessThanOrEqual(sideBox.x + 1);
    await page.screenshot({ path: `test-results/cook-docked-${info.project.name}.png`, animations: "disabled" });

    // The page stays usable with Sift open: no overlay, no focus trap.
    await step.getByRole("button", { name: "Next step", exact: true }).click();
    await expect(step.getByText("Step 2", { exact: false })).toBeVisible();
    await expect(sidebar).toBeVisible();

    const handle = page.getByRole("separator", { name: "Resize Sift sidebar" });
    const box = (await handle.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + 200);
    await page.mouse.down(); await page.mouse.move(box.x - 120, box.y + 200, { steps: 6 }); await page.mouse.up();
    const widened = Math.round((await sidebar.boundingBox())!.width);
    expect(widened).toBeGreaterThan(Math.round(sideBox.width) + 100);
    await page.reload();
    await expect(sidebar).toBeVisible();
    expect(Math.abs(Math.round((await sidebar.boundingBox())!.width) - widened)).toBeLessThanOrEqual(2);

    await sidebar.getByRole("button", { name: "Close Sift", exact: true }).click();
    await expect(sidebar).toBeHidden();
    await page.reload();
    await expect(page.getByRole("button", { name: "Open Sift", exact: true })).toBeVisible();
    await expect(sidebar).toBeHidden();
    await page.getByRole("button", { name: "Open Sift", exact: true }).click();
    await expect(sidebar).toBeVisible();

    // Docking belongs to the cooking view only.
    await page.goto("/library");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(sidebar).toBeHidden();
  });

  test("phones keep the full-screen sheet while cooking", async ({ page }, info) => {
    test.skip(info.project.name !== "phone", "Phone-only behavior.");
    const { recipe, session } = await startCook(page);
    await page.goto(`/recipes/${recipe.id}?cook=${session.id}`);
    await expect(page.getByRole("region", { name: "Current cooking step" })).toBeVisible();
    await expect(page.getByRole("dialog", { name: "sift", exact: true })).toBeHidden();
    await expect(page.getByRole("button", { name: "Open Sift", exact: true })).toBeVisible();
  });
});
