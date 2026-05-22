import { test, expect, Page, APIRequestContext } from "@playwright/test";

/**
 * E2E tests for the Browser Panel (Hosted App Panel).
 *
 * Tests real user workflows and known failure modes:
 *   1. Panel launches and renders visibly
 *   2. Multiple panels work independently (each is its own workbench tab)
 *   3. Keyboard input reaches the active panel
 *   4. Agent control state releases cleanly
 *   5. Viewport resize doesn't break the panel
 *   6. Tab switching moves focus correctly
 *
 * Known bugs these cover:
 *   - Keyboard focus lost on tab switch (Q fix 9a3d4b9)
 *   - Stale "agent controlling" banner blocking input (Q fix 9a3d4b9)
 *   - Xpra display collapse on viewport change (Q fix b0b183d)
 *
 * Architecture: Each hosted app is a workbench panel of type "app" with its
 * own tab (workbench-tab-{instanceId}). The panel's iframe has
 * data-panel-id={panelId} from the backend.
 *
 * Target: SA_URL env var (default: http://localhost:5175 = dev)
 */

test.use({ baseURL: process.env.SA_URL || "http://localhost:5175" });

/** Wait for the workbench to be interactive (at least one tab visible). */
async function waitForWorkbench(page: Page) {
  await page.locator('[data-testid^="workbench-tab-"]').first().waitFor({
    state: "visible",
    timeout: 15_000,
  });
}

/** Clean up all panels from the backend (prevent cross-test leakage). */
async function cleanupAllPanels(request: APIRequestContext, base: string) {
  try {
    const resp = await request.get(`${base}/api/panel/list`);
    const data = await resp.json();
    for (const p of data.panels || []) {
      await request.delete(`${base}/api/panel/${p.id}`).catch(() => {});
    }
  } catch {}
}

/**
 * Launch a panel via the API. The WebSocket `panel.launched` message
 * auto-creates a workbench tab of type "app". Returns the panel info.
 */
async function launchPanel(
  page: Page,
  request: APIRequestContext,
  opts: { appType?: string; url?: string; label?: string } = {},
) {
  const base = new URL(page.url()).origin;
  const resp = await request.post(`${base}/api/panel/launch`, {
    data: {
      appType: opts.appType ?? "chrome",
      url: opts.url,
      label: opts.label ?? `Test Panel ${Date.now()}`,
    },
  });
  const data = await resp.json();
  expect(data.status).toBe("ok");
  return data.panel as { id: string; url: string; label: string; port?: number };
}

/** Delete a panel via the API (best-effort cleanup). */
async function deletePanel(page: Page, request: APIRequestContext, panelId: string) {
  const base = new URL(page.url()).origin;
  await request.delete(`${base}/api/panel/${panelId}`).catch(() => {});
}

/**
 * Wait for a launched panel's iframe to appear and switch to its workbench tab.
 * Uses the iframe's data-panel-id to find the correct workbench tab, avoiding
 * strict mode violations from duplicate labels.
 */
async function activatePanel(page: Page, panel: { id: string; label: string }) {
  // Wait for the iframe to appear in the DOM (WebSocket propagation)
  const iframe = page.locator(`iframe[data-panel-id="${panel.id}"]`);
  await expect(iframe).toBeAttached({ timeout: 30_000 });

  // Find which workbench tab contains this iframe by walking up to the panel div
  // Each workbench tab's content area is a div with class "absolute inset-0"
  // keyed by instanceId. The iframe's data-panel-id lets us find the right tab.
  const instanceId = await page.evaluate((panelId) => {
    const el = document.querySelector(`iframe[data-panel-id="${panelId}"]`);
    // Walk up to find the workbench panel container (has class "absolute inset-0")
    let node = el?.parentElement;
    while (node) {
      // The TabContent wrapper div has the instanceId check
      if (node.classList.contains("absolute") && node.classList.contains("inset-0")) {
        // The data-testid on the parent's corresponding tab is workbench-tab-{instanceId}
        // Find matching tab by checking all tabs
        const tabs = document.querySelectorAll('[data-testid^="workbench-tab-"]');
        for (const tab of tabs) {
          const tid = tab.getAttribute("data-testid")?.replace("workbench-tab-", "");
          // Check if clicking this tab would show this panel by matching text content
          if (tid && node.parentElement) {
            const siblings = node.parentElement.children;
            for (let i = 0; i < siblings.length; i++) {
              if (siblings[i] === node) {
                // Find the i-th tab
                const allTabs = document.querySelectorAll('[data-testid^="workbench-tab-"]');
                if (allTabs[i]) {
                  return allTabs[i].getAttribute("data-testid")?.replace("workbench-tab-", "");
                }
              }
            }
          }
        }
      }
      node = node.parentElement;
    }
    return null;
  }, panel.id);

  if (instanceId) {
    await page.locator(`[data-testid="workbench-tab-${instanceId}"]`).click();
  } else {
    // Fallback: click the first tab matching the label
    await page.locator('[data-testid^="workbench-tab-"]', { hasText: panel.label }).first().click();
  }
  await page.waitForTimeout(500);

  return iframe;
}

