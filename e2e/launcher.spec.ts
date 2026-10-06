import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";

const headers = { Origin: "http://localhost:3100" };
async function signUp(page: Page) {
  const response = await page.request.post("/api/auth/sign-up/email", { headers, data: { name: "Launcher cook", email: `launcher-${crypto.randomUUID()}@example.test`, password: "a-good-test-password-42" } });
  expect(response.ok()).toBe(true);
}

test("one Sift launcher opens the conversation and docks live voice beside it", async ({ page }, info) => {
  await signUp(page);
  await page.route("**/api/voice/status", (route) => route.fulfill({ json: { configured: false, message: "Voice is not configured for this test deployment." } }));
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    await page.goto("/library");
    const launcher = page.getByRole("group", { name: "Sift controls", exact: true });
    await expect(launcher.getByRole("button", { name: "Open Sift", exact: true })).toBeVisible();
    await expect(launcher.getByRole("button", { name: "Start voice with Sift", exact: true })).toBeVisible();
    await expect(launcher.getByRole("status")).toHaveCount(0);
    await launcher.screenshot({ path: `test-results/launcher-${info.project.name}-${colorScheme}-idle.png`, animations: "disabled" });
    await page.screenshot({ path: `test-results/launcher-${info.project.name}-${colorScheme}-page.png`, animations: "disabled" });
    await launcher.getByRole("button", { name: "Start voice with Sift", exact: true }).click();
    await expect(launcher.getByRole("status")).toHaveText("Voice unavailable");
    await expect(launcher.getByRole("button", { name: "Voice controls", exact: true })).toBeVisible();
    await launcher.screenshot({ path: `test-results/launcher-${info.project.name}-${colorScheme}-error.png`, animations: "disabled" });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await launcher.getByRole("button", { name: "Open Sift", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "sift", exact: true })).toBeVisible();
    await expect(launcher).toBeHidden();
  }
});
