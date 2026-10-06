import type { APIRequestContext } from "@playwright/test";
import { expect, test } from "./fixtures";

const origin = "http://localhost:3100", headers = { Origin: origin };
async function signUp(request: APIRequestContext) {
  const response = await request.post("/api/auth/sign-up/email", { headers, data: { name: "Voice cook", email: `voice-${crypto.randomUUID()}@example.test`, password: "a-good-test-password-42" } });
  expect(response.ok(), await response.text()).toBe(true);
}
type MediaFixture = Window & { microphoneRequests?: number; microphoneStops?: number; resolveMicrophone?: () => void };

test("unconfigured voice is truthful and keeps the existing text conversation available", async ({ page }, testInfo) => {
  await signUp(page.request);
  const status = await page.request.get("/api/voice/status");
  expect(status.ok()).toBe(true);
  expect(status.headers()["cache-control"]).toContain("no-store");
  const configuration = await status.json() as { configured: boolean; message: string };
  expect(configuration.configured).toBe(false);
  // The browser microphone boundary must never be reached when the real
  // deployment status says voice cannot connect.
  await page.addInitScript(() => {
    const fixture = window as MediaFixture; fixture.microphoneRequests = 0;
    Object.defineProperty(navigator.mediaDevices, "getUserMedia", { configurable: true, value: async () => { fixture.microphoneRequests!++; throw new DOMException("Unexpected microphone request", "NotAllowedError"); } });
  });
  let starts = 0;
  page.on("request", (request) => { if (request.url().endsWith("/api/voice/sessions") && request.method() === "POST") starts++; });
  await page.goto("/library");
  await page.getByRole("button", { name: "Open Sift", exact: true }).click();
  await page.getByRole("textbox", { name: "Message Sift", exact: true }).fill("Keep this cooking question in the composer.");
  // Typing is allowed while the conversation opens; its model control appears once it exists.
  await expect(page.getByRole("button", { name: /^Assistant model:/ })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Message Sift", exact: true })).toHaveValue("Keep this cooking question in the composer.");
  const conversations = await (await page.request.get("/api/conversations")).json() as { id: string }[];
  expect(conversations).toHaveLength(1);
  await page.getByRole("button", { name: "Talk to Sift", exact: true }).click();
  await page.getByRole("button", { name: "Voice controls", exact: true }).click();
  const controls = page.getByRole("region", { name: "Sift voice", exact: true });
  await expect(controls.getByRole("alert")).toHaveText(configuration.message);
  await expect(controls.getByText("Listening", { exact: true })).toHaveCount(0);
  await expect(controls.getByRole("button", { name: "Reconnect", exact: true })).toBeVisible();
  expect(await page.evaluate(() => (window as MediaFixture).microphoneRequests)).toBe(0);
  expect(starts).toBe(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: `test-results/voice-unavailable-${testInfo.project.name}.png` });
  await controls.getByRole("button", { name: "Use text", exact: true }).click();
  await expect(controls).toHaveCount(0);
  await expect(page.getByRole("textbox", { name: "Message Sift", exact: true })).toHaveValue("Keep this cooking question in the composer.");
  expect(await (await page.request.get("/api/conversations")).json()).toEqual(conversations);
  expect((await (await page.request.get(`/api/conversations/${conversations[0].id}`)).json()).messages).toEqual([]);
});

