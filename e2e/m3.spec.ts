import type { APIRequestContext } from "@playwright/test";
import sharp from "sharp";
import { clientHeaders, expect, test } from "./fixtures";

const origin = "http://localhost:3100";
const headers = { Origin: origin };
const pasted = "Turkey Chili\nServes: 4\nIngredients\n½ cup broth\n1 14-oz can beans\n2–3 tbsp oil\nInstructions\nSimmer for twenty minutes.\nTaste and serve.";

async function signUp(request: APIRequestContext) {
  const response = await request.post(`${origin}/api/auth/sign-up/email`, { headers, data: { name: "Alex", email: `imports-${crypto.randomUUID()}@example.test`, password: "a-good-test-password-42" } });
  expect(response.ok()).toBe(true);
}

test("review a pasted import, preserve versions, share anonymously, revoke, and isolate other users", async ({ page, browser }, testInfo) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await signUp(page.request);
  await page.goto("/recipes/new");
  await page.getByRole("tab", { name: "Paste text", exact: true }).click();
  await page.getByLabel("Recipe text", { exact: true }).fill(pasted);
  await page.getByRole("button", { name: "Review recipe", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Review your recipe.", exact: true })).toBeVisible();
  await expect(page.getByLabel("Recipe title", { exact: true })).toHaveValue("Turkey Chili");
  await expect(page.getByRole("textbox", { name: "Ingredients", exact: true })).toHaveValue("½ cup broth\n1 14-oz can beans\n2–3 tbsp oil");
  const importId = page.url().split("/").at(-1)!;
  const reviewResponse = await page.request.get(`/api/imports/${importId}`);
  expect(reviewResponse.headers()["cache-control"]).toContain("no-store");
  const review = await reviewResponse.json();
  const recipeId: string = review.recipe.id;
  expect(review.recipe.status).toBe("draft");
  expect((await page.request.post(`/api/recipes/${recipeId}/shares`, { headers, data: { expectedVersionId: review.recipe.version.id, expectedCoverPhotoId: null } })).status()).toBe(400);
  expect((await page.request.post(`/api/recipes/${recipeId}/actions`, { headers, data: { action: "status", status: "active" } })).status()).toBe(400);
  await page.getByLabel("Recipe title", { exact: true }).fill("Smoky Turkey Chili");
  await page.getByRole("textbox", { name: "Ingredients", exact: true }).fill("½ cup broth\n1 14-oz can beans\n2–3 tbsp oil\n1½ tsp salt");
  await page.screenshot({ path: `test-results/import-review-${testInfo.project.name}.png`, fullPage: true });
  await page.getByRole("button", { name: "Save recipe", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Smoky Turkey Chili", exact: true })).toBeVisible();
  const saved = await (await page.request.get(`/api/recipes/${recipeId}`)).json();
  expect(saved.recipe.status).toBe("active");
  expect(saved.versions).toHaveLength(2);
  expect(saved.versions[1].content.title).toBe("Turkey Chili");
  expect(saved.versions[1].content.ingredientSections[0].items).toHaveLength(3);
  expect(saved.recipe.source.rawText).toBe(pasted);
  expect((await (await page.request.get(`/api/imports/${importId}`)).json()).status).toBe("saved");
  await page.getByRole("tab", { name: "Notes", exact: true }).click();
  await page.getByLabel("Recipe note").fill("Private note: double the salt next time.");
  await page.getByRole("button", { name: "Add note", exact: true }).click();
  await expect(page.getByText("Private note: double the salt next time.", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Share", exact: true }).click();
  await page.getByRole("button", { name: "Create link", exact: true }).click();
  const shareInput = page.getByLabel("Share link", { exact: true });
  await expect(shareInput).toHaveValue(/\/share\/[A-Za-z0-9_-]{43}$/);
  const shareUrl = await shareInput.inputValue();
  const shares = await (await page.request.get(`/api/recipes/${recipeId}/shares`)).json();
  const shareId: string = shares[0].id;
  expect(shares[0]).not.toHaveProperty("token");
  expect(shares[0]).not.toHaveProperty("tokenHash");

  const anonymous = await browser.newContext({ viewport: page.viewportSize() ?? undefined, extraHTTPHeaders: clientHeaders() });
  const other = await browser.newContext({ extraHTTPHeaders: clientHeaders() });
  try {
    const sharedPage = await anonymous.newPage();
    const response = await sharedPage.goto(shareUrl);
    expect(response?.status()).toBe(200);
    await expect(sharedPage.getByRole("heading", { name: "Smoky Turkey Chili", exact: true })).toBeVisible();
    await expect(sharedPage.getByText("1½ tsp salt", { exact: true })).toBeVisible();
    await expect(sharedPage.getByText("Private note: double the salt next time.")).toHaveCount(0);
    await expect(sharedPage.getByRole("tab", { name: "History", exact: true })).toHaveCount(0);
    await expect(sharedPage.getByRole("button", { name: "Save recipe", exact: true })).toHaveCount(0);
    await expect(sharedPage.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
    await expect(sharedPage.locator('meta[property="og:title"]')).toHaveAttribute("content", /Smoky Turkey Chili/);
    expect(await sharedPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect((await anonymous.request.get(`${origin}/api/recipes/${recipeId}`)).status()).toBe(401);
    await sharedPage.screenshot({ path: `test-results/shared-recipe-${testInfo.project.name}.png`, fullPage: true });

    await signUp(other.request);
    expect((await other.request.get(`${origin}/api/imports/${importId}`)).status()).toBe(404);
    expect((await other.request.post(`${origin}/api/imports/${importId}`, { headers, data: { content: review.recipe.version.content, expectedVersionId: review.recipe.version.id } })).status()).toBe(404);
    expect((await other.request.get(`${origin}/api/recipes/${recipeId}/shares`)).status()).toBe(404);
    expect((await other.request.post(`${origin}/api/recipes/${recipeId}/shares`, { headers, data: { expectedVersionId: saved.recipe.version.id, expectedCoverPhotoId: null } })).status()).toBe(404);
    expect((await other.request.delete(`${origin}/api/shares/${shareId}`, { headers })).status()).toBe(404);
    expect((await other.request.post(`${origin}/api/photos/uploads`, { headers, data: { purpose: "recipe", recipeId, contentType: "image/png", byteSize: 100 } })).status()).toBe(404);

    await page.getByRole("button", { name: "Close", exact: true }).click();
    await page.getByRole("button", { name: "Recipe options", exact: true }).click();
    await page.getByRole("menuitem", { name: "Rename recipe", exact: true }).click();
    await page.getByLabel("Recipe title", { exact: true }).fill("New private recipe title");
    await page.getByRole("button", { name: "Save title", exact: true }).click();
    await expect(page.getByRole("heading", { name: "New private recipe title", exact: true })).toBeVisible();
    await sharedPage.reload();
    await expect(sharedPage.getByRole("heading", { name: "Smoky Turkey Chili", exact: true })).toBeVisible();
    await expect(sharedPage.getByRole("heading", { name: "New private recipe title", exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: "Share", exact: true }).click();
    await page.getByRole("button", { name: "Revoke link", exact: true }).click();
    await page.getByRole("button", { name: "Confirm revoke", exact: true }).click();
    await expect(page.getByText("No links yet. This recipe is private.", { exact: true })).toBeVisible();
    const revokedResponse = await sharedPage.reload();
    // Next's streamed not-found pages may already have sent HTTP 200; verify
    // revoked content is absent and the actual unavailable page is rendered.
    expect(await revokedResponse!.text()).not.toContain("Smoky Turkey Chili");
    await expect(sharedPage.getByRole("heading", { name: "Nothing here just yet.", exact: true })).toBeVisible();
    await expect(sharedPage.getByText("1½ tsp salt", { exact: true })).toHaveCount(0);
    expect((await anonymous.request.get(`${shareUrl}/image`)).status()).toBe(404);
  } finally { await anonymous.close(); await other.close(); }
});

test("shows real missing-provider errors and rejects untrusted mutation requests", async ({ page }) => {
  await signUp(page.request);
  await page.goto("/recipes/new");
  await page.getByRole("tab", { name: "From a URL", exact: true }).click();
  await page.getByLabel("Recipe URL", { exact: true }).fill("http://169.254.169.254/recipe");
  await page.getByRole("button", { name: "Review recipe", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Private network" })).toBeVisible();
  await page.getByLabel("Recipe URL", { exact: true }).fill("https://example.com/recipe");
  const importFailure = page.waitForResponse((response) => response.url().endsWith("/api/imports") && response.request().method() === "POST");
  await page.getByRole("button", { name: "Review recipe", exact: true }).click();
  expect((await importFailure).status()).toBe(503);
  await expect(page.getByRole("alert").filter({ hasText: "INNGEST_EVENT_KEY" })).toBeVisible();
  await page.getByRole("tab", { name: "From a photo", exact: true }).click();
  // Real browser decoding/compression; the request reaches the real API and
  // fails clearly at server configuration, without fake upload endpoints.
  const png = await sharp({ create: { width: 20, height: 20, channels: 3, background: "#888888" } }).png().toBuffer();
  await page.getByLabel("Recipe photo", { exact: true }).setInputFiles({ name: "recipe.png", mimeType: "image/png", buffer: png });
  const uploadFailure = page.waitForResponse((response) => response.url().endsWith("/api/photos/uploads") && response.request().method() === "POST");
  await page.getByRole("button", { name: "Upload & review", exact: true }).click();
  expect((await uploadFailure).status()).toBe(503);
  await expect(page.getByRole("alert").filter({ hasText: "R2_ACCOUNT_ID" })).toBeVisible();
  expect((await page.request.post("/api/imports", { headers: { Origin: "https://attacker.example" }, data: { kind: "paste", text: pasted } })).status()).toBe(400);
  expect((await page.request.post("/api/imports", { headers: { ...headers, "Content-Type": "application/json" }, data: "{" })).status()).toBe(400);
  expect((await page.request.post("/api/imports", { headers, data: { kind: "paste", text: "x".repeat(300000) } })).status()).toBe(400);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
