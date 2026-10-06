import { expect, test } from "./fixtures";

test("sign up, personal workspace, sign out and sign in", async ({ page }) => {
  const email = `cook-${crypto.randomUUID()}@example.test`;
  const password = "a-good-test-password-42";
  await page.goto("/sign-in");
  await page.getByRole("button", { name: "New here? Create an account" }).click();
  await page.getByLabel("Your name").fill("Alex Cook");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Create cookbook", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Search recipes", exact: true })).toBeVisible();
  const me = await (await page.request.get("/api/me?workspaceId=ignored-client-value")).json();
  expect(me.workspace.personalForUserId).toBe(me.userId);
  expect(me.workspaceId).toBe(me.workspace.id);
  await page.getByLabel("Your account", { exact: true }).click();
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page.getByRole("heading", { name: /Good food/ })).toBeVisible();
  expect((await page.request.get("/api/me")).status()).toBe(401);
  await page.goto("/library");
  await expect(page).toHaveURL(/sign-in/);
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Search recipes", exact: true })).toBeVisible();
  expect((await (await page.request.get("/api/me")).json()).workspaceId).toBe(me.workspaceId);
});