test("cooking voice asks for permission only on tap, explains denial, and opens text without a provider session", async ({ page }, testInfo) => {
  await signUp(page.request);
  const created = await page.request.post("/api/recipes", { headers, data: { content: { title: "Coffee for one", servings: 1, ingredientSections: [{ name: "Coffee", items: [{ text: "20 g coffee" }, { text: "320 g water" }] }], instructionSections: [{ name: "Brew", steps: ["Rinse the filter and add coffee.", "Pour hot water slowly over the grounds."] }] } } });
  expect(created.status()).toBe(201);
  const recipe = await created.json() as { id: string };
  // Only the availability and browser permission boundaries are simulated.
  // The real SDK is never started and no provider credentials are used.
  await page.route("**/api/voice/status", (route) => route.fulfill({ json: { configured: true } }));
  await page.addInitScript(() => {
    const fixture = window as MediaFixture; fixture.microphoneRequests = 0;
    Object.defineProperty(navigator.mediaDevices, "getUserMedia", { configurable: true, value: async () => { fixture.microphoneRequests!++; throw new DOMException("Permission denied by browser QA", "NotAllowedError"); } });
  });
  let starts = 0;
  page.on("request", (request) => { if (request.url().endsWith("/api/voice/sessions") && request.method() === "POST") starts++; });
  await page.goto(`/recipes/${recipe.id}`);
  await page.getByRole("button", { name: "Cook", exact: true }).click();
  await expect(page.getByRole("region", { name: "Current cooking step", exact: true })).toBeVisible();
  expect(await page.evaluate(() => (window as MediaFixture).microphoneRequests)).toBe(0);
  await page.getByRole("button", { name: "Open Sift", exact: true }).click();
  await page.getByRole("button", { name: "Talk to Sift", exact: true }).click();
  await page.getByRole("button", { name: "Voice controls", exact: true }).click();
  const controls = page.getByRole("region", { name: "Sift voice", exact: true });
  await expect(controls.getByRole("alert")).toContainText("Microphone access is blocked");
  expect(await page.evaluate(() => (window as MediaFixture).microphoneRequests)).toBe(1);
  expect(starts).toBe(0);
  await page.screenshot({ path: `test-results/cooking-voice-permission-${testInfo.project.name}.png` });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await controls.getByRole("button", { name: "Use text", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Message Sift", exact: true })).toBeEnabled();
  await expect(page.getByText("Coffee for one · Cooking", { exact: true })).toHaveText("Coffee for one · Cooking");
  await page.getByRole("button", { name: "Close Sift", exact: true }).click();
  await expect(page.getByRole("region", { name: "Current cooking step", exact: true })).toBeVisible();
});

test("canceling microphone permission releases a late stream and never starts voice", async ({ page }) => {
  await signUp(page.request);
  await page.route("**/api/voice/status", (route) => route.fulfill({ json: { configured: true } }));
  await page.addInitScript(() => {
    const fixture = window as MediaFixture; fixture.microphoneRequests = 0; fixture.microphoneStops = 0;
    // A pending browser permission prompt, resolved only after the user ends
    // voice. This exercises cleanup without recording audio or mocking Sift.
    Object.defineProperty(navigator.mediaDevices, "getUserMedia", { configurable: true, value: () => {
      fixture.microphoneRequests!++;
      return new Promise((resolve) => { fixture.resolveMicrophone = () => resolve({ getTracks: () => [{ stop: () => { fixture.microphoneStops!++; } }] }); });
    } });
  });
  let starts = 0;
  page.on("request", (request) => { if (request.url().endsWith("/api/voice/sessions") && request.method() === "POST") starts++; });
  await page.goto("/library");
  await page.getByRole("button", { name: "Open Sift", exact: true }).click();
  await page.getByRole("button", { name: "Talk to Sift", exact: true }).click();
  await expect(page.getByRole("button", { name: "New conversation", exact: true })).toBeDisabled();
  await expect(page.getByRole("textbox", { name: "Message Sift", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Voice controls", exact: true }).click();
  const controls = page.getByRole("region", { name: "Sift voice", exact: true });
  await expect(controls.getByRole("status")).toHaveText("Allow microphone access to begin");
  await expect(controls.getByRole("button", { name: "Mute", exact: true })).toBeDisabled();
  await controls.getByRole("button", { name: "End voice", exact: true }).click();
  await expect(controls.getByRole("status")).toHaveText("Voice is off");
  await page.getByRole("dialog", { name: "Voice controls", exact: true }).getByRole("button", { name: "Close", exact: true }).click();
  await expect(controls).toHaveCount(0);
  await page.evaluate(() => (window as MediaFixture).resolveMicrophone?.());
  await expect.poll(() => page.evaluate(() => (window as MediaFixture).microphoneStops)).toBe(1);
  await expect(page.getByRole("textbox", { name: "Message Sift", exact: true })).toBeEnabled();
  expect(starts).toBe(0);
});

test("unsupported voice leaves text available without requesting a microphone", async ({ page }) => {
  await signUp(page.request);
  await page.goto("/library");
  await page.getByRole("button", { name: "Open Sift", exact: true }).click();
  // Apply the capability boundary after SDK initialization: its compatibility
  // shim restores RTCPeerConnection from Chromium's prefixed native alias.
  await page.evaluate(() => { Object.defineProperty(window, "RTCPeerConnection", { configurable: true, value: undefined }); });
  expect(await page.evaluate(() => typeof window.RTCPeerConnection)).toBe("undefined");
  await page.getByRole("button", { name: "Talk to Sift", exact: true }).click();
  await page.getByRole("button", { name: "Voice controls", exact: true }).click();
  const controls = page.getByRole("region", { name: "Sift voice", exact: true });
  await expect(controls.getByRole("alert")).toContainText("Voice isn’t supported in this browser");
  await controls.getByRole("button", { name: "Use text", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Message Sift", exact: true })).toBeEnabled();
});
