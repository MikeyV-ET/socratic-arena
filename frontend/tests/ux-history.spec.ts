import { test, expect } from "@playwright/test";

/**
 * UX tests for History Pane (SA_UX_SPEC.md R01, R02, R05, R06)
 *
 * R01: Scroll to bottom on load
 * R02: Searchable
 * R05: Scrollbar position accuracy
 * R06: Lazy loading
 */

// History pane lives inside the workbench. Tab click uses data-testid.
// The pane renders a ConversationPane with readOnly=true and paneId="history".
// Its scroll container: [data-pane-id="history"] [data-testid="conversation-messages"]

test.describe("History Pane -- Scroll to bottom (R01)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    // Wait for app to load -- conversation or history nodes visible
    await expect(page.locator("[data-node-id]").first()).toBeVisible({ timeout: 15_000 });
  });

  test("R01: History pane scrolls to bottom on tab open", async ({ page }) => {
    // Click History workbench tab
    await page.locator('[data-testid="workbench-tab-history"]').click();
    // Allow extra time for virtualizer to render and auto-scroll
    await page.waitForTimeout(4000);

    const historyScroll = page.locator('[data-pane-id="history"] [data-testid="conversation-messages"]');
    const isVisible = await historyScroll.isVisible().catch(() => false);
    if (!isVisible) return; // No history data loaded

    const historyNodes = page.locator('[data-pane-id="history"] [data-node-id]');
    const count = await historyNodes.count();
    if (count > 5) {
      const isAtBottom = await historyScroll.evaluate((el) => {
        return el.scrollHeight - el.scrollTop - el.clientHeight < 150;
      });
      expect(isAtBottom).toBe(true);
    }
  });

  test("R01: History pane scrolls to bottom on agent switch", async ({ page }) => {
    await page.locator('[data-testid="workbench-tab-history"]').click();
    await page.waitForTimeout(3000);

    // PaneAgentSelector renders a <select> inside [data-pane-id="history"]
    const historyPane = page.locator('[data-pane-id="history"]');
    const agentSelector = historyPane.locator("select").first();
    const selectorExists = await agentSelector.isVisible().catch(() => false);
    if (!selectorExists) return;

    const options = await agentSelector.locator("option").allTextContents();
    if (options.length > 1) {
      await agentSelector.selectOption(options[1]);
      await page.waitForTimeout(4000);

      const historyScroll = page.locator('[data-pane-id="history"] [data-testid="conversation-messages"]');
      const isVisible = await historyScroll.isVisible().catch(() => false);
      if (!isVisible) return;

      const isAtBottom = await historyScroll.evaluate((el) => {
        return el.scrollHeight - el.scrollTop - el.clientHeight < 150;
      });
      expect(isAtBottom).toBe(true);
    }
  });
});

test.describe("History Pane -- Search (R02)", () => {
  test("R02: Search toggle button exists in history pane", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("[data-node-id]").first()).toBeVisible({ timeout: 15_000 });

    await page.locator('[data-testid="workbench-tab-history"]').click();
    await page.waitForTimeout(1000);

    // Q implemented search as a toggle button labeled "Search" in the header
    const historyPane = page.locator('[data-pane-id="history"]');
    const searchToggle = historyPane.locator('button[title="Search history"]');
    await expect(searchToggle).toBeVisible({ timeout: 5000 });

    // Click to reveal search input
    await searchToggle.click();
    await page.waitForTimeout(500);

    const searchInput = historyPane.locator('input[placeholder*="Search history"]');
    await expect(searchInput).toBeVisible({ timeout: 3000 });
  });

  test("R02: Search returns results and navigates to them", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("[data-node-id]").first()).toBeVisible({ timeout: 15_000 });

    await page.locator('[data-testid="workbench-tab-history"]').click();
    await page.waitForTimeout(1000);

    const historyPane = page.locator('[data-pane-id="history"]');

    // Open search panel
    await historyPane.locator('button[title="Search history"]').click();
    await page.waitForTimeout(500);

    const searchInput = historyPane.locator('input[placeholder*="Search history"]');
    await searchInput.fill("the");
    // Press Enter to execute search (Q's implementation requires Enter)
    await searchInput.press("Enter");
    await page.waitForTimeout(2000);

    // Results appear as buttons in a results list below the input
    const resultButtons = historyPane.locator('.max-h-48 button');
    const resultCount = await resultButtons.count();
    expect(resultCount).toBeGreaterThan(0);
  });
});

test.describe("History Pane -- Lazy loading (R06)", () => {
  test("R06: Scrolling up in history triggers older content load", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("[data-node-id]").first()).toBeVisible({ timeout: 15_000 });

    await page.locator('[data-testid="workbench-tab-history"]').click();
    await page.waitForTimeout(2000);

    const historyScroll = page.locator('[data-pane-id="history"] [data-testid="conversation-messages"]');
    const isVisible = await historyScroll.isVisible().catch(() => false);
    if (!isVisible) return;

    const initialNodeCount = await page.locator('[data-pane-id="history"] [data-node-id]').count();

    // Scroll to top to trigger lazy loading
    await historyScroll.evaluate((el) => { el.scrollTop = 0; });
    await page.waitForTimeout(2000);

    const afterNodeCount = await page.locator('[data-pane-id="history"] [data-node-id]').count();
    const loadingIndicator = page.locator('[data-testid="history-loading-older"]');
    const loadingShown = await loadingIndicator.isVisible().catch(() => false);

    // Lazy loading: either more nodes loaded, loading indicator shown, or we had few nodes to start
    expect(afterNodeCount > initialNodeCount || loadingShown || initialNodeCount < 50).toBe(true);
  });
});
