import type { APIRequestContext, Page } from "@playwright/test";
import { Pool } from "pg";
import { testDatabaseUrl } from "../tests/database";
import { expect, test } from "./fixtures";

const origin = "http://localhost:3100", headers = { Origin: origin };
const content = {
  title: "Offline lemon soup", description: "<img src=x onerror=alert('unsafe')> is plain recipe text.", servings: 4,
  ingredientSections: [{ name: "Soup", items: [{ text: "2 cups broth" }, { text: "1 lemon" }] }],
  instructionSections: [{ name: "", steps: ["Warm the broth.", "Add lemon and serve."] }], tags: [], collections: [],
};
async function signUp(request: APIRequestContext) {
  const response = await request.post(`${origin}/api/auth/sign-up/email`, { headers, data: { name: "Offline cook", email: `offline-${crypto.randomUUID()}@example.test`, password: "a-good-test-password-42" } });
  expect(response.ok()).toBe(true);
  return (await response.json()).user as { id: string };
}
async function createRecipe(request: APIRequestContext, title = content.title) {
  const response = await request.post(`${origin}/api/recipes`, { headers, data: { content: { ...content, title }, source: { type: "manual" }, status: "active" } });
  expect(response.status()).toBe(201);
  return await response.json() as { id: string; version: { id: string; content: typeof content } };
}
async function snapshot(page: Page, key: string) {
  return page.evaluate(async (key) => {
    return new Promise<{ versionId: string; coverSize: number; checkedIngredients?: string[] } | null>((resolve, reject) => {
      const request = indexedDB.open("sift-offline-v1", 1);
      // Observing the cache must not create an empty version-1 database before
      // the application has installed its stores during hydration.
      request.onupgradeneeded = () => request.transaction?.abort();
      request.onsuccess = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains("snapshots")) { db.close(); resolve(null); return; }
        const row = db.transaction("snapshots").objectStore("snapshots").get(key);
        row.onsuccess = () => { resolve(row.result ? { versionId: row.result.versionId, coverSize: row.result.cover?.size ?? 0, checkedIngredients: row.result.cooking?.checkedIngredients } : null); db.close(); };
        row.onerror = () => { reject(row.error); db.close(); };
      };
      request.onerror = () => request.error?.name === "AbortError" ? resolve(null) : reject(request.error);
    });
  }, key);
}
async function ready(page: Page) {
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
}

