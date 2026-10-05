import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";

type MicWindow = Window & { micQa: { allowed: boolean; pending: boolean; requests: MediaStreamConstraints[]; stopped: number; closed: number; devices: string[]; holdEnumeration: boolean; pendingLists: (() => void)[]; resolve?: () => void; sinks: string[]; speakerPlays: string[]; outputStopped: number; sinkError: boolean; holdSink: boolean; finishSink?: () => void } };
async function prepare(page: Page) {
  const signup = await page.request.post("/api/auth/sign-up/email", { headers: { Origin: "http://localhost:3100" }, data: { name: "Microphone cook", email: `microphone-${crypto.randomUUID()}@example.test`, password: "a-good-test-password-42" } });
  expect(signup.ok()).toBe(true);
  // Only browser media APIs are simulated. No provider session, audio upload,
  // production test hook, or real microphone is involved in these meter tests.
  await page.addInitScript(() => {
    const fixture: MicWindow["micQa"] = (window as unknown as MicWindow).micQa = { allowed: false, pending: false, requests: [], stopped: 0, closed: 0, devices: ["built-in", "usb-mic"], holdEnumeration: false, pendingLists: [], sinks: [], speakerPlays: [], outputStopped: 0, sinkError: false, holdSink: false };
    Object.defineProperty(navigator.mediaDevices, "enumerateDevices", { configurable: true, value: async () => {
      const devices = fixture.allowed ? [
        { deviceId: "default", kind: "audioinput", label: "Default microphone" },
        ...fixture.devices.map((id) => ({ deviceId: id, kind: "audioinput", label: id === "usb-mic" ? "USB kitchen microphone" : "Built-in microphone" })),
        { deviceId: "speaker", kind: "audiooutput", label: "Speakers" },
        { deviceId: "headphones", kind: "audiooutput", label: "Kitchen headphones" },
      ] : [{ deviceId: "", kind: "audioinput", label: "" }];
      return fixture.holdEnumeration ? new Promise((resolve) => { fixture.pendingLists.push(() => resolve(devices)); }) : devices;
    } });
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
      currentTime = 0;
      resume() { return Promise.resolve(); }
      close() { fixture.closed++; return Promise.resolve(); }
      createMediaStreamSource() { return { connect() {}, disconnect() {} }; }
      createAnalyser() { return { fftSize: 1024, getFloatTimeDomainData(values: Float32Array) { values.fill(0.12); }, disconnect() {} }; }
      createOscillator() { return { frequency: { value: 0 }, connect() {}, disconnect() {}, start() {}, stop() {} }; }
      createGain() { return { gain: { setValueAtTime() {}, linearRampToValueAtTime() {}, setTargetAtTime() {} }, connect() {}, disconnect() {} }; }
      createMediaStreamDestination() {
        const stream = new MediaStream(); let stopped = false;
        Object.defineProperty(stream, "getTracks", { value: () => [{ stop() { if (!stopped) { stopped = true; fixture.outputStopped++; } } }] });
        return { stream };
      }
    } });
    Object.defineProperty(navigator.mediaDevices, "selectAudioOutput", { configurable: true, value: async () => {
      fixture.allowed = true;
      return { deviceId: "headphones", kind: "audiooutput", label: "Kitchen headphones" };
    } });
    Object.defineProperty(HTMLMediaElement.prototype, "setSinkId", { configurable: true, value: async function (this: HTMLMediaElement, id: string) {
      fixture.sinks.push(id);
      if (fixture.sinkError) throw new DOMException("Unavailable fixture output", "NotFoundError");
      if (fixture.holdSink) await new Promise<void>((resolve) => { fixture.finishSink = resolve; });
      Object.defineProperty(this, "sinkId", { configurable: true, value: id });
    } });
    const originalPlay = HTMLMediaElement.prototype.play;
    Object.defineProperty(HTMLMediaElement.prototype, "play", { configurable: true, value: function (this: HTMLMediaElement) {
      if (this.dataset.siftSpeakerTest === "true") { fixture.speakerPlays.push(this.sinkId || ""); return Promise.resolve(); }
      return originalPlay.call(this);
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
  return page.getByRole("dialog", { name: "Microphone & speaker", exact: true });
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
  await expect.poll(() => page.evaluate(() => (window as unknown as MicWindow).micQa.stopped)).toBe(1);
  const picker = dialog.getByRole("button", { name: /^Audio input / });
  await picker.click();
  await expect(page.getByRole("menuitemradio", { name: "USB kitchen microphone", exact: true })).toBeVisible();
  await expect(page.getByRole("menuitemradio", { name: "Speakers", exact: true })).toHaveCount(0);
  await page.screenshot({ path: `test-results/microphone-picker-${testInfo.project.name}.png` });
  await page.getByRole("menuitemradio", { name: "USB kitchen microphone", exact: true }).click();
  await expect(picker).toHaveText("USB kitchen microphone");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Test microphone", exact: true }).click();
  await expect(dialog.getByRole("meter", { name: "Microphone input level", exact: true })).toHaveAttribute("aria-valuenow", "48");
  await expect(dialog.getByRole("status")).toHaveText("Speak to test");
  await expect(picker).toBeEnabled();
  expect(await page.evaluate(() => (window as unknown as MicWindow).micQa.requests.at(-1))).toEqual({ audio: { deviceId: { exact: "usb-mic" } } });
  expect(providerStarts).toBe(0); expect(providerStatusReads).toBe(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: `test-results/microphone-meter-${testInfo.project.name}.png` });
  // A silent/wrong input can be changed immediately, without waiting for the
  // timer. Real pointer activation of the popup also exercises nested portals.
  await picker.click();
  await page.getByRole("menuitemradio", { name: "Built-in microphone", exact: true }).click();
  await expect(dialog.getByRole("status")).toHaveText("Microphone off");
  expect(await page.evaluate(() => (window as unknown as MicWindow).micQa.stopped)).toBe(2);
  expect(await page.evaluate(() => (window as unknown as MicWindow).micQa.closed)).toBe(1);
  // Keyboard selection and Escape must remain inside the microphone dialog.
  await picker.focus();
  await picker.press("ArrowDown");
  await page.keyboard.press("End");
  await expect(page.getByRole("menuitemradio", { name: "USB kitchen microphone", exact: true })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(picker).toHaveText("USB kitchen microphone");
  await picker.press("ArrowDown");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu", { name: "Audio input devices" })).toHaveCount(0);
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Test microphone", exact: true }).click();
  await expect(dialog.getByRole("status")).toHaveText("Speak to test");
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as MicWindow).micQa.stopped)).toBe(3);
  expect(await page.evaluate(() => (window as unknown as MicWindow).micQa.closed)).toBe(2);
  await page.reload();
  await page.getByRole("button", { name: "Open Sift", exact: true }).click();
  await page.getByRole("button", { name: "Microphone settings", exact: true }).click();
  await expect(picker).toHaveText("Saved microphone (not listed)");
  expect(await page.evaluate(() => localStorage.getItem("sift.microphone.v1"))).toBe("usb-mic");
  await expect(dialog.getByText(/saved input may be disconnected or need permission/)).toBeVisible();
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await page.route("**/api/voice/status", (route) => route.fulfill({ json: { configured: true } }));
  // Stop at Sift's provider boundary after verifying the actual selected capture
  // constraint. Never mint a token or connect a paid ElevenLabs session in QA.
  await page.route("**/api/voice/sessions", (route) => route.fulfill({ status: 503, json: { error: "Provider boundary stopped by browser QA." } }));
  await page.getByRole("button", { name: "Talk to Sift", exact: true }).click();
  await page.getByRole("button", { name: "Voice controls", exact: true }).click();
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

