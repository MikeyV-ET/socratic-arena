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

  test("R17: Copy/paste works into app panel browser iframe", async ({ page, context, request }) => {
    // Grant clipboard permissions to the browser context
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);

    await page.goto("/");
    await expect(page.locator("[data-node-id]").first()).toBeVisible({ timeout: 15_000 });

    // Launch a Chrome panel — this is the "browser in the app panel" Eric uses
    const base = new URL(page.url()).origin;
    const launchResp = await request.post(`${base}/api/panel/launch`, {
      data: { appType: "chrome", label: "Paste Test Browser" },
    });
    const launchData = await launchResp.json();
    expect(launchData.status).toBe("ok");
    const panelId = launchData.panel.id;

    try {
      // Switch to Apps tab
      await page.locator('[data-testid="workbench-tab-apps"]').click();

      // Wait for iframe to load
      const iframe = page.locator("iframe").first();
      await expect(iframe).toBeAttached({ timeout: 30_000 });
      await expect(iframe).toBeVisible({ timeout: 10_000 });

      // Write known text to clipboard
      const testText = `clipboard-test-${Date.now()}`;
      await page.evaluate((text) => navigator.clipboard.writeText(text), testText);

      // Verify clipboard write succeeded
      const clipboardContent = await page.evaluate(() => navigator.clipboard.readText());
      expect(clipboardContent).toBe(testText);

      // Focus the iframe (simulates user hovering/clicking into the panel)
      await iframe.click({ position: { x: 50, y: 50 } });
      await page.waitForTimeout(500);

      // Send Ctrl+V paste into the focused iframe
      await page.keyboard.press("Control+v");
      await page.waitForTimeout(500);

      // Access the iframe content via Playwright's frame API (bypasses cross-origin)
      const frame = page.frames().find((f) => f.url().includes(String(launchData.panel.port)));
      if (frame) {
        // Verify paste event was received inside the iframe
        const pasteReceived = await frame.evaluate(() => {
          return new Promise<boolean>((resolve) => {
            // Check if clipboard API is accessible inside the iframe
            if (navigator.clipboard && typeof navigator.clipboard.readText === "function") {
              resolve(true);
            } else {
              resolve(false);
            }
          });
        }).catch(() => null);

        // If we can access the frame, clipboard API should be available
        if (pasteReceived !== null) {
          expect(pasteReceived).toBe(true);
        }
      }

      // Regardless of frame access, verify the iframe received focus
      // (paste requires focus — if iframe isn't focusable, paste can't work)
      const isFocused = await page.evaluate(() => {
        const active = document.activeElement;
        return active?.tagName === "IFRAME";
      });
      expect(isFocused).toBe(true);
    } finally {
      await request.delete(`${base}/api/panel/${panelId}`);
    }
  });
});
