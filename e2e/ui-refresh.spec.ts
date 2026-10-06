import type { APIRequestContext } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { Pool } from "pg";
import { testDatabaseUrl } from "../tests/database";
import { clientHeaders, expect, test } from "./fixtures";

const origin = "http://localhost:3100", headers = { Origin: origin };
async function signUp(request: APIRequestContext) {
  const response = await request.post(`${origin}/api/auth/sign-up/email`, { headers, data: { name: "Avery", email: `ui-${crypto.randomUUID()}@example.test`, password: "a-good-test-password-42" } });
  expect(response.ok()).toBe(true);
  return (await response.json()).user as { id: string };
}
async function addRecipe(request: APIRequestContext, title: string, tags: string[] = ["Weeknight"]) {
  const response = await request.post(`${origin}/api/recipes`, { headers, data: { content: {
    title, description: "A favorite worth making again.", totalMinutes: 30, tags,
    ingredientSections: [{ name: "", items: [{ text: "1 lemon" }, { text: "2 tbsp olive oil" }] }],
    instructionSections: [{ name: "", steps: ["Prepare the ingredients.", "Cook and serve."] }],
  } } });
  expect(response.status()).toBe(201);
  return await response.json() as { id: string };
}

test("centered recipe library, stock photos, grid/list layouts, search and workspace-scoped imagery", async ({ page, browser }, testInfo) => {
  await page.emulateMedia({ colorScheme: "dark" });
  const user = await signUp(page.request);
  const recipe = await addRecipe(page.request, "Chicken Piccata", ["Italian", "Weeknight"]);
  for (const [title, tags] of [["Turkey Chili", ["Comfort food"]], ["Spaghetti Carbonara", ["Italian"]], ["Sourdough Bread", ["Baking"]], ["Roasted Vegetables", ["Vegetarian"]], ["Lemon Salmon", ["Weeknight"]]] as const) await addRecipe(page.request, title, [...tags]);
  await page.goto("/library");
  await expect(page.getByRole("complementary")).toHaveCount(0);
  await expect(page.locator("#all-recipes article")).toHaveCount(6);
  await expect(page.getByRole("heading", { name: "Recently added", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Open search", exact: true }).click();
  await page.getByRole("button", { name: "Vegetarian", exact: true }).click();
  await expect(page.locator("#all-recipes article")).toHaveCount(1);
  await expect(page.getByRole("article", { name: "Roasted Vegetables recipe", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Vegetarian", exact: true }).click();
  await page.getByRole("button", { name: "< 30 min", exact: true }).click();
  await expect(page.getByRole("heading", { name: "No recipes found.", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Clear filters", exact: true }).click();
  await expect(page.locator("#all-recipes article")).toHaveCount(6);
  await page.getByRole("button", { name: "Recent", exact: true }).click();
  await expect(page.locator("#all-recipes article")).toHaveCount(6);
  await page.getByRole("button", { name: /^All/ }).click();
  const card = page.getByRole("article", { name: "Chicken Piccata recipe", exact: true });
  await card.scrollIntoViewIfNeeded();
  await expect(card.locator("img")).toHaveAttribute("src", /(?:\/stock\/chicken\.webp|url=%2Fstock%2Fchicken\.webp)/);
  await expect.poll(() => card.locator("img").evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true);
  await expect(card.getByRole("link", { name: /Stock photo by .* on Pexels/ })).toHaveCount(0);
  expect((await page.request.get(`/api/recipes/${recipe.id}/stock-photo`)).headers()["cache-control"]).toContain("no-store");
  await page.screenshot({ path: `test-results/ui-library-${testInfo.project.name}.png`, fullPage: true });
  await page.getByRole("button", { name: "List view", exact: true }).click();
  await expect(page.getByRole("button", { name: "List view", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(card.getByRole("heading", { name: "Chicken Piccata", exact: true })).toBeVisible();
  await card.getByRole("button", { name: "Add to favorites", exact: true }).click();
  await expect(card.getByRole("button", { name: "Remove from favorites", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "Filter favorites", exact: true }).click();
  await expect(page.locator("#all-recipes article")).toHaveCount(1);
  await page.getByRole("button", { name: "Grid view", exact: true }).click();
  await expect(card.locator("img")).toBeVisible();
  await page.getByRole("button", { name: "Open search", exact: true }).click();
  await page.getByRole("textbox", { name: "Search recipes", exact: true }).fill("lemon");
  await expect(card).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const other = await browser.newContext({ extraHTTPHeaders: clientHeaders() });
  try {
    await signUp(other.request);
    expect((await other.request.get(`${origin}/api/recipes/${recipe.id}/stock-photo`)).status()).toBe(404);
  } finally { await other.close(); }
  // Only image delivery is replaced. The real database owns the uploaded
  // cover, and the authenticated stock endpoint must respect that choice.
  const photoId = crypto.randomUUID(), pool = new Pool({ connectionString: testDatabaseUrl });
  try {
    await pool.query("INSERT INTO photos (id,workspace_id,recipe_id,purpose,status,object_key,content_type,byte_size,width,height,created_by_user_id) SELECT $1,workspace_id,id,'recipe','ready',$2,'image/png',68,1,1,$3 FROM recipes WHERE id=$4", [photoId, `ui-test/${photoId}`, user.id, recipe.id]);
    await pool.query("UPDATE recipes SET cover_photo_id=$1 WHERE id=$2", [photoId, recipe.id]);
  } finally { await pool.end(); }
  await page.route(`**/api/photos/${photoId}`, (route) => route.fulfill({ contentType: "image/png", body: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=", "base64") }));
  await page.reload();
  await expect(card.locator("img")).toHaveAttribute("src", new RegExp(`/api/photos/${photoId}$`));
  await expect(card.getByRole("link", { name: /Stock photo by/ })).toHaveCount(0);
  expect(await (await page.request.get(`/api/recipes/${recipe.id}/stock-photo`)).json()).toEqual({ photo: null });
});

test("voice is the default launcher action and the chevron preserves text drafts", async ({ page }, testInfo) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await signUp(page.request);
  await page.goto("/library");
  expect(await (await page.request.get("/api/conversations")).json()).toEqual([]);
  const voiceStatus = page.waitForResponse((response) => response.url().endsWith("/api/voice/status"));
  await page.getByRole("button", { name: "Start voice with Sift", exact: true }).click();
  expect((await voiceStatus).ok()).toBe(true);
  await expect(page.getByRole("region", { name: "Sift voice", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Voice controls", exact: true }).click();
  const voice = page.getByRole("region", { name: "Sift voice", exact: true });
  await expect(voice.getByRole("alert")).toBeVisible();
  await expect(page.getByRole("dialog", { name: "sift", exact: true })).toHaveCount(0);
  await voice.getByRole("button", { name: "Use text", exact: true }).click();
  const panel = page.getByRole("dialog", { name: "sift", exact: true });
  await expect(panel.getByRole("textbox", { name: "Message Sift", exact: true })).toBeEnabled();
  await panel.getByRole("button", { name: "Build a grocery list", exact: true }).click();
  await expect(panel.getByRole("textbox", { name: "Message Sift", exact: true })).toHaveValue("Help me build a grocery list from my recipes.");
  await page.screenshot({ path: `test-results/ui-chat-${testInfo.project.name}.png` });
  await panel.getByRole("button", { name: "Close Sift", exact: true }).click();
  await page.getByRole("button", { name: "Open Sift", exact: true }).click();
  await expect(panel.getByRole("textbox", { name: "Message Sift", exact: true })).toHaveValue("Help me build a grocery list from my recipes.");
  await expect(panel.getByRole("button", { name: "Conversation settings", exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const bounds = await panel.boundingBox();
  expect(bounds!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  if (testInfo.project.name === "desktop") expect(bounds!.y).toBeGreaterThan(0);
});

test.describe("isolated stock metadata boundary", () => {
  test.use({ serviceWorkers: "block" });
  test("saved stock photos survive reloads without searching again", async ({ page }) => {
    await signUp(page.request);
    const recipe = await addRecipe(page.request, "Saved Lemon Chicken");
    const photo = { provider: "Unsplash", src: "https://images.unsplash.com/photo-saved-test?ixid=original", alt: "Saved chicken photo", photographer: "Photographer", url: "https://unsplash.com/photos/saved-test", photographerUrl: "https://unsplash.com/@cook" };
    const pool = new Pool({ connectionString: testDatabaseUrl });
    try {
      await pool.query("INSERT INTO recipe_stock_photos (recipe_id,workspace_id,photo) SELECT id,workspace_id,$1::jsonb FROM recipes WHERE id=$2", [JSON.stringify(photo), recipe.id]);
    } finally { await pool.end(); }
    let searches = 0;
    await page.route(`**/api/recipes/${recipe.id}/stock-photo`, (route) => { searches++; return route.abort(); });
    const imageFixture = await readFile("public/stock/chicken.webp");
    await page.route("https://images.unsplash.com/**", (route) => route.fulfill({ contentType: "image/webp", body: imageFixture }));
    await page.goto("/library");
    const card = page.getByRole("article", { name: "Saved Lemon Chicken recipe", exact: true });
    await expect(card.locator("img")).toHaveAttribute("src", photo.src);
    await page.reload();
    await expect(card.locator("img")).toHaveAttribute("src", photo.src);
    await page.goto(`/recipes/${recipe.id}`);
    await expect(page.getByRole("main").getByRole("img", { name: `Stock photo: ${photo.alt}`, exact: true })).toHaveAttribute("src", photo.src);
    expect(searches).toBe(0);
    expect(await (await page.request.get(`/api/recipes/${recipe.id}/stock-photo`)).json()).toEqual({ photo });
  });
  test("Unsplash images preserve hotlinks with credits hidden during prototyping", async ({ page }, testInfo) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await signUp(page.request);
    const recipe = await addRecipe(page.request, "Lemon Chicken");
    const photo = { provider: "Unsplash", src: "https://images.unsplash.com/photo-ui-test?ixid=sift-view-test&w=1080", alt: "A plate of lemon chicken", photographer: "Food Photographer", url: "https://unsplash.com/photos/ui-test?utm_source=sift&utm_medium=referral", photographerUrl: "https://unsplash.com/@food_photographer?utm_source=sift&utm_medium=referral" };
    let requests = 0;
    await page.route(`**/api/recipes/${recipe.id}/stock-photo`, (route) => { requests += 1; return route.fulfill({ json: { photo } }); });
    const imageFixture = await readFile("public/stock/chicken.webp");
    await page.route("https://images.unsplash.com/**", (route) => route.fulfill({ contentType: "image/webp", body: imageFixture }));
    await page.goto("/library");
    const card = page.getByRole("article", { name: "Lemon Chicken recipe", exact: true });
    await card.scrollIntoViewIfNeeded();
    const photographer = card.getByRole("link", { name: "Stock photo by Food Photographer on Unsplash", exact: true });
    await expect(card.locator("img")).toHaveAttribute("src", photo.src);
    await expect.poll(() => card.locator("img").evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true);
    await expect(photographer).toHaveCount(0);
    await expect(card.getByRole("link", { name: "Unsplash", exact: true })).toHaveCount(0);
    expect(requests).toBe(1);
    await page.getByRole("button", { name: "List view", exact: true }).click();
    await expect(photographer).toHaveCount(0);
    await expect(card.getByRole("link", { name: "Unsplash", exact: true })).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `test-results/unsplash-list-${testInfo.project.name}.png` });
    await card.getByRole("link", { name: "Lemon Chicken", exact: true }).last().click();
    await expect(page).toHaveURL(`${origin}/recipes/${recipe.id}`);
    const main = page.getByRole("main");
    await expect(main.getByRole("heading", { name: "Lemon Chicken", level: 1, exact: true })).toBeVisible();
    await expect(main.getByRole("img", { name: `Stock photo: ${photo.alt}`, exact: true })).toHaveAttribute("src", photo.src);
    await expect(main.getByRole("link", { name: "Stock photo by Food Photographer on Unsplash", exact: true })).toHaveCount(0);
    await expect(main.getByRole("link", { name: "Unsplash", exact: true })).toHaveCount(0);
  });
});

test.describe("isolated chat provider boundary", () => {
  test.use({ serviceWorkers: "block" });
  test("optimistic send, thinking, safe Markdown, copy and cancellation", async ({ page, context }, testInfo) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await signUp(page.request);
    await page.goto("/library");
    await page.getByRole("button", { name: "Open Sift", exact: true }).click();
    const panel = page.getByRole("dialog", { name: "sift", exact: true });
    await expect(panel.getByRole("textbox", { name: "Message Sift", exact: true })).toBeEnabled();
    let release!: () => void;
    let responseGate = new Promise<void>((resolve) => { release = resolve; });
    const answer = "## A brighter bowl\n\nTry **fresh lemon** and a little olive oil.\n\n- Add zest at the end.\n- Taste before serving.\n\n| Ingredient | Amount |\n| --- | --- |\n| Lemon | 1 |\n\n[Your cookbook](/library)\n\n![Remote image](https://tracking.example.test/pixel.png)\n\n[Unsafe](javascript:alert(1))\n\n<script>window.untrustedMarkdownExecuted = true</script>";
    await page.route("**/api/assistant", async (route) => {
      await responseGate;
      const chunks = [{ type: "start", messageId: crypto.randomUUID() }, { type: "text-start", id: "text" }, { type: "text-delta", id: "text", delta: answer }, { type: "text-end", id: "text" }, { type: "finish" }];
      await route.fulfill({ status: 200, headers: { "Content-Type": "text/event-stream", "x-vercel-ai-ui-message-stream": "v1" }, body: chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("") + "data: [DONE]\n\n" }).catch(() => undefined);
    });
    await panel.getByRole("textbox", { name: "Message Sift", exact: true }).fill("How can I brighten this soup?");
    await panel.getByRole("button", { name: "Send message", exact: true }).click();
    await expect(panel.getByRole("article", { name: "Your message", exact: true })).toContainText("How can I brighten this soup?");
    await expect(panel.getByRole("textbox", { name: "Message Sift", exact: true })).toHaveValue("");
    await expect(panel.getByRole("status").filter({ hasText: "Thinking…" })).toBeVisible();
    await expect(panel.getByRole("button", { name: "Stop generating", exact: true })).toBeVisible();
    await page.screenshot({ path: `test-results/ui-thinking-${testInfo.project.name}.png` });
    release();
    await expect(panel.getByRole("heading", { name: "A brighter bowl", exact: true })).toBeVisible();
    await expect(panel.getByRole("table")).toBeVisible();
    await expect(panel.locator("strong")).toHaveText("fresh lemon");
    await expect(panel.locator("img, script")).toHaveCount(0);
    await expect(panel.getByRole("link", { name: "Unsafe", exact: true })).toHaveCount(0);
    await expect(panel.getByRole("link", { name: "Your cookbook", exact: true })).toHaveAttribute("href", "/library");
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await panel.getByRole("button", { name: "Copy response", exact: true }).click();
    await expect(panel.getByRole("button", { name: "Response copied", exact: true })).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toContain("fresh lemon");
    await page.screenshot({ path: `test-results/ui-markdown-${testInfo.project.name}.png` });
    responseGate = new Promise<void>((resolve) => { release = resolve; });
    await panel.getByRole("textbox", { name: "Message Sift", exact: true }).fill("One more idea");
    await panel.getByRole("button", { name: "Send message", exact: true }).click();
    await expect(panel.getByRole("button", { name: "Stop generating", exact: true })).toBeVisible();
    await panel.getByRole("button", { name: "Stop generating", exact: true }).click();
    release();
    await expect(panel.getByRole("button", { name: "Stop generating", exact: true })).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
});