test("offline navigation preserves exact cooking versions, scaled amounts, cover and read-only progress", async ({ page, context }, testInfo) => {
  test.setTimeout(60000);
  const user = await signUp(page.request), recipe = await createRecipe(page.request), photoId = crypto.randomUUID();
  // The storage provider is replaced only for image bytes; the UI still fetches
  // its normal authenticated photo URL and saves a Blob, never an API response.
  const pool = new Pool({ connectionString: testDatabaseUrl });
  try {
    await pool.query("INSERT INTO photos (id,workspace_id,recipe_id,purpose,status,object_key,content_type,byte_size,width,height,created_by_user_id) SELECT $1,workspace_id,id,'recipe','ready',$2,'image/png',68,1,1,$3 FROM recipes WHERE id=$4", [photoId, `offline-test/${photoId}`, user.id, recipe.id]);
    await pool.query("UPDATE recipes SET cover_photo_id=$1 WHERE id=$2", [photoId, recipe.id]);
  } finally { await pool.end(); }
  await page.route(`**/api/photos/${photoId}`, (route) => route.fulfill({ contentType: "image/png", body: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=", "base64") }));
  await page.goto(`/recipes/${recipe.id}`);
  await expect.poll(async () => (await snapshot(page, `recipe:${recipe.id}`))?.coverSize ?? 0).toBeGreaterThan(0);
  await ready(page);
  const start = await page.request.post("/api/cooking-sessions", { headers, data: { recipeId: recipe.id, expectedVersionId: recipe.version.id, servings: 8 } });
  expect(start.status()).toBe(201);
  const session = await start.json();
  expect((await page.request.patch(`/api/cooking-sessions/${session.id}`, { headers, data: { expectedRevision: session.revision, progress: { checkedIngredients: ["0:0"], checkedSteps: [], currentStep: 1 } } })).ok()).toBe(true);
  const edited = await page.request.patch(`/api/recipes/${recipe.id}`, { headers, data: { expectedVersionId: recipe.version.id, content: { ...recipe.version.content, title: "New canonical soup" }, changeSummary: "A newer canonical title" } });
  expect(edited.ok()).toBe(true);
  const newer = await edited.json();
  await page.goto(`/recipes/${recipe.id}`);
  await expect.poll(async () => (await snapshot(page, `recipe:${recipe.id}`))?.versionId).toBe(newer.id);
  await page.goto(`/recipes/${recipe.id}?cook=${session.id}`);
  await expect.poll(async () => (await snapshot(page, `cooking:${session.id}`))?.versionId).toBe(recipe.version.id);
  await expect.poll(async () => (await snapshot(page, `cooking:${session.id}`))?.coverSize ?? 0).toBeGreaterThan(0);
  await context.setOffline(true);
  await page.goto(`/recipes/${recipe.id}?cook=${session.id}`);
  await expect(page.locator(".offline-notice")).toContainText("not saved or synced");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(content.title);
  await expect(page.getByText("4 cups broth", { exact: true })).toBeVisible();
  await expect(page.getByText(content.description, { exact: true })).toBeVisible();
  expect(await page.locator("main img").count()).toBe(1); // Text above must never become HTML.
  expect(await page.locator("img.cover").evaluate((image) => (image as HTMLImageElement).naturalWidth)).toBe(1);
  await expect(page.getByRole("checkbox").first()).toBeChecked();
  await page.getByRole("checkbox").nth(1).check();
  await page.reload();
  await expect(page.getByRole("checkbox").nth(1)).not.toBeChecked();
  await expect(page.getByRole("checkbox").first()).toBeChecked();
  await page.screenshot({ path: `test-results/offline-cooking-${testInfo.project.name}.png` });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.goto(`/recipes/${recipe.id}`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("New canonical soup");
  await page.goto(`/recipes/${recipe.id}?cook=${crypto.randomUUID()}`);
  await expect(page.getByText(/exact cooking session is not saved/)).toBeVisible();
  const cacheUrls = await page.evaluate(async () => (await Promise.all((await caches.keys()).map(async (name) => (await (await caches.open(name)).keys()).map((request) => new URL(request.url).pathname)))).flat());
  expect(cacheUrls.some((path) => path.startsWith("/api/") || path.startsWith("/recipes/"))).toBe(false);
  await context.setOffline(false);
  expect((await (await page.request.get(`/api/cooking-sessions/${session.id}`)).json()).progress.checkedIngredients).toEqual(["0:0"]);
});

test("sign-out clears local recipes and open fallback tabs, and account switching cannot revive the prior cache", async ({ page, context }) => {
  test.setTimeout(60000);
  await signUp(page.request);
  const first = await createRecipe(page.request, "First account private recipe");
  await page.goto(`/recipes/${first.id}`);
  await expect.poll(async () => !!await snapshot(page, `recipe:${first.id}`)).toBe(true);
  await ready(page);
  const savedPage = await context.newPage();
  await savedPage.goto("/offline.html");
  await expect(savedPage.getByRole("link", { name: /First account private recipe/ })).toBeVisible();
  await page.bringToFront();
  await page.getByLabel("Your account", { exact: true }).click();
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(savedPage.getByRole("heading", { level: 1 })).toHaveText("You’re offline.");
  expect(await snapshot(savedPage, `recipe:${first.id}`)).toBeNull();
  await signUp(page.request);
  const second = await createRecipe(page.request, "Second account recipe");
  await page.goto(`/recipes/${second.id}`);
  await expect.poll(async () => !!await snapshot(page, `recipe:${second.id}`)).toBe(true);
  expect(await snapshot(page, `recipe:${first.id}`)).toBeNull();
  await context.setOffline(true);
  await savedPage.goto("/offline.html");
  await expect(savedPage.getByRole("link", { name: /Second account recipe/ })).toBeVisible();
  await expect(savedPage.getByText("First account private recipe", { exact: false })).toHaveCount(0);
  await savedPage.goto(`/recipes/${first.id}`);
  await expect(savedPage.getByText(/not saved on this device/)).toBeVisible();
  await context.setOffline(false);
});

test("expired authentication scope is unreadable offline and never appears on unrelated public routes", async ({ page, context }) => {
  await signUp(page.request);
  const recipe = await createRecipe(page.request);
  await page.goto(`/recipes/${recipe.id}`);
  await expect.poll(async () => !!await snapshot(page, `recipe:${recipe.id}`)).toBe(true);
  await ready(page);
  await context.setOffline(true);
  await page.goto("/share/unavailable-public-link");
  await expect(page.getByText("This page needs a connection.", { exact: false })).toBeVisible();
  await expect(page.getByText(content.title, { exact: true })).toHaveCount(0);
  await page.evaluate(async () => {
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open("sift-offline-v1", 1);
      request.onsuccess = () => {
        const db = request.result, tx = db.transaction("meta", "readwrite"), store = tx.objectStore("meta"), active = store.get("active");
        active.onsuccess = () => store.put({ ...active.result, expiresAt: Date.now() - 1 }, "active");
        tx.oncomplete = () => { db.close(); resolve(); }; tx.onerror = () => { db.close(); reject(tx.error); };
      };
    });
  });
  await page.goto(`/recipes/${recipe.id}`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("You’re offline.");
  await expect(page.getByText(content.title, { exact: true })).toHaveCount(0);
  expect(await snapshot(page, `recipe:${recipe.id}`)).toBeNull();
  await context.setOffline(false);
});
