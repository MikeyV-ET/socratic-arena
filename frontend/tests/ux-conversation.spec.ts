import { test, expect } from "@playwright/test";

/**
 * UX tests for Conversation Pane (SA_UX_SPEC.md R08-R11)
 *
 * R08: Full text output (intermediate text visible)
 * R09: No Fork button in live conversation pane
 * R10: No Correction/Edit button in live conversation pane
 * R11: Flag button present on all messages
 */

test.describe("Conversation Pane -- Button visibility (R09, R10, R11)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    // Wait for conversation to load
    await expect(page.locator("[data-node-id]").first()).toBeVisible({ timeout: 15_000 });
  });

  test("R09: Fork button is NOT visible in live conversation", async ({ page }) => {
    // Hover over a message to trigger button visibility (buttons show on group-hover)
    const firstMessage = page.locator("[data-node-id]").first();
    await firstMessage.hover();

    // Fork button should not exist in the live conversation pane
    // ForkButton renders a button with a fork/branch icon
    const conversationPane = page.locator('[data-testid="conversation-messages"]');
    const forkButtons = conversationPane.locator("button").filter({ hasText: /fork|branch/i });
    await expect(forkButtons).toHaveCount(0);

    // Also check by the SVG path or title attribute that Q might use
    const forkByTitle = conversationPane.locator('button[title*="Fork"], button[title*="fork"]');
    await expect(forkByTitle).toHaveCount(0);
  });

  test("R10: Correction/Edit button is NOT visible in live conversation", async ({ page }) => {
    const firstMessage = page.locator("[data-node-id]").first();
    await firstMessage.hover();

    const conversationPane = page.locator('[data-testid="conversation-messages"]');

    // CorrectionButton should not be present
    const correctionButtons = conversationPane.locator(
      'button[title*="Correct"], button[title*="correct"], button[title*="Edit"], button[title*="edit"]'
    );
    await expect(correctionButtons).toHaveCount(0);
  });

  test("R11: Flag button IS visible on messages in live conversation", async ({ page }) => {
    // Hover over a non-system message to trigger button visibility
    const messages = page.locator("[data-node-id]");
    const count = await messages.count();
    expect(count).toBeGreaterThan(0);

    // Find an assistant message (has bg-card/50 class or similar)
    const assistantMessage = messages.nth(1); // Usually second message is assistant
    await assistantMessage.hover();

    // Flag button should be visible on hover
    const flagButton = assistantMessage.locator('button[title*="Flag"], button[title*="flag"]');
    // At least one flag button should be visible after hover
    await expect(flagButton.first()).toBeVisible({ timeout: 3000 });
  });
});

test.describe("Conversation Pane -- Scroll behavior", () => {
  test("R01/live: Conversation auto-scrolls to bottom on load", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("[data-node-id]").first()).toBeVisible({ timeout: 15_000 });

    // Give virtualizer time to settle
    await page.waitForTimeout(1000);

    const container = page.locator('[data-testid="conversation-messages"]');
    const isAtBottom = await container.evaluate((el) => {
      return el.scrollHeight - el.scrollTop - el.clientHeight < 50;
    });
    expect(isAtBottom).toBe(true);
  });
});

test.describe("Conversation Pane -- Full text output (R08)", () => {
  test("R08: Messages render markdown content", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("[data-node-id]").first()).toBeVisible({ timeout: 15_000 });

    // Every non-empty message should have rendered prose content
    const messages = page.locator("[data-node-id]");
    const count = await messages.count();
    expect(count).toBeGreaterThan(0);

    // At least one message should have visible text content
    const firstContent = messages.first().locator(".prose");
    await expect(firstContent).toBeVisible();
    const text = await firstContent.textContent();
    expect(text?.length).toBeGreaterThan(0);
  });
});
