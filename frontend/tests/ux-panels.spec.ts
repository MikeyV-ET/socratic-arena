import { test, expect } from "@playwright/test";

/**
 * UX tests for Panel UI (SA_UX_SPEC.md R12, R13)
 *
 * R12: Pane close button ~1.5x size
 * R13: App sub-panel close button ~2x size
 */

test.describe("Panel close button sizing (R12, R13)", () => {
  test("R12: Workbench pane close buttons are adequately sized", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("[data-node-id]").first()).toBeVisible({ timeout: 15_000 });

    // Find close buttons on workbench tabs/panes
    // These are typically X buttons near tab headers
    const closeButtons = page.locator(
      'button[aria-label*="close" i], button[title*="close" i], button[aria-label*="Close" i]'
    );

    const count = await closeButtons.count();
    if (count > 0) {
      for (let i = 0; i < Math.min(count, 3); i++) {
        const btn = closeButtons.nth(i);
        const box = await btn.boundingBox();
        if (box) {
          // Minimum click target: 24x24px (1.5x of ~16px default)
          expect(box.width).toBeGreaterThanOrEqual(24);
          expect(box.height).toBeGreaterThanOrEqual(24);
        }
      }
    }
  });

  test("R13: App sub-panel close buttons are large enough", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("[data-node-id]").first()).toBeVisible({ timeout: 15_000 });

    // Navigate to Apps tab if it exists
    const appsTab = page.getByRole("button", { name: /Apps|Panel/i });
    const appsExists = await appsTab.isVisible().catch(() => false);

    if (appsExists) {
      await appsTab.click();
      await page.waitForTimeout(1000);

      // Check close buttons within app panels
      const appCloseButtons = page.locator(
        '[data-testid*="panel"] button[aria-label*="close" i], [data-testid*="panel"] button[title*="close" i]'
      );

      const count = await appCloseButtons.count();
      if (count > 0) {
        for (let i = 0; i < Math.min(count, 3); i++) {
          const btn = appCloseButtons.nth(i);
          const box = await btn.boundingBox();
          if (box) {
            // Minimum click target: 32x32px (2x of ~16px default)
            expect(box.width).toBeGreaterThanOrEqual(32);
            expect(box.height).toBeGreaterThanOrEqual(32);
          }
        }
      }
    }
  });
});