test("a newer device list wins and choosing an input cancels pending capture", async ({ page }) => {
  const dialog = await prepare(page);
  const picker = dialog.getByRole("button", { name: /^Audio input / });
  await page.evaluate(() => {
    const fixture = (window as unknown as MicWindow).micQa;
    fixture.holdEnumeration = true;
    navigator.mediaDevices.dispatchEvent(new Event("devicechange"));
  });
  await expect.poll(() => page.evaluate(() => (window as unknown as MicWindow).micQa.pendingLists.length)).toBe(2);
  await page.evaluate(() => {
    const fixture = (window as unknown as MicWindow).micQa;
    fixture.holdEnumeration = false; fixture.allowed = true;
    navigator.mediaDevices.dispatchEvent(new Event("devicechange"));
  });
  await expect(dialog.getByRole("button", { name: "Refresh microphones", exact: true })).toBeVisible();
  await page.evaluate(() => { (window as unknown as MicWindow).micQa.pendingLists.splice(0).forEach((resolve) => resolve()); });
  await picker.click();
  await expect(page.getByRole("menuitemradio", { name: "USB kitchen microphone", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog.getByRole("button", { name: "Refresh microphones", exact: true })).toBeVisible();
  await page.evaluate(() => { (window as unknown as MicWindow).micQa.pending = true; });
  await dialog.getByRole("button", { name: "Test microphone", exact: true }).click();
  await expect(dialog.getByRole("status")).toHaveText("Waiting for microphone…");
  await expect.poll(() => page.evaluate(() => (window as unknown as MicWindow).micQa.requests.length)).toBe(1);
  await picker.click();
  await page.getByRole("menuitemradio", { name: "USB kitchen microphone", exact: true }).click();
  await expect(dialog.getByRole("status")).toHaveText("Microphone off");
  await page.evaluate(() => { (window as unknown as MicWindow).micQa.resolve?.(); });
  await expect.poll(() => page.evaluate(() => (window as unknown as MicWindow).micQa.stopped)).toBe(1);
  expect(await page.evaluate(() => (window as unknown as MicWindow).micQa.closed)).toBe(1);
  await expect(picker).toHaveText("USB kitchen microphone");
  await expect(dialog).toBeVisible();
});

test("speaker choice persists and the local sound uses only that output", async ({ page }, testInfo) => {
  let voiceRequests = 0;
  page.on("request", (request) => { if (new URL(request.url()).pathname.startsWith("/api/voice/")) voiceRequests++; });
  const dialog = await prepare(page), output = dialog.getByRole("region", { name: "Speaker", exact: true });
  await dialog.getByRole("button", { name: "Allow microphone access", exact: true }).click();
  const picker = output.getByRole("button", { name: /^Speaker / });
  await picker.click();
  await expect(page.getByRole("menuitemradio", { name: "Kitchen headphones", exact: true })).toBeVisible();
  await expect(page.getByRole("menuitemradio", { name: "Built-in microphone", exact: true })).toHaveCount(0);
  await page.screenshot({ path: `test-results/speaker-picker-${testInfo.project.name}.png` });
  await page.getByRole("menuitemradio", { name: "Speakers", exact: true }).click();
  expect(await page.evaluate(() => (window as unknown as MicWindow).micQa.speakerPlays)).toEqual([]);
  await output.getByRole("button", { name: "Play test sound", exact: true }).click();
  await expect(output.getByText("Playing a short tone through your selected speaker.", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as MicWindow).micQa.speakerPlays)).toEqual(["speaker"]);
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await expect(page.locator("audio[data-sift-speaker-test]")).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as MicWindow).micQa.outputStopped)).toBe(1);
  expect(await page.evaluate(() => (window as unknown as MicWindow).micQa.closed)).toBe(1);
  await page.getByRole("button", { name: "Microphone settings", exact: true }).click();
  await picker.focus(); await picker.press("ArrowDown");
  await expect(page.getByRole("menuitemradio", { name: "Kitchen headphones", exact: true })).toBeVisible();
  await page.keyboard.press("End");
  await expect(page.getByRole("menuitemradio", { name: "Kitchen headphones", exact: true })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(picker).toHaveText("Kitchen headphones");
  await output.getByRole("button", { name: "Play test sound", exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as MicWindow).micQa.outputStopped)).toBe(2);
  await expect(page.locator("audio[data-sift-speaker-test]")).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as MicWindow).micQa.speakerPlays)).toEqual(["speaker", "headphones"]);
  expect(await page.evaluate(() => (window as unknown as MicWindow).micQa.requests.length)).toBe(1);
  expect(voiceRequests).toBe(0);
  await page.reload();
  await page.getByRole("button", { name: "Open Sift", exact: true }).click();
  await page.getByRole("button", { name: "Microphone settings", exact: true }).click();
  await expect(picker).toHaveText("Saved speaker (not listed)");
  expect(await page.evaluate(() => localStorage.getItem("sift.speaker.v1"))).toBe("headphones");
});

