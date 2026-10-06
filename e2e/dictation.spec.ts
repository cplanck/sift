import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";

const headers = { Origin: "http://localhost:3100" };
async function signUp(page: Page) {
  const response = await page.request.post("/api/auth/sign-up/email", { headers, data: { name: "Dictating cook", email: `dictate-${crypto.randomUUID()}@example.test`, password: "a-good-test-password-42" } });
  expect(response.ok()).toBe(true);
}

test("free dictation fills the composer for review and leaves billed live voice separate", async ({ page }, info) => {
  // A scripted Web Speech recognizer: no microphone, Siri or provider involved.
  await page.addInitScript(() => {
    class FakeRecognition {
      continuous = false; interimResults = false; lang = "";
      onresult: ((event: unknown) => void) | null = null; onerror: ((event: unknown) => void) | null = null; onend: (() => void) | null = null;
      start() {
        const result = (text: string) => Object.assign([{ transcript: text, confidence: 1 }], { isFinal: true });
        setTimeout(() => this.onresult?.({ results: [result("What can I make")] }), 50);
        setTimeout(() => this.onresult?.({ results: [result("What can I make"), result(" with leeks")] }), 100);
      }
      stop() { setTimeout(() => this.onend?.(), 10); }
      abort() { this.onend?.(); }
    }
    Object.assign(window, { SpeechRecognition: FakeRecognition, webkitSpeechRecognition: FakeRecognition });
  });
  await signUp(page);
  await page.goto("/library");
  await page.getByRole("button", { name: "Open Sift", exact: true }).click();
  const panel = page.getByRole("dialog", { name: "sift", exact: true });
  const composer = panel.getByRole("textbox", { name: "Message Sift", exact: true });
  await expect(composer).toBeEnabled();
  await composer.fill("Quick question:");
  await expect(panel.getByRole("button", { name: "Talk to Sift", exact: true })).toBeEnabled();
  await panel.getByRole("button", { name: "Dictate message", exact: true }).click();
  await expect(composer).toHaveValue("Quick question: What can I make with leeks");
  await expect(panel.getByText("Listening… tap stop when you’re done, then send.")).toBeVisible();
  await expect(panel.getByRole("button", { name: "Talk to Sift", exact: true })).toBeDisabled();
  await page.screenshot({ path: `test-results/dictation-${info.project.name}.png`, animations: "disabled" });
  await panel.getByRole("button", { name: "Stop dictation", exact: true }).click();
  await expect(panel.getByRole("button", { name: "Dictate message", exact: true })).toBeVisible();
  await expect(composer).toHaveValue("Quick question: What can I make with leeks");
  await expect(panel.getByRole("button", { name: "Send message", exact: true })).toBeEnabled();
});

test("without the Web Speech API, dictation points to the keyboard's mic key", async ({ page }) => {
  await page.addInitScript(() => { Object.assign(window, { webkitSpeechRecognition: undefined, SpeechRecognition: undefined }); });
  await signUp(page);
  await page.goto("/library");
  await page.getByRole("button", { name: "Open Sift", exact: true }).click();
  const panel = page.getByRole("dialog", { name: "sift", exact: true });
  await expect(panel.getByRole("textbox", { name: "Message Sift", exact: true })).toBeEnabled();
  await panel.getByRole("button", { name: "Dictate message", exact: true }).click();
  await expect(panel.getByText("Tap the microphone on your keyboard to dictate.")).toBeVisible();
  await expect(panel.getByRole("textbox", { name: "Message Sift", exact: true })).toBeFocused();
});
