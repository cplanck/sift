import type { APIRequestContext, Page } from "@playwright/test";
import type { UIMessage } from "ai";
import { Pool } from "pg";
import { testDatabaseUrl } from "../tests/database";
import { clientHeaders, expect, test } from "./fixtures";

const origin = "http://localhost:3100", headers = { Origin: origin };
const haiku = "anthropic/claude-haiku-4.5", sonnet = "anthropic/claude-sonnet-5.5";
async function signUp(request: APIRequestContext) {
  const response = await request.post(`${origin}/api/auth/sign-up/email`, { headers, data: { name: "Model chooser", email: `model-${crypto.randomUUID()}@example.test`, password: "a-good-test-password-42" } });
  expect(response.ok()).toBe(true);
}
async function openSift(page: Page) {
  await page.getByRole("button", { name: "Open Sift", exact: true }).click();
  const panel = page.getByRole("dialog", { name: "sift", exact: true });
  await expect(panel.getByRole("button", { name: /^Assistant model: / })).toBeVisible();
  return panel;
}
async function currentConversation(request: APIRequestContext) {
  const records = await (await request.get("/api/conversations")).json() as { id: string }[];
  expect(records).toHaveLength(1);
  return records[0].id;
}

test("model selection persists per conversation through reload and history, and can return to the app default", async ({ page }, testInfo) => {
  await signUp(page.request);
  const modelsResponse = await page.request.get("/api/assistant/models");
  expect(modelsResponse.headers()["cache-control"]).toContain("no-store");
  const models = await modelsResponse.json() as { defaultId: string; options: { id: string; label: string }[] };
  const defaultLabel = models.options.find((option) => option.id === models.defaultId)?.label ?? models.defaultId;
  expect(models.options).toEqual(expect.arrayContaining([expect.objectContaining({ id: haiku, label: "Claude Haiku 4.5" })]));
  await page.goto("/library");
  let panel = await openSift(page);
  await panel.getByRole("button", { name: `Assistant model: ${defaultLabel}`, exact: true }).click();
  await expect(page.getByRole("menuitemradio", { name: "App default", exact: true })).toBeChecked();
  await page.getByRole("menuitemradio", { name: /^Claude Haiku 4\.5/ }).click();
  await expect(panel.getByRole("button", { name: "Assistant model: Claude Haiku 4.5", exact: true })).toBeEnabled();
  const id = await currentConversation(page.request);
  expect((await (await page.request.get(`/api/conversations/${id}`)).json()).modelId).toBe(haiku);
  expect((await page.request.patch(`/api/conversations/${id}`, { headers, data: { title: "Quick dinner ideas" } })).ok()).toBe(true);
  await page.reload();
  panel = await openSift(page);
  await expect(panel.getByRole("button", { name: "Assistant model: Claude Haiku 4.5", exact: true })).toBeEnabled();
  await panel.getByRole("button", { name: "New conversation", exact: true }).click();
  await expect(panel.getByRole("button", { name: `Assistant model: ${defaultLabel}`, exact: true })).toBeEnabled();
  await panel.getByRole("button", { name: "Conversation history", exact: true }).click();
  await panel.getByRole("button", { name: /Quick dinner ideas/ }).click();
  await panel.getByRole("button", { name: "Assistant model: Claude Haiku 4.5", exact: true }).click();
  await expect(page.getByRole("menuitemradio", { name: /^Claude Haiku 4\.5/ })).toBeChecked();
  await page.screenshot({ path: `test-results/model-selector-${testInfo.project.name}.png` });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole("menuitemradio", { name: "App default", exact: true }).click();
  await expect(panel.getByRole("button", { name: `Assistant model: ${defaultLabel}`, exact: true })).toBeEnabled();
  expect((await (await page.request.get(`/api/conversations/${id}`)).json()).modelId).toBeNull();
});

