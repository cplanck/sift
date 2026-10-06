import { randomUUID } from "node:crypto";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { Pool } from "pg";
import { testDatabaseUrl } from "../tests/database";
import { expect, test } from "./fixtures";

test("dev sync previews changes, applies and refreshes the library", async ({ page }) => {
  const origin = "http://localhost:3100";
  const signup = await page.request.post("/api/auth/sign-up/email", { headers: { Origin: origin }, data: { name: "Dev Cook", email: `dev-sync-${randomUUID()}@example.test`, password: "a-good-test-password-42" } });
  expect(signup.ok()).toBe(true);
  const { user } = await signup.json();
  const pool = new Pool({ connectionString: testDatabaseUrl });
  let directory = "";
  try {
    const workspaceId = (await pool.query("SELECT id FROM workspaces WHERE personal_for_user_id=$1", [user.id])).rows[0].id;
    directory = join(process.cwd(), ".local/production-sync", `${randomUUID()}-${workspaceId}`);
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, "state.json"), JSON.stringify({ targetWorkspaceId: workspaceId }));
    let release!: () => void;
    const preview = new Promise<void>((resolve) => { release = resolve; });
    await page.route("**/api/dev/production-sync", async (route) => {
      const { apply } = route.request().postDataJSON();
      if (!apply) await preview;
      if (apply) {
        const added = await page.request.post("/api/recipes", { headers: { Origin: origin }, data: { content: { title: "Recipe from production", ingredientSections: [{ name: "", items: [{ text: "1 lemon" }] }], instructionSections: [{ name: "", steps: ["Prepare and serve."] }] } } });
        expect(added.status()).toBe(201);
      }
      await route.fulfill({ json: { applied: apply, summary: { recipes: { insert: 1, update: 0, unchanged: 0, conflict: 0 } }, conflicts: [] } });
    });
    await page.goto("/library");
    await page.getByLabel("Your account", { exact: true }).click();
    await page.getByRole("button", { name: "Sync from prod", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Sync from production", exact: true });
    await expect(dialog.getByRole("status")).toHaveText("Checking production for changes…");
    release();
    await expect(dialog.getByRole("status")).toContainText("1 change ready to sync.");
    await dialog.getByRole("button", { name: "Sync changes", exact: true }).click();
    await expect(dialog.getByRole("status")).toContainText("Sync complete.");
    await dialog.getByRole("button", { name: "Close", exact: true }).last().click();
    await expect(page.getByRole("article", { name: "Recipe from production recipe", exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  } finally {
    await pool.end();
    if (directory) await rm(directory, { recursive: true, force: true });
  }
});
