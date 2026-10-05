import type { Page } from "@playwright/test";
import { Pool } from "pg";
import { testDatabaseUrl } from "../tests/database";
import { expect, test } from "./fixtures";

const headers = { Origin: "http://localhost:3100" };
async function signUp(page: Page) {
  const response = await page.request.post("/api/auth/sign-up/email", { headers, data: { name: "Chat cook", email: `chat-${crypto.randomUUID()}@example.test`, password: "a-good-test-password-42" } });
  expect(response.ok()).toBe(true);
}

test("history opens saved conversations and usage stays hidden until requested, with truthful per-turn costs", async ({ page }, info) => {
  await signUp(page);
  const created = await page.request.post("/api/conversations", { headers, data: { title: "Sunday dinner" } });
  expect(created.ok()).toBe(true);
  const { id } = await created.json();
  // Seed durable state only in the dedicated test database. No live model,
  // fake production API, or provider key is involved in this saved-chat check.
  const messages = [
    { id: crypto.randomUUID(), role: "user", parts: [{ type: "text", text: "Help me plan a relaxed Sunday dinner for four." }] },
    { id: crypto.randomUUID(), role: "assistant", parts: [{ type: "text", text: "### A relaxed Sunday dinner\n\nRoast a chicken with **lemon and thyme**, then add potatoes to the tray. Serve a crisp green salad alongside.\n\n1. Prep the vegetables first.\n2. Roast until the chicken is cooked through.\n3. Rest it while you dress the salad." }] },
    { id: crypto.randomUUID(), role: "user", parts: [{ type: "text", text: "What can I prepare ahead?" }] },
    { id: crypto.randomUUID(), role: "assistant", parts: [{ type: "text", text: "Wash the salad and make the dressing earlier in the day. Keep them separate until serving." }] },
  ];
  const firstRun = crypto.randomUUID(), secondRun = crypto.randomUUID();
  const pool = new Pool({ connectionString: testDatabaseUrl });
  try {
    await pool.query("UPDATE conversations SET messages=$1::jsonb WHERE id=$2", [JSON.stringify(messages), id]);
    await pool.query("INSERT INTO conversation_turns (id,conversation_id,request_id,status,created_at,finished_at) VALUES ($1,$3,$4,'completed','2026-10-01T12:00:00Z','2026-10-01T12:00:02Z'),($2,$3,$5,'completed','2026-10-01T12:01:00Z','2026-10-01T12:01:02Z')", [firstRun, secondRun, id, crypto.randomUUID(), crypto.randomUUID()]);
    for (const [runId, input, output, cost] of [[firstRun, 100, 30, "0.0123"], [firstRun, 50, 10, null], [secondRun, 20, 5, null]]) {
      await pool.query("INSERT INTO ai_usage (idempotency_key,workspace_id,user_id,conversation_id,run_id,model,credential_source,input_tokens,output_tokens,cost_usd) SELECT $1,workspace_id,created_by_user_id,id,$2,'anthropic/claude-sonnet-5.5','app',$3,$4,$5 FROM conversations WHERE id=$6", [crypto.randomUUID(), runId, input, output, cost, id]);
    }
  } finally { await pool.end(); }
  expect((await page.request.post("/api/conversations", { headers, data: { title: "Weeknight lunches" } })).ok()).toBe(true);
  const saved = await (await page.request.get(`/api/conversations/${id}`)).json();
  expect(saved.usage.turns).toEqual([
    expect.objectContaining({ runId: firstRun, number: 1, calls: 2, inputTokens: 150, outputTokens: 40, unpricedCalls: 1 }),
    expect.objectContaining({ runId: secondRun, number: 2, calls: 1, unpricedCalls: 1, reportedCostUsd: null }),
  ]);
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    await page.goto("/library");
    await page.getByRole("button", { name: "Open Sift", exact: true }).click();
    const panel = page.getByRole("dialog", { name: "sift", exact: true });
    await expect(panel.getByRole("textbox", { name: "Message Sift", exact: true })).toBeEnabled();
    await expect(panel.getByRole("button", { name: "Assistant model: Claude Sonnet 5.5", exact: true })).toBeEnabled();
    await expect(panel.getByText("By turn", { exact: true })).toHaveCount(0);
    await page.screenshot({ path: `test-results/chat-empty-${info.project.name}-${colorScheme}.png`, animations: "disabled" });
    await panel.getByRole("button", { name: "Microphone settings", exact: true }).click();
    const audio = page.getByRole("dialog", { name: "Microphone & speaker", exact: true });
    await expect(audio.getByRole("button", { name: "Play test sound", exact: true })).toBeVisible();
    await page.screenshot({ path: `test-results/chat-audio-${info.project.name}-${colorScheme}.png`, animations: "disabled" });
    await audio.getByRole("button", { name: "Close", exact: true }).click();
    await panel.getByRole("button", { name: "Conversation history", exact: true }).click();
    await expect(page.getByRole("menuitem", { name: /Sunday dinner/ })).toBeVisible();
    await page.screenshot({ path: `test-results/chat-history-${info.project.name}-${colorScheme}.png`, animations: "disabled" });
    await page.getByRole("menuitem", { name: /Sunday dinner/ }).click();
    await expect(panel.getByRole("heading", { name: "A relaxed Sunday dinner", exact: true })).toBeVisible();
    await expect(panel.getByRole("log", { name: "Conversation messages", exact: true }).getByText("Wash the salad and make the dressing earlier in the day. Keep them separate until serving.", { exact: true })).toBeInViewport({ ratio: 1 });
    await page.screenshot({ path: `test-results/chat-populated-${info.project.name}-${colorScheme}.png`, animations: "disabled" });
    await expect(panel.getByText("Model calls", { exact: true })).toHaveCount(0);
    await panel.getByRole("button", { name: "Conversation options", exact: true }).click();
    await page.getByRole("menuitem", { name: "Conversation usage", exact: true }).click();
    const usage = page.getByRole("dialog", { name: "Conversation usage", exact: true });
    await expect(usage.getByRole("definition").filter({ hasText: "$0.0123 subtotal" })).toBeVisible();
    await expect(usage.getByRole("region", { name: "Turn 1", exact: true })).not.toBeVisible();
    await usage.getByText("By turn", { exact: true }).click();
    await expect(usage.getByRole("region", { name: "Turn 1", exact: true }).getByTitle("2 model calls", { exact: true })).toHaveText("150 in · 40 out · Sonnet 5.5");
    await expect(usage.getByRole("region", { name: "Turn 2", exact: true })).toContainText("Awaiting cost");
    await expect(usage.getByRole("region", { name: "Turn 2", exact: true })).not.toContainText("$0.00");
    await page.screenshot({ path: `test-results/chat-usage-${info.project.name}-${colorScheme}.png`, animations: "disabled" });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await usage.getByRole("button", { name: "Close", exact: true }).click();
  }
});

