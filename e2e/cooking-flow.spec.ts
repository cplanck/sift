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
