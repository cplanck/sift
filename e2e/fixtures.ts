import { randomUUID } from "node:crypto";
import { test as base, expect } from "@playwright/test";

export function clientHeaders() {
  const id = randomUUID().replaceAll("-", "");
  // A distinct documentation-only IPv6 /64 for each simulated client. Better
  // Auth groups IPv6 by /64; keep its real production throttles enabled.
  return { "X-Forwarded-For": `2001:db8:${id.slice(0, 4)}:${id.slice(4, 8)}::1` };
}

export const test = base.extend<{ siftDocked: boolean }>({
  extraHTTPHeaders: async ({ baseURL }, provide) => {
    if (new URL(baseURL!).hostname !== "localhost") throw new Error("Isolated browser fixtures must use the local test server.");
    await provide(clientHeaders());
  },
  // Wide screens dock Sift open by default. Most flows start from a collapsed
  // sidebar; docking tests opt in with test.use({ siftDocked: true }).
  siftDocked: [false, { option: true }],
  page: async ({ page, siftDocked }, provide) => {
    if (!siftDocked) await page.addInitScript(() => { try { if (!localStorage.getItem("sift.assistant.dock.v1")) localStorage.setItem("sift.assistant.dock.v1", JSON.stringify({ open: false })); } catch { /* Opaque origins. */ } });
    await provide(page);
  },
});
export { expect };
