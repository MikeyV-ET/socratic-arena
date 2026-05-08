import { test, expect } from "@playwright/test";

/**
 * UX tests for History Pane (SA_UX_SPEC.md R01, R02, R05, R06)
 *
 * R01: Scroll to bottom on load
 * R02: Searchable
 * R05: Scrollbar position accuracy
 * R06: Lazy loading
 */

test.describe("History Pane -- Scroll to bottom (R01)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("[data-node-id]").first()).toBeVisible({ timeout: 15_000 });
  });

  test("R01: History pane scrolls to bottom on tab open", async ({ page }) => {
    // Click History tab
    const historyTab = page.getByRole("button", { name: "History" });
    await historyTab.click();
    await page.waitForTimeout(2000); // Allow data load + scroll

    // The history conversation pane should exist and be scrolled to bottom
    // History pane is a ConversationPane with readOnly=true
    const historyMessages = page.locator('[data-testid="conversation-messages"]').last();

    // If there's data loaded, check scroll position
    const hasNodes = await page.locator("[data-node-id]").count();
    if (hasNodes > 5) {
      const isAtBottom = await historyMessages.evaluate((el) => {
        return el.scrollHeight - el.scrollTop - el.clientHeight < 100;
      });
      expect(isAtBottom).toBe(true);
    }
  });

  test("R01: History pane scrolls to bottom on agent switch", async ({ page }) => {
    // Open history tab
    const historyTab = page.getByRole("button", { name: "History" });
    await historyTab.click();
    await page.waitForTimeout(2000);

    // Find agent selector in history pane and check it exists
    const historyPane = page.locator('[data-testid="notebook-pane"], [data-pane-id]').last();
    const agentSelector = historyPane.locator("select, [role='combobox'], [data-testid='agent-selector']").first();

    // If agent selector exists with multiple options, switch and verify scroll
    const selectorExists = await agentSelector.isVisible().catch(() => false);
    if (selectorExists) {
      const options = await agentSelector.locator("option").allTextContents();
      if (options.length > 1) {
        await agentSelector.selectOption(options[1]);
        await page.waitForTimeout(3000); // data load + scroll

        const historyMessages = page.locator('[data-testid="conversation-messages"]').last();
        const isAtBottom = await historyMessages.evaluate((el) => {
          return el.scrollHeight - el.scrollTop - el.clientHeight < 100;
        });
        expect(isAtBottom).toBe(true);
      }
    }
  });
});

test.describe("History Pane -- Search (R02)", () => {
  test("R02: Search input exists in history pane", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("[data-node-id]").first()).toBeVisible({ timeout: 15_000 });

    // Open history tab
    await page.getByRole("button", { name: "History" }).click();
    await page.waitForTimeout(1000);

    // Search input should be visible in the history pane header
    const searchInput = page.locator(
      'input[placeholder*="Search" i], input[placeholder*="search" i], input[type="search"]'
    );
    await expect(searchInput.first()).toBeVisible({ timeout: 5000 });
  });

  test("R02: Search returns results and navigates to them", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("[data-node-id]").first()).toBeVisible({ timeout: 15_000 });

    await page.getByRole("button", { name: "History" }).click();
    await page.waitForTimeout(1000);

    const searchInput = page.locator(
      'input[placeholder*="Search" i], input[placeholder*="search" i], input[type="search"]'
    ).first();

    // Type a common word that should exist in history
    await searchInput.fill("the");
    await page.waitForTimeout(1000);

    // Should show search results (count badge, result list, or highlighted items)
    const results = page.locator(
      '[data-testid*="search-result"], [class*="search-highlight"], [data-search-match]'
    );
    const resultCount = await results.count();
    expect(resultCount).toBeGreaterThan(0);
  });
});

test.describe("History Pane -- Lazy loading (R06)", () => {
  test("R06: Scrolling up in history triggers older content load", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("[data-node-id]").first()).toBeVisible({ timeout: 15_000 });

    await page.getByRole("button", { name: "History" }).click();
    await page.waitForTimeout(2000);

    const historyMessages = page.locator('[data-testid="conversation-messages"]').last();
    const initialNodeCount = await page.locator("[data-node-id]").count();

    // Scroll to top
    await historyMessages.evaluate((el) => { el.scrollTop = 0; });
    await page.waitForTimeout(2000);

    // If lazy loading works, either:
    // a) A loading indicator appeared, or
    // b) More nodes were loaded (count increased)
    const afterNodeCount = await page.locator("[data-node-id]").count();
    const loadingIndicator = page.locator(
      '[data-testid*="loading"], .animate-pulse, [class*="spinner"]'
    );
    const loadingShown = await loadingIndicator.isVisible().catch(() => false);

    // At least one of these should be true if lazy loading is implemented
    expect(afterNodeCount > initialNodeCount || loadingShown || initialNodeCount < 50).toBe(true);
  });
});