test("speaker permission is explicit, failures never fall back, and closing cancels pending playback", async ({ page }) => {
  const dialog = await prepare(page), output = dialog.getByRole("region", { name: "Speaker", exact: true });
  const picker = output.getByRole("button", { name: /^Speaker / });
  await output.getByRole("button", { name: "Choose in browser", exact: true }).click();
  await expect(picker).toHaveText("Kitchen headphones");
  expect(await page.evaluate(() => (window as unknown as MicWindow).micQa.requests.length)).toBe(0);
  await page.evaluate(() => { (window as unknown as MicWindow).micQa.sinkError = true; });
  await output.getByRole("button", { name: "Play test sound", exact: true }).click();
  await expect(output.getByRole("alert")).toHaveText("That speaker isn’t available. Connect it or choose another output.");
  expect(await page.evaluate(() => (window as unknown as MicWindow).micQa.speakerPlays)).toEqual([]);
  expect(await page.evaluate(() => (window as unknown as MicWindow).micQa.outputStopped)).toBe(1);
  await page.evaluate(() => { const fixture = (window as unknown as MicWindow).micQa; fixture.sinkError = false; fixture.holdSink = true; });
  await output.getByRole("button", { name: "Play test sound", exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as MicWindow).micQa.sinks.length)).toBe(2);
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await page.evaluate(() => { (window as unknown as MicWindow).micQa.finishSink?.(); });
  await expect(page.locator("audio[data-sift-speaker-test]")).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as MicWindow).micQa.speakerPlays)).toEqual([]);
  expect(await page.evaluate(() => (window as unknown as MicWindow).micQa.outputStopped)).toBe(2);
  await page.getByRole("button", { name: "Microphone settings", exact: true }).click();
  await picker.click();
  await page.getByRole("menuitemradio", { name: "System default", exact: true }).click();
  await output.getByRole("button", { name: "Play test sound", exact: true }).click();
  await expect(output.getByText("Playing a short tone through your selected speaker.", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as MicWindow).micQa.speakerPlays)).toEqual([""]);
  expect(await page.evaluate(() => (window as unknown as MicWindow).micQa.sinks)).toEqual(["headphones", "headphones"]);
  await output.getByRole("button", { name: "Stop test sound", exact: true }).click();
  expect(await page.evaluate(() => (window as unknown as MicWindow).micQa.outputStopped)).toBe(3);
  expect(await page.evaluate(() => (window as unknown as MicWindow).micQa.requests.length)).toBe(0);
});

