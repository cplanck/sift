import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";

type MicWindow = Window & { micQa: { allowed: boolean; pending: boolean; requests: MediaStreamConstraints[]; stopped: number; closed: number; devices: string[]; resolve?: () => void } };
async function prepare(page: Page) {
  const signup = await page.request.post("/api/auth/sign-up/email", { headers: { Origin: "http://localhost:3100" }, data: { name: "Microphone cook", email: `microphone-${crypto.randomUUID()}@example.test`, password: "a-good-test-password-42" } });
  expect(signup.ok()).toBe(true);
  // Only browser media APIs are simulated. No provider session, audio upload,
  // production test hook, or real microphone is involved in these meter tests.
  await page.addInitScript(() => {
    const fixture: MicWindow["micQa"] = (window as unknown as MicWindow).micQa = { allowed: false, pending: false, requests: [], stopped: 0, closed: 0, devices: ["built-in", "usb-mic"] };
    Object.defineProperty(navigator.mediaDevices, "enumerateDevices", { configurable: true, value: async () => fixture.allowed ? [
      { deviceId: "default", kind: "audioinput", label: "Default microphone" },
      ...fixture.devices.map((id) => ({ deviceId: id, kind: "audioinput", label: id === "usb-mic" ? "USB kitchen microphone" : "Built-in microphone" })),
      { deviceId: "speaker", kind: "audiooutput", label: "Speakers" },
    ] : [{ deviceId: "", kind: "audioinput", label: "" }] });
    Object.defineProperty(navigator.mediaDevices, "getUserMedia", { configurable: true, value: async (constraints: MediaStreamConstraints) => {
      fixture.requests.push(constraints);
      const deliver = () => {
        fixture.allowed = true;
        const track = new EventTarget(); let ended = false;
        Object.assign(track, { stop: () => { if (!ended) { ended = true; fixture.stopped++; } } });
        return { getTracks: () => [track], getAudioTracks: () => [track] };
      };
      return fixture.pending ? new Promise((resolve) => { fixture.resolve = () => resolve(deliver()); }) : deliver();
    } });
    Object.defineProperty(window, "AudioContext", { configurable: true, value: class {
      resume() { return Promise.resolve(); }
      close() { fixture.closed++; return Promise.resolve(); }
      createMediaStreamSource() { return { connect() {}, disconnect() {} }; }
      createAnalyser() { return { fftSize: 1024, getFloatTimeDomainData(values: Float32Array) { values.fill(0.12); }, disconnect() {} }; }
    } });
  });
  let releaseHistory = () => {};
  const loadingConversation = new Promise<void>((resolve) => { releaseHistory = resolve; });
  await page.route("**/api/conversations", async (route) => {
    if (route.request().method() === "GET") await loadingConversation;
    await route.continue();
  });
  await page.goto("/library");
  await page.getByRole("button", { name: "Open Sift", exact: true }).click();
  // Opening the picker before the conversation-keyed panel remount used to
  // close it unexpectedly. Keep the input disabled until loading settles.
  await expect(page.getByRole("button", { name: "Microphone settings", exact: true })).toBeDisabled();
  releaseHistory();
  await page.getByRole("button", { name: "Microphone settings", exact: true }).click();
  return page.getByRole("dialog", { name: "Microphone", exact: true });
}

