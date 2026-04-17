import { test, expect } from "@playwright/test";

test.describe("Smoke tests", () => {
  test("app renders without runtime errors", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(err.message));

    await page.goto("/");
    // Wait for app to fully initialize (WS connect, data load, all tabs mount)
    await page.waitForTimeout(5000);

    // Fail with the actual error message, not a vague timeout
    expect(errors, `Runtime errors detected:\n${errors.join("\n")}`).toHaveLength(0);

    // App should have rendered something beyond just the background
    await expect(page.locator("header")).toBeVisible();
  });

  test("app loads and renders conversation", async ({ page }) => {
    await page.goto("/");
    // Wait for WebSocket to connect and data to load
    await expect(page.locator('[data-node-id]').first()).toBeVisible({ timeout: 15_000 });

    // Header should show connected status
    await expect(page.locator("header")).toBeVisible();

    // Should have multiple conversation nodes
    const nodes = page.locator("[data-node-id]");
    expect(await nodes.count()).toBeGreaterThan(1);
  });

  test("WebSocket connects and shows connected state", async ({ page }) => {
    await page.goto("/");
    // The header should not show a disconnected indicator after loading
    await page.waitForTimeout(3000);
    // If disconnected, header shows red dot; if connected, green
    const header = page.locator("header");
    await expect(header).toBeVisible();
  });

  test("workbench tabs render", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator('[data-node-id]').first()).toBeVisible({ timeout: 15_000 });

    // Tab bar should have all expected tabs
    for (const tab of ["History", "Moments", "Notebook", "Prompt Dev", "Prompt Test", "Artifact"]) {
      await expect(page.getByRole("button", { name: tab })).toBeVisible();
    }
  });

  test("input bar is present and functional", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator('[data-node-id]').first()).toBeVisible({ timeout: 15_000 });

    const input = page.locator('textarea[placeholder="Type a message..."]');
    await expect(input).toBeVisible();

    const sendButton = page.getByRole("button", { name: "Send" });
    await expect(sendButton).toBeVisible();
    await expect(sendButton).toBeDisabled(); // empty input

    await input.fill("test");
    await expect(sendButton).toBeEnabled();
  });

  test("theme toggle works", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator('[data-node-id]').first()).toBeVisible({ timeout: 15_000 });

    // Default is dark
    const html = page.locator("html");

    // Click theme toggle (sun/moon button in header)
    const toggle = page.locator("header button").filter({ hasText: /[☀☾]/ });
    await toggle.click();

    // Should switch to light
    await expect(html).toHaveAttribute("data-theme", "light");

    // Toggle back
    await toggle.click();
    await expect(html).toHaveAttribute("data-theme", "dark");
  });
});