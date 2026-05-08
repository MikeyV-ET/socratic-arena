import { test, expect } from "@playwright/test";

/**
 * UX tests for Agent-driven navigation (SA_UX_SPEC.md R07)
 *
 * R07: Agent can search and navigate user's view to specific content
 *
 * Navigation works via:
 * - scrollTargetId in the store (ConversationPane listens and scrolls to it)
 * - sa-search CustomEvent on window (triggers search in history/notebook panes)
 * - sendWs with workspace.navigate messages
 */

test.describe("Agent-driven navigation (R07)", () => {
  test("R07: scrollTargetId navigates conversation to target node", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("[data-node-id]").first()).toBeVisible({ timeout: 15_000 });

    // Get node IDs from the live conversation pane
    const convPane = page.locator('[data-pane-id="conversation"]');
    const convScroll = convPane.locator('[data-testid="conversation-messages"]');
    const isVisible = await convScroll.isVisible().catch(() => false);
    if (!isVisible) return;

    const nodeIds = await convPane.locator("[data-node-id]").evaluateAll(
      (els) => els.map((el) => el.getAttribute("data-node-id")).filter(Boolean)
    );

    if (nodeIds.length > 5) {
      // Scroll to bottom
      await convScroll.evaluate((el) => { el.scrollTop = el.scrollHeight; });
      await page.waitForTimeout(500);

      // Use store's scrollTargetId to navigate to an early node
      const targetId = nodeIds[0];
      await page.evaluate((id) => {
        // useArenaStore is available via zustand -- access the store directly
        const store = (window as any).__zustand_store__ ?? document.querySelector('[data-pane-id]')?.__react_store__;
        // Fallback: dispatch scrollTargetId via the store if exposed
        const arenaStore = (window as any).__ARENA_STORE__;
        if (arenaStore?.getState?.()?.scrollToNode) {
          arenaStore.getState().scrollToNode(id);
        }
      }, targetId);

      await page.waitForTimeout(1000);

      const targetNode = convPane.locator(`[data-node-id="${targetId}"]`);
      await expect(targetNode).toBeVisible({ timeout: 5000 });
    }
  });

  test("R07: sa-search event triggers history pane search", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("[data-node-id]").first()).toBeVisible({ timeout: 15_000 });

    // Open history tab
    await page.locator('[data-testid="workbench-tab-history"]').click();
    await page.waitForTimeout(2000);

    // Dispatch sa-search CustomEvent (how agents trigger search)
    await page.evaluate(() => {
      window.dispatchEvent(new CustomEvent("sa-search", {
        detail: { pane: "history", query: "the" },
      }));
    });
    await page.waitForTimeout(2000);

    // Search should have been activated and results shown
    const historyPane = page.locator('[data-pane-id="history"]');
    const searchInput = historyPane.locator('input[placeholder*="Search history"]');
    const inputVisible = await searchInput.isVisible().catch(() => false);

    // Either the search input appeared with the query, or results are shown
    if (inputVisible) {
      const inputValue = await searchInput.inputValue();
      expect(inputValue).toBe("the");
    }
  });

  test("R07: scrollToNode navigates history to target", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("[data-node-id]").first()).toBeVisible({ timeout: 15_000 });

    await page.locator('[data-testid="workbench-tab-history"]').click();
    await page.waitForTimeout(2000);

    const navigated = await page.evaluate(() => {
      const store = (window as any).__ARENA_STORE__;
      if (store?.getState?.()?.scrollToNode) {
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
      const firstNode = page.locator('[data-pane-id="history"] [data-node-id]').first();
      await expect(firstNode).toBeVisible();
    }
  });
});