test("microphone choice persists, local meter releases capture, and voice uses the exact input", async ({ page }, testInfo) => {
  let providerStarts = 0, providerStatusReads = 0;
  page.on("request", (request) => {
    if (request.url().endsWith("/api/voice/status")) providerStatusReads++;
    if (request.url().endsWith("/api/voice/sessions") && request.method() === "POST") providerStarts++;
  });
  const dialog = await prepare(page);
  expect(await page.evaluate(() => (window as unknown as MicWindow).micQa.requests.length)).toBe(0);
  await dialog.getByRole("button", { name: "Allow microphone access", exact: true }).click();
  await expect(dialog.getByRole("button", { name: "Test microphone", exact: true })).toBeEnabled();
  await expect(dialog.getByRole("option", { name: "USB kitchen microphone", exact: true })).toHaveCount(1);
  await expect(dialog.getByRole("option", { name: "Speakers", exact: true })).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => (window as unknown as MicWindow).micQa.stopped)).toBe(1);
  await dialog.getByLabel("Audio input", { exact: true }).selectOption("usb-mic");
  await dialog.getByRole("button", { name: "Test microphone", exact: true }).click();
  await expect(dialog.getByRole("meter", { name: "Microphone input level", exact: true })).toHaveAttribute("aria-valuenow", "48");
  await expect(dialog.getByRole("status")).toHaveText("Speak to test");
  await expect(dialog.getByLabel("Audio input", { exact: true })).toBeDisabled();
  expect(await page.evaluate(() => (window as unknown as MicWindow).micQa.requests.at(-1))).toEqual({ audio: { deviceId: { exact: "usb-mic" } } });
  expect(providerStarts).toBe(0); expect(providerStatusReads).toBe(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: `test-results/microphone-meter-${testInfo.project.name}.png` });
  await dialog.getByRole("button", { name: "Stop test", exact: true }).click();
  await expect(dialog.getByRole("status")).toHaveText("Microphone off");
  expect(await page.evaluate(() => (window as unknown as MicWindow).micQa.stopped)).toBe(2);
  expect(await page.evaluate(() => (window as unknown as MicWindow).micQa.closed)).toBe(1);
  await dialog.getByRole("button", { name: "Test microphone", exact: true }).click();
  await expect(dialog.getByRole("status")).toHaveText("Speak to test");
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as MicWindow).micQa.stopped)).toBe(3);
  expect(await page.evaluate(() => (window as unknown as MicWindow).micQa.closed)).toBe(2);
  await page.reload();
  await page.getByRole("button", { name: "Open Sift", exact: true }).click();
  await page.getByRole("button", { name: "Microphone settings", exact: true }).click();
  await expect(dialog.getByLabel("Audio input", { exact: true })).toHaveValue("usb-mic");
  await expect(dialog.getByText(/saved input may be disconnected or need permission/)).toBeVisible();
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await page.route("**/api/voice/status", (route) => route.fulfill({ json: { configured: true } }));
  // Stop at Sift's provider boundary after verifying the actual selected capture
  // constraint. Never mint a token or connect a paid ElevenLabs session in QA.
  await page.route("**/api/voice/sessions", (route) => route.fulfill({ status: 503, json: { error: "Provider boundary stopped by browser QA." } }));
  await page.getByRole("button", { name: "Talk to Sift", exact: true }).click();
  await expect(page.getByRole("region", { name: "Sift voice", exact: true }).getByRole("alert")).toHaveText("Provider boundary stopped by browser QA.");
  expect(await page.evaluate(() => (window as unknown as MicWindow).micQa.requests)).toEqual([{ audio: { deviceId: { exact: "usb-mic" } } }]);
  expect(await page.evaluate(() => (window as unknown as MicWindow).micQa.stopped)).toBe(1);
  expect(providerStarts).toBe(1);
});

test("closing microphone settings cancels pending permission and stops a late stream", async ({ page }) => {
  const dialog = await prepare(page);
  await page.evaluate(() => { (window as unknown as MicWindow).micQa.pending = true; });
  await dialog.getByRole("button", { name: "Test microphone", exact: true }).click();
  await expect(dialog.getByRole("status")).toHaveText("Waiting for microphone…");
  await expect.poll(() => page.evaluate(() => (window as unknown as MicWindow).micQa.requests.length)).toBe(1);
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await page.evaluate(() => (window as unknown as MicWindow).micQa.resolve?.());
  await expect.poll(() => page.evaluate(() => (window as unknown as MicWindow).micQa.stopped)).toBe(1);
  expect(await page.evaluate(() => (window as unknown as MicWindow).micQa.closed)).toBe(1);
  await page.getByRole("button", { name: "Microphone settings", exact: true }).click();
  await expect(dialog.getByRole("status")).toHaveText("Microphone off");
  await expect(dialog.getByRole("button", { name: "Test microphone", exact: true })).toBeEnabled();
});
