import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";

const headers = { Origin: "http://localhost:3100" };
async function fitsPhone(page: Page) {
  const sizes = await page.evaluate(() => ({ width: innerWidth, document: document.documentElement.scrollWidth, body: document.body.scrollWidth }));
  expect(sizes.document).toBeLessThanOrEqual(sizes.width);
  expect(sizes.body).toBeLessThanOrEqual(sizes.width);
  const nav = page.getByRole("navigation", { name: "Kitchen modes" });
  await expect(nav).toHaveCount(1);
  const box = (await nav.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(10);
  expect(box.y + box.height).toBeLessThanOrEqual(page.viewportSize()!.height - 9);
  expect(box.y).toBeGreaterThan(page.viewportSize()!.height - 100);
}

for (const width of [320, 390]) test(`phone navigation and page controls fit at ${width}px`, async ({ page }, info) => {
  test.skip(info.project.name !== "phone", "Mobile dock uses the phone breakpoint.");
  test.setTimeout(90000);
  await page.setViewportSize({ width, height: width === 320 ? 568 : 844 });
  for (const route of ["/", "/sign-in", "/setup", "/consent"]) {
    await page.goto(route);
    await expect(page.getByRole("navigation", { name: "Kitchen modes" })).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  }
  expect((await page.request.post("/api/auth/sign-up/email", { headers, data: { name: "Alex", email: `mobile-${crypto.randomUUID()}@example.test`, password: "a-good-test-password-42" } })).ok()).toBe(true);
  const response = await page.request.post("/api/recipes", { headers, data: { content: {
    title: "Chicken Tikka Masala with Rice", servings: 4, totalMinutes: 45,
    ingredientSections: [{ items: [{ text: "1 cup rice" }, { text: "2 tbsp butter" }, { text: "1 lb chicken thighs" }] }],
    instructionSections: [{ steps: ["Simmer rice in water for 15 minutes.", "Cook the chicken in butter and serve with rice."] }],
  } } });
  expect(response.status()).toBe(201);
  const recipe = await response.json();
  const listResponse = await page.request.post("/api/artifacts", { headers, data: { kind: "grocery", title: "This week", groups: [{ items: [{ text: "1 cup rice", category: "Pantry" }, { text: "1 lb chicken thighs", category: "Meat & seafood" }] }] } });
  expect(listResponse.status()).toBe(201);
  const list = await listResponse.json();
  await page.goto("/library");
  const nav = page.getByRole("navigation", { name: "Kitchen modes" });
  await expect(nav.getByRole("link", { name: "Home", exact: true })).toHaveAttribute("aria-current", "page");
  await expect(nav).toHaveText("");
  await expect(page.getByRole("link", { name: "Sift home" }).locator("span")).toBeHidden();
  await fitsPhone(page);
  await page.screenshot({ animations: "disabled", path: `test-results/mobile-home-${width}.png` });
  for (const mode of ["Shop", "Cook", "Home"]) {
    await nav.getByRole("link", { name: mode, exact: true }).click();
    await expect(nav.getByRole("link", { name: mode, exact: true })).toHaveAttribute("aria-current", "page");
    await fitsPhone(page);
  }
  for (const route of [`/artifacts/${list.id}`, "/settings", "/recipes/new"]) {
    await page.goto(route);
    await fitsPhone(page);
    await page.screenshot({ animations: "disabled", path: `test-results/mobile-${route.split('/')[1]}-${width}.png` });
  }
  await page.getByRole("tab", { name: "Manual", exact: true }).click();
  const save = page.getByRole("button", { name: "Save recipe", exact: true });
  await save.scrollIntoViewIfNeeded();
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  expect((await save.boundingBox())!.y + (await save.boundingBox())!.height).toBeLessThan((await nav.boundingBox())!.y);
  await fitsPhone(page);
  await page.goto(`/recipes/${recipe.id}`);
  await fitsPhone(page);
  await expect(page.getByRole("tab", { name: "Overview", exact: true })).toHaveAttribute("aria-selected", "true");
  expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBeLessThanOrEqual(page.viewportSize()!.height);
  await page.screenshot({ animations: "disabled", path: `test-results/mobile-recipe-${width}.png` });
  const imported = await page.request.post("/api/imports", { headers, data: { kind: "paste", text: "Lemon rice\nServes: 2\nIngredients\n1 cup rice\n1 lemon\nInstructions\nCook the rice.\nAdd lemon juice and serve." } });
  expect(imported.status()).toBe(201);
  const importJob = await imported.json();
  await page.goto(`/imports/${importJob.id}`);
  await expect(page.getByRole("heading", { name: "Review your recipe." })).toBeVisible();
  await fitsPhone(page);
  const shareResponse = await page.request.post(`/api/recipes/${recipe.id}/shares`, { headers, data: { expectedVersionId: recipe.version.id, expectedCoverPhotoId: null } });
  expect(shareResponse.status()).toBe(201);
  const share = await shareResponse.json();
  await page.goto(`/share/${share.token}`);
  await expect(page.getByRole("heading", { name: recipe.version.content.title, exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  await expect(page.getByRole("navigation", { name: "Kitchen modes" })).toHaveCount(0);
  const cookResponse = await page.request.post("/api/cooking-sessions", { headers, data: { recipeId: recipe.id, expectedVersionId: recipe.version.id } });
  expect(cookResponse.status()).toBe(201);
  const cook = await cookResponse.json();
  await page.goto(`/recipes/${recipe.id}?cook=${cook.id}`);
  await fitsPhone(page);
  await expect(page.getByRole("button", { name: "Ask Sift", exact: true })).toBeHidden();
  const actions = page.getByRole("group", { name: "Cooking actions" });
  await expect(actions).toHaveCount(1);
  const actionBounds = (await actions.boundingBox())!, navBounds = (await nav.boundingBox())!;
  expect(actionBounds.y + actionBounds.height).toBeLessThan(navBounds.y);
  expect(actionBounds.y).toBeGreaterThan(page.viewportSize()!.height - 170);
  const stepCards = page.getByRole("navigation", { name: "Cooking steps" });
  await expect(stepCards).toHaveCount(1);
  const cardsBounds = (await stepCards.boundingBox())!, instructionBounds = (await page.getByRole("region", { name: "Current cooking step" }).boundingBox())!;
  expect(cardsBounds.y).toBeGreaterThanOrEqual(instructionBounds.y + instructionBounds.height);
  expect(cardsBounds.y + cardsBounds.height).toBeLessThanOrEqual(actionBounds.y);
  expect((await stepCards.getByRole("button").first().boundingBox())!.height).toBe(44);
  await actions.getByRole("button", { name: "Mark step complete", exact: true }).click();
  await expect(page.getByRole("region", { name: "Current cooking step" })).toContainText("Cook the chicken");
  await actions.getByRole("button", { name: "Stop cooking", exact: true }).click();
  await page.getByRole("dialog", { name: "Stop cooking?", exact: true }).getByRole("button", { name: "Keep cooking" }).click();
  await nav.getByRole("link", { name: "Home", exact: true }).click();
  await expect(nav.getByRole("link", { name: "Cook", exact: true })).toHaveAttribute("href", `/recipes/${recipe.id}?cook=${cook.id}`);
  await nav.getByRole("link", { name: "Cook", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`cook=${cook.id}$`));
  await expect(page.getByRole("button", { name: /^Go to step 2:/ })).toHaveAttribute("aria-current", "step");
  await expect(page.getByRole("main").getByRole("alert")).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Current cooking step" })).toContainText("Cook the chicken");
  expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBeLessThanOrEqual(page.viewportSize()!.height);
  await page.screenshot({ animations: "disabled", path: `test-results/mobile-cook-${width}.png` });
  await nav.getByRole("button", { name: "Open Sift" }).click();
  const assistant = page.getByRole("dialog", { name: "sift", exact: true });
  await expect(assistant).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Kitchen modes" })).toHaveCount(0);
  await expect(assistant.getByRole("textbox", { name: "Message Sift" })).toBeEnabled();
  await expect(assistant.getByRole("button", { name: "Talk to Sift" })).toBeVisible();
  expect(await assistant.evaluate((element) => element.scrollWidth)).toBeLessThanOrEqual(width);
  await page.screenshot({ animations: "disabled", path: `test-results/mobile-assistant-${width}.png` });
  await assistant.getByRole("button", { name: "Close Sift" }).click();
  await expect(nav.getByRole("button", { name: "Open Sift" })).toBeFocused();
});
