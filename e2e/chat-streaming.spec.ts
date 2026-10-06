import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";

const headers = { Origin: "http://localhost:3100" };
async function signUp(page: Page) {
  const response = await page.request.post("/api/auth/sign-up/email", { headers, data: { name: "Streaming cook", email: `stream-${crypto.randomUUID()}@example.test`, password: "a-good-test-password-42" } });
  expect(response.ok()).toBe(true);
}

// A browser-side, test-controlled UI message stream. route.fulfill can only
// send a whole body; this exposes each in-progress state for assertions.
async function controlledAssistant(page: Page) {
  await page.addInitScript(() => {
    const original = window.fetch.bind(window);
    const scope = window as unknown as { __chat: { push: (chunk: object) => void; close: () => void } | null };
    scope.__chat = null;
    window.fetch = async (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (!url.endsWith("/api/assistant")) return original(input, init);
      (window as unknown as { __chatBody?: unknown }).__chatBody = typeof init?.body === "string" ? JSON.parse(init.body) : null;
      const encoder = new TextEncoder();
      const body = new ReadableStream<Uint8Array>({ start(controller) {
        scope.__chat = {
          push: (chunk) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`)),
          close: () => { controller.enqueue(encoder.encode("data: [DONE]\n\n")); controller.close(); },
        };
      } });
      return new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream", "x-vercel-ai-ui-message-stream": "v1" } });
    };
  });
  return {
    push: (...chunks: object[]) => page.evaluate((list) => { for (const chunk of list) (window as unknown as { __chat: { push: (chunk: object) => void } }).__chat.push(chunk); }, chunks),
    close: () => page.evaluate(() => (window as unknown as { __chat: { close: () => void } }).__chat.close()),
    ready: () => page.waitForFunction(() => !!(window as unknown as { __chat: unknown }).__chat),
  };
}

test("one live activity line follows the reply, and finished lookups fold away", async ({ page }, info) => {
  const stream = await controlledAssistant(page);
  await signUp(page);
  await page.goto("/library");
  await page.getByRole("button", { name: "Open Sift", exact: true }).click();
  const panel = page.getByRole("dialog", { name: "sift", exact: true });
  const log = panel.getByRole("log", { name: "Conversation messages", exact: true });
  await panel.getByRole("textbox", { name: "Message Sift", exact: true }).fill("What can I make with leeks?");
  await panel.getByRole("button", { name: "Send message", exact: true }).click();

  // Optimistic: the message and a placeholder reply appear before any byte arrives.
  await expect(log.getByRole("article", { name: "Your message", exact: true })).toContainText("What can I make with leeks?");
  await expect(log.getByRole("status")).toHaveText("Thinking…");
  await stream.ready();

  const recipeId = crypto.randomUUID();
  await stream.push({ type: "start", messageId: crypto.randomUUID() }, { type: "start-step" },
    { type: "tool-input-start", toolCallId: "search", toolName: "searchRecipes" },
    { type: "tool-input-available", toolCallId: "search", toolName: "searchRecipes", input: { query: "leeks" } });
  await expect(log.getByRole("status")).toHaveText("Looking through your cookbook…");
  await page.screenshot({ path: `test-results/chat-stream-tool-${info.project.name}.png`, animations: "disabled" });

  await stream.push({ type: "tool-output-available", toolCallId: "search", output: { ok: true, total: 1, recipes: [{ recipeId, title: "Leek and Potato Soup" }] } },
    { type: "finish-step" }, { type: "start-step" });
  // Between steps exactly one activity line remains, and the finished lookup is already folded.
  await expect(log.getByRole("status")).toHaveText("Thinking…");
  await expect(log.getByRole("button", { name: "Searched your cookbook", exact: true })).toBeVisible();

  await stream.push({ type: "tool-input-available", toolCallId: "read", toolName: "getRecipe", input: { recipeId } });
  await expect(log.getByRole("status")).toHaveText("Reading the recipe…");
  await stream.push({ type: "tool-output-available", toolCallId: "read", output: { ok: true, recipeId, title: "Leek and Potato Soup" } },
    { type: "finish-step" }, { type: "start-step" }, { type: "text-start", id: "t" }, { type: "text-delta", id: "t", delta: "Your **Leek and Potato Soup** is a great fit." });
  await expect(log.locator(".assistant-markdown.is-streaming")).toContainText("Leek and Potato Soup is a great fit.");
  await expect(log.getByRole("status")).toHaveCount(0);
  await expect(panel.getByRole("button", { name: "Stop generating", exact: true })).toBeVisible();
  await page.screenshot({ path: `test-results/chat-stream-text-${info.project.name}.png`, animations: "disabled" });

  await stream.push({ type: "text-end", id: "t" }, { type: "finish-step" }, { type: "finish" });
  await stream.close();
  await expect(panel.getByRole("button", { name: "Stop generating", exact: true })).toHaveCount(0);
  await expect(log.locator(".is-streaming")).toHaveCount(0);
  const steps = log.getByRole("button", { name: "Checked your cookbook · 2 steps", exact: true });
  await expect(steps).toHaveAttribute("aria-expanded", "false");
  await expect(log.getByRole("link", { name: "Leek and Potato Soup", exact: true })).toHaveCount(0);
  await steps.click();
  await expect(log.getByRole("link", { name: "Leek and Potato Soup", exact: true }).first()).toHaveAttribute("href", `/recipes/${recipeId}`);
  await expect(log.getByRole("button", { name: "Copy response", exact: true })).toBeVisible();
  await page.screenshot({ path: `test-results/chat-stream-done-${info.project.name}.png`, animations: "disabled" });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("Escape stops a reply instead of closing the conversation", async ({ page }) => {
  const stream = await controlledAssistant(page);
  await signUp(page);
  await page.goto("/library");
  await page.getByRole("button", { name: "Open Sift", exact: true }).click();
  const panel = page.getByRole("dialog", { name: "sift", exact: true });
  await panel.getByRole("textbox", { name: "Message Sift", exact: true }).fill("Plan dinner");
  await panel.getByRole("button", { name: "Send message", exact: true }).click();
  await stream.ready();
  await stream.push({ type: "start", messageId: crypto.randomUUID() }, { type: "text-start", id: "t" }, { type: "text-delta", id: "t", delta: "Let's start with" });
  await expect(panel.getByRole("button", { name: "Stop generating", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(panel.getByRole("button", { name: "Stop generating", exact: true })).toHaveCount(0);
  await expect(panel).toBeVisible();
  await expect(panel.getByText("Let's start with")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(panel).toBeHidden();
});

test("the agent can open a page and confirm before deleting a list", async ({ page }) => {
  const stream = await controlledAssistant(page);
  await signUp(page);
  const created = await page.request.post("/api/artifacts", { headers, data: { kind: "grocery", title: "Market run", groups: [{ name: "", items: [{ text: "Leeks" }] }] } });
  expect(created.ok()).toBe(true);
  const list = await created.json() as { id: string; revision: number };
  await page.goto("/library");
  await page.getByRole("button", { name: "Open Sift", exact: true }).click();
  const panel = page.getByRole("dialog", { name: "sift", exact: true });
  await panel.getByRole("textbox", { name: "Message Sift", exact: true }).fill("Open my market list, then delete it");
  await panel.getByRole("button", { name: "Send message", exact: true }).click();
  await stream.ready();
  await stream.push({ type: "start", messageId: crypto.randomUUID() }, { type: "start-step" },
    { type: "tool-input-available", toolCallId: "nav", toolName: "navigate", input: { path: `/artifacts/${list.id}` } },
    { type: "tool-output-available", toolCallId: "nav", output: { ok: true, href: `/artifacts/${list.id}` } },
    { type: "tool-input-available", toolCallId: "del", toolName: "deleteArtifact", input: { artifactId: list.id, expectedRevision: list.revision } },
    { type: "tool-approval-request", approvalId: "approval-1", toolCallId: "del", reason: "Delete “Market run”? This can’t be undone." },
    { type: "finish-step" }, { type: "finish" });
  await stream.close();
  await expect(page).toHaveURL(new RegExp(`/artifacts/${list.id}$`));
  const sheet = (await panel.isVisible()) ? panel : null;
  if (!sheet) await page.getByRole("button", { name: "Open Sift", exact: true }).click();
  await expect(panel.getByText("Delete “Market run”? This can’t be undone.")).toBeVisible();
  await expect(panel.getByRole("button", { name: "Delete", exact: true })).toBeVisible();
  await expect(panel.getByRole("button", { name: "Keep it", exact: true })).toBeVisible();
});


test("photos attach, paste, upload and send with the message", async ({ page }, info) => {
  const stream = await controlledAssistant(page);
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
  let uploads = 0;
  await page.route("**/api/photos/uploads", (route) => { uploads++; return route.fulfill({ status: 201, json: { id: `00000000-0000-4000-8000-00000000000${uploads}`, url: `https://storage.test/put/${uploads}`, expiresIn: 300 } }); });
  await page.route("https://storage.test/**", (route) => route.fulfill({ status: 200, headers: { "Access-Control-Allow-Origin": "*" }, body: "" }));
  await page.route("**/api/photos/*/complete", (route) => route.fulfill({ json: { id: "ok" } }));
  await page.route(/\/api\/photos\/[0-9a-f-]{36}$/, (route) => route.fulfill({ status: 200, contentType: "image/png", body: png }));
  await signUp(page);
  await page.goto("/library");
  await page.getByRole("button", { name: "Open Sift", exact: true }).click();
  const panel = page.getByRole("dialog", { name: "sift", exact: true });
  const composer = panel.getByRole("textbox", { name: "Message Sift", exact: true });
  await expect(panel.getByRole("button", { name: /^Assistant model:/ })).toBeVisible();
  await panel.locator('input[type="file"][accept="image/*"]').setInputFiles({ name: "card.png", mimeType: "image/png", buffer: png });
  await expect(panel.getByRole("list", { name: "Attached photos", exact: true }).getByRole("img")).toHaveCount(1);
  await composer.focus();
  await page.evaluate(async (base64) => {
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    const data = new DataTransfer(); data.items.add(new File([bytes], "pasted.png", { type: "image/png" }));
    document.getElementById("sift-composer")!.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
  }, png.toString("base64"));
  await expect(panel.getByRole("list", { name: "Attached photos", exact: true }).getByRole("img")).toHaveCount(2);
  await panel.getByRole("button", { name: "Remove photo 2", exact: true }).click();
  await expect(panel.getByRole("list", { name: "Attached photos", exact: true }).getByRole("img")).toHaveCount(1);
  await expect(composer).toHaveAttribute("placeholder", "Add a note, or just send…");
  await page.screenshot({ path: `test-results/chat-photo-attached-${info.project.name}.png`, animations: "disabled" });
  await panel.getByRole("button", { name: "Send message", exact: true }).click();
  await stream.ready();
  const body = await page.evaluate(() => (window as unknown as { __chatBody: { message: { text: string; photoIds: string[] } } }).__chatBody);
  expect(body.message).toMatchObject({ text: "", photoIds: ["00000000-0000-4000-8000-000000000001"] });
  await expect(panel.getByRole("article", { name: "Your message", exact: true }).getByRole("img", { name: "Your photo 1" })).toBeVisible();
  await expect(panel.getByRole("list", { name: "Attached photos", exact: true })).toHaveCount(0);
  await stream.push({ type: "start", messageId: crypto.randomUUID() }, { type: "text-start", id: "t" }, { type: "text-delta", id: "t", delta: "Saved **Grandma’s Lemon Bars**." }, { type: "text-end", id: "t" }, { type: "finish" });
  await stream.close();
  await expect(panel.getByText("Grandma’s Lemon Bars")).toBeVisible();
  await page.screenshot({ path: `test-results/chat-photo-sent-${info.project.name}.png`, animations: "disabled" });
});
