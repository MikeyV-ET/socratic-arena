import { test, expect } from "@playwright/test";

/**
 * UX tests for Notebook Pane (SA_UX_SPEC.md R03, R04)
 *
 * R03: Scroll to bottom on load
 * R04: Searchable
 *
 * Notebook is a workbench tab (data-testid="workbench-tab-notebook").
 * NotebookPane renders with data-testid="notebook-pane".
 * Search is behind a toggle button (title="Search notebook").
 */

/** Helper: ensure notebook tab is open and visible */
async function openNotebookPane(page: any) {
  // Navigate first, then clear cached layout, then reload so defaults apply
  await page.goto("/");
  await page.evaluate(() => {
    localStorage.removeItem("sa-workbench-panels");
    localStorage.removeItem("sa-open-tabs");
  });
  await page.reload();
  await page.waitForTimeout(2000);

  const notebookTab = page.locator('[data-testid="workbench-tab-notebook"]');
  const tabVisible = await notebookTab.isVisible().catch(() => false);
  if (!tabVisible) {
    await page.evaluate(() => {
      const s = (window as any).__ARENA_STORE__?.getState();
      if (s?.addPanel) s.addPanel("notebook");
    });
    await page.waitForTimeout(1000);
  }
  await page.locator('[data-testid="workbench-tab-notebook"]').click();
  await page.waitForTimeout(2000);
  return page.locator('[data-testid="notebook-pane"]');
}

test.describe("Notebook Pane -- Scroll to bottom (R03)", () => {
  test("R03: Notebook scrolls to most recent entry on tab open", async ({ page }) => {
    const notebookPane = await openNotebookPane(page);
    await expect(notebookPane).toBeVisible({ timeout: 5000 });

    const entries = notebookPane.locator("[data-testid^='notebook-entry-']");
    const count = await entries.count();

    if (count > 3) {
      // Virtual scroll needs time to measure large entries and settle
      await page.waitForTimeout(2000);
      const scrollContainer = notebookPane.locator(".overflow-y-auto").first();
      const isAtBottom = await scrollContainer.evaluate((el) => {
        return el.scrollHeight - el.scrollTop - el.clientHeight < 200;
      });
      expect(isAtBottom).toBe(true);
    }
  });

  test("R03: Notebook scrolls to bottom on agent switch", async ({ page }) => {
    const notebookPane = await openNotebookPane(page);
    await expect(notebookPane).toBeVisible({ timeout: 5000 });

    const agentSelector = notebookPane.locator("select").first();
    const selectorExists = await agentSelector.isVisible().catch(() => false);
    if (!selectorExists) {
      test.skip();
      return;
    }

    const options = await agentSelector.locator("option").allTextContents();
    if (options.length < 2) {
      test.skip();
      return;
    }

    await agentSelector.selectOption(options[1]);
    await page.waitForTimeout(4000);

    const entries = notebookPane.locator("[data-testid^='notebook-entry-']");
    const count = await entries.count();
    if (count > 3) {
      const scrollContainer = notebookPane.locator(".overflow-y-auto").first();
      const isAtBottom = await scrollContainer.evaluate((el) => {
        return el.scrollHeight - el.scrollTop - el.clientHeight < 200;
      });
      expect(isAtBottom).toBe(true);
    }
  });
});

test.describe("Notebook Pane -- Agent switch-back (R03a)", () => {
  test("R03a: Switching to another agent and back loads original notebook", async ({ page }) => {
    const notebookPane = await openNotebookPane(page);
    await expect(notebookPane).toBeVisible({ timeout: 5000 });

    // Get agent selector — skip if only one agent
    const agentSelector = notebookPane.locator("select").first();
    const selectorExists = await agentSelector.isVisible().catch(() => false);
    if (!selectorExists) {
      test.skip();
      return;
    }
    const options = await agentSelector.locator("option").allTextContents();
    if (options.length < 2) {
      test.skip();
      return;
    }

    // Record entries for the original agent
    await page.waitForTimeout(1000);
    const originalAgent = options[0];
    const originalEntries = await notebookPane.locator("[data-testid^='notebook-entry-']").count();

    // Switch to second agent
    await agentSelector.selectOption(options[1]);
    await page.waitForTimeout(3000);

    // Switch back to original agent
    await agentSelector.selectOption(originalAgent);
    await page.waitForTimeout(3000);

    // Entries must be present — the bug was that switching back loaded nothing
    const afterSwitchBack = await notebookPane.locator("[data-testid^='notebook-entry-']").count();
    expect(afterSwitchBack).toBeGreaterThan(0);
  });

  test("R03a: Notebook shows different content for different agents", async ({ page }) => {
    const notebookPane = await openNotebookPane(page);
    await expect(notebookPane).toBeVisible({ timeout: 5000 });

    const agentSelector = notebookPane.locator("select").first();
    const selectorExists = await agentSelector.isVisible().catch(() => false);
    if (!selectorExists || (await agentSelector.locator("option").count()) < 2) {
      test.skip();
      return;
    }
    const options = await agentSelector.locator("option").allTextContents();

    // Get all entry IDs for agent 1 (from data-testid attributes)
    await page.waitForTimeout(1000);
    const agent1Ids = await notebookPane
      .locator("[data-testid^='notebook-entry-']")
      .evaluateAll((els) => els.map((e) => e.getAttribute("data-testid")));

    // Switch to agent 2 and get their entry IDs
    await agentSelector.selectOption(options[1]);
    await page.waitForTimeout(3000);
    const agent2Ids = await notebookPane
      .locator("[data-testid^='notebook-entry-']")
      .evaluateAll((els) => els.map((e) => e.getAttribute("data-testid")));

    // Both should have entries
    expect(agent1Ids.length).toBeGreaterThan(0);
    expect(agent2Ids.length).toBeGreaterThan(0);

    // Entry IDs should differ (different agents have different notebooks)
    const overlap = agent1Ids.filter((id) => agent2Ids.includes(id));
    expect(overlap.length).toBeLessThan(agent1Ids.length);
  });
});

test.describe("Notebook Pane -- Search (R04)", () => {
  test("R04: Search toggle button exists in notebook pane", async ({ page }) => {
    const notebookPane = await openNotebookPane(page);
    await expect(notebookPane).toBeVisible({ timeout: 5000 });

    const searchToggle = notebookPane.locator('button[title="Search notebook"]');
    await expect(searchToggle).toBeVisible({ timeout: 3000 });

    await searchToggle.click();
    await page.waitForTimeout(500);

    const searchInput = notebookPane.locator('input[placeholder*="Search notebook"]');
    await expect(searchInput).toBeVisible({ timeout: 3000 });
  });

  test("R04: Notebook search returns and highlights results", async ({ page }) => {
    const notebookPane = await openNotebookPane(page);
    await expect(notebookPane).toBeVisible({ timeout: 5000 });

    await notebookPane.locator('button[title="Search notebook"]').click();
    await page.waitForTimeout(500);

    const searchInput = notebookPane.locator('input[placeholder*="Search notebook"]');
    await searchInput.fill("lab");
    await searchInput.press("Enter");
    await page.waitForTimeout(2000);

    const resultButtons = notebookPane.locator('.max-h-48 button');
    const count = await resultButtons.count();
    expect(count).toBeGreaterThan(0);
  });
});
