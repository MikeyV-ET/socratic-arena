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

test.describe("Notebook Pane -- Scroll to bottom (R03)", () => {
  test("R03: Notebook scrolls to most recent entry on tab open", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("[data-node-id]").first()).toBeVisible({ timeout: 15_000 });

    // Open notebook workbench tab
    await page.locator('[data-testid="workbench-tab-notebook"]').click();
    await page.waitForTimeout(2000);

    const notebookPane = page.locator('[data-testid="notebook-pane"]');
    await expect(notebookPane).toBeVisible({ timeout: 5000 });

    const entries = notebookPane.locator("[data-testid^='notebook-entry-']");
    const count = await entries.count();

    if (count > 3) {
      // NotebookPane scroll container: div with ref={scrollRef} and class overflow-y-auto
      const scrollContainer = notebookPane.locator(".overflow-y-auto").first();
      const isAtBottom = await scrollContainer.evaluate((el) => {
        return el.scrollHeight - el.scrollTop - el.clientHeight < 100;
      });
      expect(isAtBottom).toBe(true);
    }
  });

  test("R03: Notebook scrolls to bottom on agent switch", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("[data-node-id]").first()).toBeVisible({ timeout: 15_000 });

    await page.locator('[data-testid="workbench-tab-notebook"]').click();
    await page.waitForTimeout(1000);

    const notebookPane = page.locator('[data-testid="notebook-pane"]');
    await expect(notebookPane).toBeVisible({ timeout: 5000 });

    const agentSelector = notebookPane.locator("select").first();
    const selectorExists = await agentSelector.isVisible().catch(() => false);
    if (!selectorExists) return;

    const options = await agentSelector.locator("option").allTextContents();
    if (options.length > 1) {
      await agentSelector.selectOption(options[1]);
      await page.waitForTimeout(4000);

      const entries = notebookPane.locator("[data-testid^='notebook-entry-']");
      const count = await entries.count();
      if (count > 3) {
        const scrollContainer = notebookPane.locator(".overflow-y-auto").first();
        const isAtBottom = await scrollContainer.evaluate((el) => {
          return el.scrollHeight - el.scrollTop - el.clientHeight < 150;
        });
        expect(isAtBottom).toBe(true);
      }
    }
  });
});

test.describe("Notebook Pane -- Search (R04)", () => {
  test("R04: Search toggle button exists in notebook pane", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("[data-node-id]").first()).toBeVisible({ timeout: 15_000 });

    await page.locator('[data-testid="workbench-tab-notebook"]').click();
    await page.waitForTimeout(1000);

    const notebookPane = page.locator('[data-testid="notebook-pane"]');
    await expect(notebookPane).toBeVisible({ timeout: 5000 });

    // Search is a toggle button in the header
    const searchToggle = notebookPane.locator('button[title="Search notebook"]');
    await expect(searchToggle).toBeVisible({ timeout: 3000 });

    // Click to reveal search input
    await searchToggle.click();
    await page.waitForTimeout(500);

    const searchInput = notebookPane.locator('input[placeholder*="Search notebook"]');
    await expect(searchInput).toBeVisible({ timeout: 3000 });
  });

  test("R04: Notebook search returns and highlights results", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("[data-node-id]").first()).toBeVisible({ timeout: 15_000 });

    await page.locator('[data-testid="workbench-tab-notebook"]').click();
    await page.waitForTimeout(1000);

    const notebookPane = page.locator('[data-testid="notebook-pane"]');
    await expect(notebookPane).toBeVisible({ timeout: 5000 });

    // Open search panel
    await notebookPane.locator('button[title="Search notebook"]').click();
    await page.waitForTimeout(500);

    const searchInput = notebookPane.locator('input[placeholder*="Search notebook"]');
    await searchInput.fill("lab");
    await searchInput.press("Enter");
    await page.waitForTimeout(2000);

    // Results appear as buttons in the results list
    const resultButtons = notebookPane.locator('.max-h-48 button');
    const count = await resultButtons.count();
    expect(count).toBeGreaterThan(0);
  });
});