// Each test gets a clean slate: navigate and remove leftover panels.
test.beforeEach(async ({ page, request }) => {
  const base = process.env.SA_URL || "http://localhost:5175";
  await cleanupAllPanels(request, base);
  await page.goto("/");
  await waitForWorkbench(page);
});

// ---------------------------------------------------------------------------
// 1. Panel launches and renders visibly
// ---------------------------------------------------------------------------

test.describe("Browser panel lifecycle", () => {

  test("1: Panel launches and iframe is visible", async ({ page, request }) => {

    const panel = await launchPanel(page, request, { label: "Launch Test" });

    try {
      const iframe = await activatePanel(page, panel);

      // The iframe should be visible with a nonzero bounding box
      await expect(iframe).toBeVisible({ timeout: 10_000 });
      const box = await iframe.boundingBox();
      expect(box).toBeTruthy();
      expect(box!.width).toBeGreaterThan(100);
      expect(box!.height).toBeGreaterThan(100);
    } finally {
      await deletePanel(page, request, panel.id);
    }
  });

  test("2: Panel close removes iframe from DOM", async ({ page, request }) => {
    const panel = await launchPanel(page, request, { label: "Close Test" });
    const iframe = await activatePanel(page, panel);
    await expect(iframe).toBeVisible({ timeout: 10_000 });

    // Close the panel via API (triggers panel.stopped WS event)
    await deletePanel(page, request, panel.id);

    // iframe should disappear
    await expect(iframe).not.toBeAttached({ timeout: 10_000 });
  });
});

// ---------------------------------------------------------------------------
// 2. Multiple panels work independently
// ---------------------------------------------------------------------------

test.describe("Multiple browser panels", () => {

  test("3: Two panels launch as separate workbench tabs", async ({ page, request }) => {

    const panelA = await launchPanel(page, request, { label: "Multi A" });
    const panelB = await launchPanel(page, request, { label: "Multi B" });

    try {
      // Both iframes should exist in the DOM
      const iframeA = page.locator(`iframe[data-panel-id="${panelA.id}"]`);
      const iframeB = page.locator(`iframe[data-panel-id="${panelB.id}"]`);
      await expect(iframeA).toBeAttached({ timeout: 30_000 });
      await expect(iframeB).toBeAttached({ timeout: 30_000 });

      // Activate Panel B and verify it's visible
      await activatePanel(page, panelB);
      await expect(iframeB).toBeVisible({ timeout: 10_000 });

      // Switch to Panel A and verify it becomes visible
      await activatePanel(page, panelA);
      await expect(iframeA).toBeVisible({ timeout: 10_000 });
    } finally {
      await deletePanel(page, request, panelA.id);
      await deletePanel(page, request, panelB.id);
    }
  });

  test("4: Closing one panel doesn't affect the other", async ({ page, request }) => {


    const survivor = await launchPanel(page, request, { label: "Survivor" });
    const doomed = await launchPanel(page, request, { label: "Doomed" });

    try {
      // Wait for both tabs
      await expect(page.locator('[data-testid^="workbench-tab-"]', { hasText: "Survivor" })).toBeVisible({ timeout: 15_000 });
      await expect(page.locator('[data-testid^="workbench-tab-"]', { hasText: "Doomed" })).toBeVisible({ timeout: 15_000 });

      // Close the doomed panel
      await deletePanel(page, request, doomed.id);
      await expect(page.locator(`iframe[data-panel-id="${doomed.id}"]`)).not.toBeAttached({ timeout: 10_000 });

      // Survivor should still be accessible
      await activatePanel(page, survivor);
      const iframe = page.locator(`iframe[data-panel-id="${survivor.id}"]`);
      await expect(iframe).toBeVisible();
    } finally {
      await deletePanel(page, request, survivor.id);
    }
  });
});

// ---------------------------------------------------------------------------
// 3. Keyboard input reaches the panel
// ---------------------------------------------------------------------------

