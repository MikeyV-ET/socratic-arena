import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  timeout: 120_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  retries: 0,
  use: {
    baseURL: process.env.SA_URL ?? "http://localhost:5175",
    headless: true,
    viewport: { width: 1440, height: 900 },
    launchOptions: { args: ["--no-sandbox"] },
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
});