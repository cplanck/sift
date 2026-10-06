import { expect, test } from "./fixtures";

test("brand shell is accessible and responsive", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Sift", exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.goto("/sign-in");
  await expect(page.getByRole("link", { name: "Sift home" })).toBeVisible();
  await page.getByRole("button", { name: "Change color theme" }).click();
  await expect(page.locator("html")).toHaveClass(/dark/);
});

test("install metadata, icons, and offline fallback work", async ({ page, context, request }) => {
  const response = await request.get("/manifest.webmanifest");
  const manifest = await response.json();
  expect(manifest.display).toBe("standalone");
  for (const icon of manifest.icons) expect((await request.get(icon.src)).ok()).toBe(true);
  await page.goto("/");
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await page.reload();
  await context.setOffline(true);
  await page.goto("/unavailable-offline");
  await expect(page.getByRole("heading", { name: "You’re offline." })).toBeVisible();
  await context.setOffline(false);
});
