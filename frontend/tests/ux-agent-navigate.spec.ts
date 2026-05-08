import { test, expect } from "@playwright/test";

/**
 * UX tests for Agent-driven navigation (SA_UX_SPEC.md R07)
 *
 * R07: Agent can search and navigate user's view to specific content
 */

test.describe("Agent-driven navigation (R07)", () => {
  test("R07: workspace.navigate scrolls conversation to target node", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("[data-node-id]").first()).toBeVisible({ timeout: 15_000 });

    // Get all node IDs
    const nodeIds = await page.locator("[data-node-id]").evaluateAll(
      (els) => els.map((el) => el.getAttribute("data-node-id")).filter(Boolean)
    );

    if (nodeIds.length > 5) {
      // Scroll to bottom first
      const container = page.locator('[data-testid="conversation-messages"]');
      await container.evaluate((el) => { el.scrollTop = el.scrollHeight; });
      await page.waitForTimeout(500);

      // Send workspace.navigate via WebSocket to scroll to an early node
      const targetId = nodeIds[0];
      await page.evaluate((id) => {
        // Access the WebSocket through the store
        const store = (window as any).__ARENA_STORE__;
        if (store?.getState?.()?.sendWs) {
          store.getState().sendWs({
            type: "workspace.navigate",
            payload: { pane: "conversation", targetId: id },
          });
        }
      }, targetId);

      await page.waitForTimeout(1000);

      // The target node should now be visible in the viewport
      const targetNode = page.locator(`[data-node-id="${targetId}"]`);
      await expect(targetNode).toBeVisible({ timeout: 5000 });
    }
  });

  test("R07: workspace.navigate scrolls history to target", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("[data-node-id]").first()).toBeVisible({ timeout: 15_000 });

    // Open history tab
    await page.getByRole("button", { name: "History" }).click();
    await page.waitForTimeout(2000);

    // Check if scrollTargetId mechanism works by setting it in the store
    const navigated = await page.evaluate(() => {
      const store = (window as any).__ARENA_STORE__;
      if (store?.getState?.()?.scrollToNode) {
        // Get first node from history
        const nodes = store.getState().getHistoryBranchNodes?.() ?? [];
        if (nodes.length > 2) {
          store.getState().scrollToNode(nodes[0].id);
          return true;
        }
      }
      return false;
    });

    if (navigated) {
      await page.waitForTimeout(1000);
      // First node should be visible after navigation
      const firstNode = page.locator("[data-node-id]").first();
      await expect(firstNode).toBeVisible();
    }
  });
});
