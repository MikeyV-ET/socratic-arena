import { test, expect } from "@playwright/test";

/**
 * UX tests for Notebook Pane (SA_UX_SPEC.md R03, R04)
 *
 * R03: Scroll to bottom on load
 * R04: Searchable
 */

test.describe("Notebook Pane -- Scroll to bottom (R03)", () => {
  test("R03: Notebook scrolls to most recent entry on tab open", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("[data-node-id]").first()).toBeVisible({ timeout: 15_000 });

    // Open notebook tab
    await page.getByRole("button", { name: "Notebook" }).click();
    await page.waitForTimeout(2000);

    const notebookPane = page.locator('[data-testid="notebook-pane"]');
    await expect(notebookPane).toBeVisible();

    // Check if there are entries
    const entries = notebookPane.locator("[data-testid^='notebook-entry-']");
    const count = await entries.count();

    if (count > 3) {
      // Scroll container should be near bottom
      const scrollContainer = notebookPane.locator(".overflow-y-auto");
      const isAtBottom = await scrollContainer.evaluate((el) => {
        return el.scrollHeight - el.scrollTop - el.clientHeight < 100;
      });
      expect(isAtBottom).toBe(true);
    }
  });

  test("R03: Notebook scrolls to bottom on agent switch", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("[data-node-id]").first()).toBeVisible({ timeout: 15_000 });

    await page.getByRole("button", { name: "Notebook" }).click();
    await page.waitForTimeout(1000);

    const notebookPane = page.locator('[data-testid="notebook-pane"]');
    const agentSelector = notebookPane.locator("select, [role='combobox']").first();

    const selectorExists = await agentSelector.isVisible().catch(() => false);
    if (selectorExists) {
      const options = await agentSelector.locator("option").allTextContents();
      if (options.length > 1) {
        await agentSelector.selectOption(options[1]);
        await page.waitForTimeout(3000);

        const scrollContainer = notebookPane.locator(".overflow-y-auto");
        const entries = notebookPane.locator("[data-testid^='notebook-entry-']");
        const count = await entries.count();

        if (count > 3) {
          const isAtBottom = await scrollContainer.evaluate((el) => {
            return el.scrollHeight - el.scrollTop - el.clientHeight < 100;
          });
          expect(isAtBottom).toBe(true);
        }
      }
    }
  });
});

test.describe("Notebook Pane -- Search (R04)", () => {
  test("R04: Search input exists in notebook pane", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("[data-node-id]").first()).toBeVisible({ timeout: 15_000 });

    await page.getByRole("button", { name: "Notebook" }).click();
    await page.waitForTimeout(1000);

    const notebookPane = page.locator('[data-testid="notebook-pane"]');
    await expect(notebookPane).toBeVisible();

    // Search input should exist in notebook header
    const searchInput = notebookPane.locator(
      'input[placeholder*="Search" i], input[placeholder*="search" i], input[type="search"]'
    );
    await expect(searchInput.first()).toBeVisible({ timeout: 5000 });
  });

  test("R04: Notebook search returns and highlights results", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("[data-node-id]").first()).toBeVisible({ timeout: 15_000 });

    await page.getByRole("button", { name: "Notebook" }).click();
    await page.waitForTimeout(1000);

    const notebookPane = page.locator('[data-testid="notebook-pane"]');
    const searchInput = notebookPane.locator(
      'input[placeholder*="Search" i], input[placeholder*="search" i], input[type="search"]'
    ).first();

    await searchInput.fill("lab");
    await page.waitForTimeout(1000);

    // Results should be highlighted or a results list shown
    const results = notebookPane.locator(
      '[data-testid*="search-result"], [class*="search-highlight"], [data-search-match]'
    );
    const count = await results.count();
    expect(count).toBeGreaterThan(0);
  });
});