test("a rejected model change shows its error and reconciles the saved choice without overwriting another window", async ({ page }, testInfo) => {
  await signUp(page.request);
  await page.goto("/library");
  const panel = await openSift(page), id = await currentConversation(page.request);
  await expect(panel.getByRole("button", { name: /^Assistant model: Claude / })).toBeEnabled();
  // Simulate a second window's real save while this panel still has the default.
  expect((await page.request.patch(`/api/conversations/${id}/model`, { headers, data: { modelId: sonnet, expectedModelId: null } })).status()).toBe(200);
  await panel.getByRole("button", { name: /^Assistant model: / }).click();
  const rejected = page.waitForResponse((response) => response.url().endsWith(`/api/conversations/${id}/model`) && response.request().method() === "PATCH");
  await page.getByRole("menuitemradio", { name: /^Claude Haiku 4\.5/ }).click();
  expect((await rejected).status()).toBe(409);
  await expect(panel.getByRole("alert").filter({ hasText: "The model changed in another window" })).toBeVisible();
  await expect(panel.getByRole("button", { name: "Assistant model: Claude Sonnet 5.5", exact: true })).toBeEnabled();
  await page.screenshot({ path: `test-results/model-conflict-${testInfo.project.name}.png` });
  expect((await (await page.request.get(`/api/conversations/${id}`)).json()).modelId).toBe(sonnet);
  await panel.getByRole("button", { name: "Assistant model: Claude Sonnet 5.5", exact: true }).click();
  await page.getByRole("menuitemradio", { name: /^Claude Haiku 4\.5/ }).click();
  await expect(panel.getByRole("button", { name: "Assistant model: Claude Haiku 4.5", exact: true })).toBeEnabled();
  await expect(panel.getByRole("alert").filter({ hasText: "The model changed in another window" })).toHaveCount(0);
  expect((await (await page.request.get(`/api/conversations/${id}`)).json()).modelId).toBe(haiku);
});

test("model updates enforce ownership, allowed models, revisions and active reply or approval guards", async ({ page, browser }) => {
  await signUp(page.request);
  const created = await page.request.post("/api/conversations", { headers, data: {} });
  const { id } = await created.json();
  const path = `/api/conversations/${id}/model`, change = { modelId: haiku, expectedModelId: null };
  expect((await page.request.patch(path, { headers, data: { ...change, modelId: "arbitrary/expensive-model" } })).status()).toBe(400);
  expect((await page.request.patch(path, { headers, data: { modelId: haiku } })).status()).toBe(400);
  expect((await page.request.patch(path, { headers: { Origin: "https://wrong.example" }, data: change })).status()).toBe(400);
  expect((await page.request.patch(path, { headers, data: { ...change, expectedModelId: sonnet } })).status()).toBe(409);
  const other = await browser.newContext({ baseURL: origin, extraHTTPHeaders: clientHeaders() });
  try {
    expect((await other.request.get("/api/assistant/models")).status()).toBe(401);
    await signUp(other.request);
    expect((await other.request.patch(path, { headers, data: change })).status()).toBe(404);
  } finally { await other.close(); }

  // Seed only durable test conversation state, avoiding a provider call or key.
  const pool = new Pool({ connectionString: testDatabaseUrl });
  try {
    const runId = crypto.randomUUID();
    await pool.query("INSERT INTO conversation_turns (id,conversation_id,request_id,status) VALUES ($1,$2,$3,'running')", [runId, id, crypto.randomUUID()]);
    await pool.query("UPDATE conversations SET active_run_id=$1,lease_expires_at=now()+interval '2 minutes' WHERE id=$2", [runId, id]);
    expect((await page.request.patch(path, { headers, data: change })).status()).toBe(409);
    await page.goto("/library");
    let panel = await openSift(page);
    await expect(panel.getByRole("button", { name: /^Assistant model: Claude / })).toBeDisabled();
    await pool.query("UPDATE conversations SET active_run_id=NULL,lease_expires_at=NULL WHERE id=$1", [id]);
    await page.reload();
    panel = await openSift(page);
    await expect(panel.getByRole("button", { name: /^Assistant model: Claude / })).toBeEnabled();
    // Another window receives a confirmation after this panel loaded. A failed
    // model save must reconcile the live chat's approval state as well as its DTO.
    const messages: UIMessage[] = [{ id: crypto.randomUUID(), role: "assistant", parts: [{ type: "tool-archiveRecipe", toolCallId: "pending-archive", state: "approval-requested", input: { recipeId: crypto.randomUUID(), expectedVersionId: crypto.randomUUID() }, approval: { id: "pending-approval", requestReason: "Archive this recipe?" } }] }];
    await pool.query("UPDATE conversations SET active_run_id=NULL,lease_expires_at=NULL,messages=$1::jsonb WHERE id=$2", [JSON.stringify(messages), id]);
    const response = await page.request.patch(path, { headers, data: change });
    expect(response.status()).toBe(409);
    expect(await response.json()).toMatchObject({ error: "Approve or decline the pending action before changing models." });
    await panel.getByRole("button", { name: /^Assistant model: Claude / }).click();
    await page.getByRole("menuitemradio", { name: /^Claude Haiku 4\.5/ }).click();
    await expect(panel.getByText("Archive this recipe?", { exact: true })).toBeVisible();
    await expect(panel.getByRole("button", { name: /^Assistant model: Claude / })).toBeDisabled();
    expect((await (await page.request.get(`/api/conversations/${id}`)).json()).modelId).toBeNull();
  } finally { await pool.end(); }
});