test("the corner control ends pending voice directly and exposes failures only on request", async ({ page }, info) => {
  await signUp(page);
  let release!: () => void, starts = 0;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/api/voice/status", async (route) => { await gate; await route.fulfill({ json: { configured: false, message: "Voice is not configured for this test deployment." } }).catch(() => undefined); });
  page.on("request", (request) => { if (request.url().endsWith("/api/voice/sessions") && request.method() === "POST") starts++; });
  await page.goto("/library");
  try {
    await page.getByRole("button", { name: "Start voice with Sift", exact: true }).click();
    await expect(page.getByRole("button", { name: "End voice", exact: true })).toBeVisible();
    await expect(page.getByRole("dialog", { name: "Voice controls", exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: "End voice", exact: true }).click();
    await expect(page.getByRole("button", { name: "Start voice with Sift", exact: true })).toBeVisible();
    release();
    expect(starts).toBe(0);
    await page.getByRole("button", { name: "Start voice with Sift", exact: true }).click();
    await expect(page.getByRole("group", { name: "Sift controls", exact: true }).getByRole("status")).toHaveText("Voice unavailable");
    await expect(page.getByRole("region", { name: "Sift voice", exact: true })).toHaveCount(0);
    await page.screenshot({ path: `test-results/voice-collapsed-error-${info.project.name}.png`, animations: "disabled" });
    await page.getByRole("button", { name: "Voice controls", exact: true }).click();
    const details = page.getByRole("dialog", { name: "Voice controls", exact: true });
    await expect(details.getByRole("alert")).toHaveText("Voice is not configured for this test deployment.");
    await page.screenshot({ path: `test-results/voice-error-details-${info.project.name}.png`, animations: "disabled" });
    await details.getByRole("button", { name: "Close", exact: true }).click();
    await expect(page.getByRole("region", { name: "Sift voice", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Open Sift", exact: true })).toBeVisible();
    expect(starts).toBe(0);
  } finally { release(); }
});