test("devices stay selectable during voice startup and audio settings can end it without closing", async ({ page }, testInfo) => {
  const dialog = await prepare(page);
  await dialog.getByRole("button", { name: "Allow microphone access", exact: true }).click();
  await expect(dialog.getByRole("button", { name: "Refresh microphones", exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  const pending: (() => void)[] = [];
  let providerStarts = 0;
  await page.route("**/api/voice/status", async (route) => {
    await new Promise<void>((resolve) => { pending.push(resolve); });
    await route.fulfill({ json: { configured: true } }).catch(() => undefined);
  });
  await page.route("**/api/voice/sessions", async (route) => {
    providerStarts++;
    await route.fulfill({ status: 503, json: { error: "Unexpected provider boundary reached by browser QA." } });
  });
  const voice = page.getByRole("region", { name: "Sift voice", exact: true });
  try {
    for (const action of ["microphone", "speaker", "end"] as const) {
      await page.getByRole("button", { name: "Talk to Sift", exact: true }).click();
      await page.getByRole("button", { name: "Voice controls", exact: true }).click();
      await expect(voice.getByRole("status")).toHaveText("Getting voice ready…");
      await expect.poll(() => pending.length).toBe(1);
      await voice.getByRole("button", { name: "Microphone settings", exact: true }).click();
      const inputPicker = dialog.getByRole("button", { name: /^Audio input / });
      const outputPicker = dialog.getByRole("button", { name: /^Speaker / });
      await expect(inputPicker).toBeEnabled(); await expect(outputPicker).toBeEnabled();
      await expect(dialog.getByRole("button", { name: "Test microphone", exact: true })).toBeDisabled();
      await expect(dialog.getByRole("button", { name: "Play test sound", exact: true })).toBeDisabled();
      await expect(dialog.getByRole("button", { name: "End voice to test audio", exact: true })).toBeVisible();
      if (action === "end") await dialog.getByRole("button", { name: "End voice to test audio", exact: true }).click();
      else {
        await (action === "microphone" ? inputPicker : outputPicker).click();
        await page.getByRole("menuitemradio", { name: action === "microphone" ? "USB kitchen microphone" : "Kitchen headphones", exact: true }).click();
      }
      await expect(dialog).toBeVisible();
      await expect(dialog.getByRole("button", { name: "Test microphone", exact: true })).toBeEnabled();
      await expect(dialog.getByRole("button", { name: "Play test sound", exact: true })).toBeEnabled();
      if (action === "speaker") await page.screenshot({ path: `test-results/audio-startup-cancel-${testInfo.project.name}.png` });
      pending.shift()?.();
      await dialog.getByRole("button", { name: "Close", exact: true }).click();
      await expect(voice.getByText(action === "end" ? "Voice has stopped. You can test or change your audio devices." : "Audio device changed. Start voice again to use it.", { exact: true })).toBeVisible();
      await expect(voice.getByRole("status")).toHaveText("Voice is off");
      await page.getByRole("dialog", { name: "Voice controls", exact: true }).getByRole("button", { name: "Close", exact: true }).click();
      expect(providerStarts).toBe(0);
    }
    expect(await page.evaluate(() => (window as unknown as MicWindow).micQa.requests.length)).toBe(1);
    expect(await page.evaluate(() => localStorage.getItem("sift.microphone.v1"))).toBe("usb-mic");
    expect(await page.evaluate(() => localStorage.getItem("sift.speaker.v1"))).toBe("headphones");
  } finally { pending.splice(0).forEach((release) => release()); }
});