test.describe("Keyboard focus and input", () => {

  test("5: Active panel iframe receives keyboard focus on click", async ({ page, request }) => {


    const panel = await launchPanel(page, request, { label: "Focus Test" });

    try {
      const iframe = await activatePanel(page, panel);
      await expect(iframe).toBeVisible({ timeout: 10_000 });

      // Click the iframe container to focus
      await iframe.click({ position: { x: 50, y: 50 } });
      await page.waitForTimeout(300);

      // The focused element should be an iframe with our panel's ID
      const focusedTag = await page.evaluate(() => document.activeElement?.tagName);
      expect(focusedTag).toBe("IFRAME");

      const focusedPanelId = await page.evaluate(
        () => (document.activeElement as HTMLIFrameElement)?.dataset?.panelId,
      );
      expect(focusedPanelId).toBe(panel.id);
    } finally {
      await deletePanel(page, request, panel.id);
    }
  });

  test("6: Switching workbench tab auto-focuses the new panel iframe", async ({ page, request }) => {

    // This tests the bug Q fixed in 9a3d4b9: useEffect watches activeTab
    // and calls requestAnimationFrame(() => iframeRef.current?.focus())
    const panelA = await launchPanel(page, request, { label: "Switch A" });
    const panelB = await launchPanel(page, request, { label: "Switch B" });

    try {
      // Activate Panel B, click into its iframe to establish focus there
      const iframeB = await activatePanel(page, panelB);
      await expect(iframeB).toBeVisible({ timeout: 10_000 });
      await iframeB.click({ position: { x: 50, y: 50 } });
      await page.waitForTimeout(300);

      // Now switch to Panel A via activatePanel
      await activatePanel(page, panelA);
      // useEffect fires on activeTab change → requestAnimationFrame → focus
      await page.waitForTimeout(500);

      // Focus should have auto-moved to Panel A's iframe
      const focusedPanelId = await page.evaluate(
        () => (document.activeElement as HTMLIFrameElement)?.dataset?.panelId,
      );
      expect(focusedPanelId).toBe(panelA.id);
    } finally {
      await deletePanel(page, request, panelA.id);
      await deletePanel(page, request, panelB.id);
    }
  });

  test("7: Non-active panel iframe has tabIndex=-1", async ({ page, request }) => {


    const panel = await launchPanel(page, request, { label: "TabIdx Test" });

    try {
      const iframe = await activatePanel(page, panel);
      await expect(iframe).toBeAttached({ timeout: 30_000 });

      // When the panel's workbench tab IS active, tabIndex should be 0
      const tabIdx = await iframe.getAttribute("tabindex");
      expect(tabIdx).toBe("0");

      // Switch away to a different workbench tab (e.g., notebook)
      const notebookTab = page.locator('[data-testid="workbench-tab-notebook"]');
      if (await notebookTab.isVisible()) {
        await notebookTab.click();
        await page.waitForTimeout(300);
        // Now our panel's iframe should have tabIndex=-1
        const tabIdxInactive = await iframe.getAttribute("tabindex");
        expect(tabIdxInactive).toBe("-1");
      }
    } finally {
      await deletePanel(page, request, panel.id);
    }
  });
});

// ---------------------------------------------------------------------------
// 4. Agent control state releases cleanly
// ---------------------------------------------------------------------------

test.describe("Agent control state", () => {

  test("8: Agent claim shows control bar, release clears it", async ({ page, request }) => {


    const panel = await launchPanel(page, request, { label: "Agent Ctrl" });
    const base = new URL(page.url()).origin;

    try {
      await activatePanel(page, panel);

      // Simulate agent claiming the panel
      const claimResp = await request.post(`${base}/api/panel/${panel.id}/agent-claim`, {
        data: { agent: "TestAgent" },
      });
      expect(claimResp.ok()).toBeTruthy();

      // Wait for WebSocket to propagate — control bar should appear
      const controlBar = page.locator('[data-testid="agent-control-bar"]');
      await expect(controlBar).toBeVisible({ timeout: 10_000 });
      await expect(controlBar).toContainText("TestAgent");

      // Release via API
      await request.post(`${base}/api/panel/${panel.id}/agent-release`);

      // Control bar should disappear
      await expect(controlBar).not.toBeVisible({ timeout: 10_000 });
    } finally {
      await deletePanel(page, request, panel.id);
    }
  });

  test("9: Release button in UI clears agent control", async ({ page, request }) => {


    const panel = await launchPanel(page, request, { label: "Release Btn" });
    const base = new URL(page.url()).origin;

    try {
      await activatePanel(page, panel);

      // Claim
      await request.post(`${base}/api/panel/${panel.id}/agent-claim`, {
        data: { agent: "Cinco" },
      });

      const controlBar = page.locator('[data-testid="agent-control-bar"]');
      await expect(controlBar).toBeVisible({ timeout: 10_000 });
      await expect(controlBar).toContainText("Cinco");

      // Click the Release button (Q's fix 9a3d4b9)
      const releaseBtn = controlBar.locator('button:has-text("Release")');
      await expect(releaseBtn).toBeVisible({ timeout: 5_000 });
      await releaseBtn.click();

      // Control bar should disappear
      await expect(controlBar).not.toBeVisible({ timeout: 10_000 });
    } finally {
      await deletePanel(page, request, panel.id);
    }
  });

  test("10: Keyboard input works after agent control is released", async ({ page, request }) => {


    const panel = await launchPanel(page, request, { label: "Post-Release" });
    const base = new URL(page.url()).origin;

    try {
      const iframe = await activatePanel(page, panel);

      // Claim then release
      await request.post(`${base}/api/panel/${panel.id}/agent-claim`, {
        data: { agent: "Cinco" },
      });
      await expect(page.locator('[data-testid="agent-control-bar"]')).toBeVisible({ timeout: 10_000 });

      await request.post(`${base}/api/panel/${panel.id}/agent-release`);
      await expect(page.locator('[data-testid="agent-control-bar"]')).not.toBeVisible({ timeout: 10_000 });

      // Click the iframe to focus it
      await iframe.click({ position: { x: 50, y: 50 } });
      await page.waitForTimeout(300);

      // Verify the iframe has keyboard focus
      const focusedTag = await page.evaluate(() => document.activeElement?.tagName);
      expect(focusedTag).toBe("IFRAME");
    } finally {
      await deletePanel(page, request, panel.id);
    }
  });
});

