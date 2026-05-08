import { test, expect } from "@playwright/test";

/**
 * UX tests for Panel UI (SA_UX_SPEC.md R12, R13, R17)
 *
 * R12: Pane close button ~1.5x size
 * R13: App sub-panel close button ~2x size
 * R17: Clipboard paste works into hosted app iframe
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
          // Minimum click target: ~22x22px ("about 1.5x" of ~16px default, allows sub-pixel variance)
          expect(box.width).toBeGreaterThanOrEqual(22);
          expect(box.height).toBeGreaterThanOrEqual(22);
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

test.describe("Clipboard paste in hosted app iframe (R17)", () => {
  test("R17: App panel iframe sandbox includes clipboard permissions", async ({ page, request }) => {
    await page.goto("/");
    await expect(page.locator("[data-node-id]").first()).toBeVisible({ timeout: 15_000 });

    // Launch a terminal panel via the API (lighter than Chrome)
    const base = new URL(page.url()).origin;
    const launchResp = await request.post(`${base}/api/panel/launch`, {
      data: { appType: "terminal", label: "Clipboard Test" },
    });
    const launchData = await launchResp.json();
    expect(launchData.status).toBe("ok");
    const panelId = launchData.panel.id;

    try {
      // Switch to the Apps tab (it's a <div>, not a button)
      await page.locator('[data-testid="workbench-tab-apps"]').click();

      // Wait for the iframe to be in the DOM (may be invisible if not active panel)
      const iframe = page.locator("iframe").first();
      await expect(iframe).toBeAttached({ timeout: 30_000 });

      // Verify sandbox attribute includes clipboard permissions
      const sandbox = await iframe.getAttribute("sandbox");
      expect(sandbox).toBeTruthy();
      expect(sandbox).toContain("allow-clipboard-write");
      expect(sandbox).toContain("allow-clipboard-read");
      expect(sandbox).toContain("allow-scripts");
      expect(sandbox).toContain("allow-same-origin");
    } finally {
      await request.delete(`${base}/api/panel/${panelId}`);
    }
  });
});
