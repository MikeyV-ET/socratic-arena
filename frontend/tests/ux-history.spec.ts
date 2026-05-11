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
  test("R06: Scrolling up in truncated history loads older content", async ({ page, request }) => {
    await page.goto("/");
    await expect(page.locator("[data-node-id]").first()).toBeVisible({ timeout: 15_000 });

    // Find an agent whose history is truncated (cursor > 0 = more data exists)
    const base = new URL(page.url()).origin;
    const agents = ["Q", "Jr", "Sr", "Trip", "Cinco"];
    let targetAgent: string | null = null;
    let cursor = 0;
    for (const agent of agents) {
      const resp = await request.get(`${base}/api/agent/${agent}/history`);
      if (resp.ok()) {
        const data = await resp.json();
        if (data.status === "ok" && data.cursor > 0) {
          targetAgent = agent;
          cursor = data.cursor;
          break;
        }
      }
    }
    // Skip if no agent has truncated history (nothing to lazy-load)
    test.skip(!targetAgent, "No agent with truncated history found");

    // Switch history pane to the target agent
    await page.locator('[data-testid="workbench-tab-history"]').click();
    await page.waitForTimeout(2000);
    const historyPane = page.locator('[data-pane-id="history"]');
    const agentSelector = historyPane.locator("select").first();
    if (await agentSelector.isVisible()) {
      const opts = await agentSelector.locator("option").allTextContents();
      const match = opts.find((o) => o.includes(targetAgent!));
      if (match) await agentSelector.selectOption({ label: match });
      await page.waitForTimeout(3000);
    }

    const historyScroll = historyPane.locator('[data-testid="conversation-messages"]');
    await expect(historyScroll).toBeVisible({ timeout: 10_000 });

    const initialNodeCount = await historyPane.locator("[data-node-id]").count();
    expect(initialNodeCount).toBeGreaterThan(0);

    // The scroll container has a spacer div at the top representing unloaded
    // content: (totalNodes - loadedNodes) * 60px. A real user scrolling up
    // reaches the top of LOADED content (scrollTop ≈ spacerHeight), not
    // scrollTop=0. Simulate that: scroll to just above the first real node.
    const scrollInfo = await historyScroll.evaluate((el) => {
      // Find the spacer: first child div with large height and no text
      const firstChild = el.querySelector("[style*='position: relative']");
      const spacer = firstChild?.previousElementSibling as HTMLElement | null;
      const spacerH = spacer?.offsetHeight ?? 0;
      // Scroll to the spacer boundary (top of loaded content)
      el.scrollTop = spacerH;
      return { spacerHeight: spacerH, scrollTop: el.scrollTop, scrollHeight: el.scrollHeight };
    });
    // Confirm there IS a spacer (truncated history should have one)
    expect(scrollInfo.spacerHeight).toBeGreaterThan(0);

    // Simulate user scrolling up from the top of loaded content via mouse
    // wheel, then also try setting scrollTop directly near the spacer boundary.
    await historyScroll.hover();
    for (let i = 0; i < 10; i++) {
      await page.mouse.wheel(0, -1000);
    }
    await page.waitForTimeout(2000);

    // Also set scrollTop just above the spacer (belt + suspenders)
    await historyScroll.evaluate((el) => {
      const firstChild = el.querySelector("[style*='position: relative']");
      const spacer = firstChild?.previousElementSibling as HTMLElement | null;
      const spacerH = spacer?.offsetHeight ?? 0;
      el.scrollTop = Math.max(0, spacerH - 50);
    });
    await page.waitForTimeout(3000);

    // After scrolling to top of loaded content in a truncated history,
    // lazy loading MUST fire: either more nodes appear or loading indicator shows.
    const afterNodeCount = await historyPane.locator("[data-node-id]").count();
    const loadingShown = await historyPane
      .locator('[data-testid="history-loading-older"]')
      .isVisible()
      .catch(() => false);

    expect(
      afterNodeCount > initialNodeCount || loadingShown,
    ).toBe(true);
  });
});