// ---------------------------------------------------------------------------
// 5 & 6. Viewport resize and survival
// ---------------------------------------------------------------------------

test.describe("Viewport resilience", () => {

  test("11: Panel survives viewport resize", async ({ page, request }) => {


    const panel = await launchPanel(page, request, { label: "Resize Test" });

    try {
      const iframe = await activatePanel(page, panel);
      await expect(iframe).toBeVisible({ timeout: 10_000 });

      const boxBefore = await iframe.boundingBox();
      expect(boxBefore).toBeTruthy();

      // Simulate monitor disconnect: resize to much smaller viewport
      await page.setViewportSize({ width: 800, height: 600 });
      await page.waitForTimeout(1000);

      await expect(iframe).toBeVisible();
      const boxSmall = await iframe.boundingBox();
      expect(boxSmall).toBeTruthy();
      expect(boxSmall!.width).toBeGreaterThan(0);
      expect(boxSmall!.height).toBeGreaterThan(0);

      // Reconnect monitor: resize back to large
      await page.setViewportSize({ width: 1920, height: 1080 });
      await page.waitForTimeout(1000);

      await expect(iframe).toBeVisible();
      const boxLarge = await iframe.boundingBox();
      expect(boxLarge).toBeTruthy();
      expect(boxLarge!.width).toBeGreaterThan(boxSmall!.width);
    } finally {
      await deletePanel(page, request, panel.id);
    }
  });

  test("12: Panel fills available space (not collapsed)", async ({ page, request }) => {


    const panel = await launchPanel(page, request, { label: "Fill Test" });

    try {
      const iframe = await activatePanel(page, panel);
      await expect(iframe).toBeVisible({ timeout: 10_000 });

      await page.setViewportSize({ width: 1200, height: 800 });
      await page.waitForTimeout(1000);

      const box = await iframe.boundingBox();
      expect(box).toBeTruthy();
      // Should fill a significant portion of the panel (not collapsed to 0x0)
      expect(box!.width).toBeGreaterThan(200);
      expect(box!.height).toBeGreaterThan(150);
    } finally {
      await deletePanel(page, request, panel.id);
    }
  });

  test("13: Panel survives rapid resize sequence (monitor drag)", async ({ page, request }) => {


    const panel = await launchPanel(page, request, { label: "Rapid Resize" });

    try {
      const iframe = await activatePanel(page, panel);
      await expect(iframe).toBeVisible({ timeout: 10_000 });

      // Simulate window being dragged between monitors of different sizes
      const sizes = [
        { width: 1440, height: 900 },
        { width: 800, height: 600 },
        { width: 2560, height: 1440 },
        { width: 1024, height: 768 },
        { width: 1440, height: 900 },
      ];

      for (const size of sizes) {
        await page.setViewportSize(size);
        await page.waitForTimeout(200);
      }

      await page.waitForTimeout(1000);

      // Should still be visible and focusable
      await expect(iframe).toBeVisible();
      const box = await iframe.boundingBox();
      expect(box).toBeTruthy();
      expect(box!.width).toBeGreaterThan(0);
      expect(box!.height).toBeGreaterThan(0);

      // Keyboard focus should still work
      await iframe.click({ position: { x: 50, y: 50 } });
      await page.waitForTimeout(300);
      const focusedTag = await page.evaluate(() => document.activeElement?.tagName);
      expect(focusedTag).toBe("IFRAME");
    } finally {
      await deletePanel(page, request, panel.id);
    }
  });
});
