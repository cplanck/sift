import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: "list",
  use: { baseURL: "http://localhost:3100", trace: "retain-on-failure" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "phone", use: { ...devices["iPhone 13"], defaultBrowserType: "chromium" } },
    { name: "tablet", use: { ...devices["iPad Pro 11 landscape"], defaultBrowserType: "chromium" } },
  ],
  webServer: {
    command: "pnpm start --port 3100",
    url: "http://localhost:3100",
    reuseExistingServer: !process.env.CI,
    timeout: 60000,
  },
});
