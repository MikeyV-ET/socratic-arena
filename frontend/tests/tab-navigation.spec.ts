import { test, expect } from "@playwright/test";

/**
 * Tab navigation sequence tests.
 * Verify scroll position is preserved when switching tabs in the workbench.
 */

test.describe("Tab navigation scroll preservation", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    // Wait for data to load
    await expect(page.locator("[data-node-id]").first()).toBeVisible({ timeout: 15_000 });
  });

  /** Helper: get the History pane's scroll container inside the workbench (right pane) */
  function historyScroller(page: import("@playwright/test").Page) {
    return page.locator('[data-pane-id="history"] .overflow-y-auto');
  }

  /** Helper: get scroll position of an element */
  async function getScrollTop(locator: import("@playwright/test").Locator): Promise<number> {
    return locator.evaluate((el) => el.scrollTop);
  }

  test("History scroll position preserved across Prompt Dev round-trip", async ({ page }) => {
    // Switch to History tab (should be default, but be explicit)
    await page.getByRole("button", { name: "History" }).first().click();
    await page.waitForTimeout(300);

    const scroller = historyScroller(page);
    await expect(scroller).toBeVisible();

    // Scroll History to a specific position (middle-ish)
    await scroller.evaluate((el) => { el.scrollTop = 200; });
    await page.waitForTimeout(300);
    const posBefore = await getScrollTop(scroller);
    expect(posBefore).toBeGreaterThanOrEqual(180); // allow small drift

    // Switch to Prompt Dev
    await page.getByRole("button", { name: "Prompt Dev" }).first().click();
    await page.waitForTimeout(300);
    await expect(page.locator("text=Prompt Editor")).toBeVisible();

    // Switch back to History
    await page.getByRole("button", { name: "History" }).first().click();
    await page.waitForTimeout(300);

    // Scroll position should be preserved
    const posAfter = await getScrollTop(scroller);
    expect(posAfter).toBeCloseTo(posBefore, -1); // within ~10px
  });

  test("History scroll position preserved across Artifact round-trip", async ({ page }) => {
    await page.getByRole("button", { name: "History" }).first().click();
    await page.waitForTimeout(300);

    const scroller = historyScroller(page);
    await expect(scroller).toBeVisible();

    // Scroll to a specific position
    await scroller.evaluate((el) => { el.scrollTop = 300; });
    await page.waitForTimeout(300);
    const posBefore = await getScrollTop(scroller);
    expect(posBefore).toBeGreaterThanOrEqual(250);

    // Switch to Artifact
    await page.getByRole("button", { name: "Artifact" }).first().click();
    await page.waitForTimeout(500);

    // Switch back to History
    await page.getByRole("button", { name: "History" }).first().click();
    await page.waitForTimeout(300);

    const posAfter = await getScrollTop(scroller);
    expect(posAfter).toBeCloseTo(posBefore, -1);
  });

  test("History scroll position preserved across Notebook round-trip", async ({ page }) => {
    await page.getByRole("button", { name: "History" }).first().click();
    await page.waitForTimeout(300);

    const scroller = historyScroller(page);
    await expect(scroller).toBeVisible();

    await scroller.evaluate((el) => { el.scrollTop = 150; });
    await page.waitForTimeout(300);
    const posBefore = await getScrollTop(scroller);

    // Switch to Notebook
    await page.getByRole("button", { name: "Notebook" }).first().click();
    await page.waitForTimeout(300);

    // Switch back to History
    await page.getByRole("button", { name: "History" }).first().click();
    await page.waitForTimeout(300);

    const posAfter = await getScrollTop(scroller);
    expect(posAfter).toBeCloseTo(posBefore, -1);
  });

  test("History scroll position preserved across multi-tab sequence", async ({ page }) => {
    // The full Eric scenario: moments click -> history -> conversation -> prompt dev -> back to history
    await page.getByRole("button", { name: "History" }).first().click();
    await page.waitForTimeout(300);

    const scroller = historyScroller(page);
    await expect(scroller).toBeVisible();

    // Set scroll position
    await scroller.evaluate((el) => { el.scrollTop = 250; });
    await page.waitForTimeout(300);
    const posBefore = await getScrollTop(scroller);

    // Bounce through multiple tabs
    await page.getByRole("button", { name: "Moments" }).first().click();
    await page.waitForTimeout(300);

    await page.getByRole("button", { name: "Prompt Dev" }).first().click();
    await page.waitForTimeout(300);

    await page.getByRole("button", { name: "Prompt Test" }).first().click();
    await page.waitForTimeout(300);

    await page.getByRole("button", { name: "Artifact" }).first().click();
    await page.waitForTimeout(300);

    // Return to History
    await page.getByRole("button", { name: "History" }).first().click();
    await page.waitForTimeout(300);

    const posAfter = await getScrollTop(scroller);
    expect(posAfter).toBeCloseTo(posBefore, -1);
  });

  test("Notebook scroll position preserved across tab switches", async ({ page }) => {
    // Not just History — other scrollable panes should preserve too
    await page.getByRole("button", { name: "Notebook" }).first().click();
    await page.waitForTimeout(500);

    // Find the notebook's scrollable container
    const notebookScroller = page.locator(".overflow-y-auto").last();

    // Scroll it
    await notebookScroller.evaluate((el) => { el.scrollTop = 100; });
    await page.waitForTimeout(300);
    const posBefore = await getScrollTop(notebookScroller);

    // Switch away and back
    await page.getByRole("button", { name: "History" }).first().click();
    await page.waitForTimeout(300);
    await page.getByRole("button", { name: "Notebook" }).first().click();
    await page.waitForTimeout(300);

    const posAfter = await getScrollTop(notebookScroller);
    expect(posAfter).toBeCloseTo(posBefore, -1);
  });
});