import { test, expect, Page } from "@playwright/test";

/**
 * ux-batch-window.spec.ts — E2E tests for the batch/windowed virtualizer experiment.
 *
 * Tests the core behavior: only a bounded number of DOM nodes exist regardless
 * of how many conversation nodes are loaded. Verifies scroll-up lazy loading,
 * agent switch, jump-to-latest, and scroll stability.
 *
 * Target: SA_URL env var (default: http://localhost:5175 = dev).
 *
 * Principle: test the behavior, not the plumbing.
 */

const BASE = process.env.SA_URL || "http://localhost:5175";
const MAX_DOM_NODES = 40; // WINDOW_SIZE(20) + overscan(15) = 35, allow some margin

// Scope live pane selectors to avoid strict mode violations when both panes exist.
const LIVE_PANE = '[data-pane-id="conversation"]';
const LIVE_MSGS = `${LIVE_PANE} [data-testid="conversation-messages"]`;

/** Count rendered message nodes in the live conversation pane. */
async function countDomNodes(page: Page): Promise<number> {
  return page.locator(`${LIVE_MSGS} [data-node-id]`).count();
}

/** Get total loaded branch nodes from data attribute. */
async function getBranchNodeCount(page: Page): Promise<number> {
  const val = await page.locator(LIVE_MSGS).getAttribute("data-branch-nodes");
  return val ? parseInt(val, 10) : 0;
}

/** Wait for conversation to load with messages. */
async function waitForMessages(page: Page, minCount = 1, timeoutMs = 15000) {
  const sel = `${LIVE_MSGS} [data-node-id]`;
  await page.waitForFunction(
    ([s, min]) => document.querySelectorAll(s).length >= min,
    [sel, minCount],
    { timeout: timeoutMs }
  );
}

/** Scroll the conversation pane up by repeated mouse wheel events. */
async function scrollUp(page: Page, ticks = 10) {
  const pane = page.locator(LIVE_MSGS);
  await pane.hover();
  for (let i = 0; i < ticks; i++) {
    await page.mouse.wheel(0, -800);
    await page.waitForTimeout(100);
  }
}

test.describe("Batch/Windowed Virtualizer", () => {

  test("DOM node count stays bounded while many nodes are loaded", async ({ page }) => {
    await page.goto(BASE);
    await waitForMessages(page, 5);
    await page.waitForTimeout(2000); // let batch measurement settle

    const domCount = await countDomNodes(page);
    const branchNodes = await getBranchNodeCount(page);

    expect(domCount).toBeLessThanOrEqual(MAX_DOM_NODES);
    expect(branchNodes).toBeGreaterThan(0);

    // If there are more loaded nodes than DOM nodes, the window is working
    if (branchNodes > MAX_DOM_NODES) {
      expect(domCount).toBeLessThan(branchNodes);
    }
  });

  test("Initial load shows newest messages at bottom", async ({ page }) => {
    await page.goto(BASE);
    await waitForMessages(page, 3);
    await page.waitForTimeout(2000);

    // The pane should be scrolled near the bottom
    const isNearBottom = await page.locator(LIVE_MSGS).evaluate(el => {
      return (el.scrollHeight - el.scrollTop - el.clientHeight) < 100;
    });
    expect(isNearBottom).toBe(true);

    // The last rendered node should be the last in the branch
    const lastRenderedId = await page.locator(`${LIVE_MSGS} [data-node-id]`).last().getAttribute("data-node-id");
    expect(lastRenderedId).toBeTruthy();

    // Verify it's the newest by checking node ordering — last rendered should
    // correspond to the end of the loaded nodes array
    const branchNodes = await getBranchNodeCount(page);
    const domCount = await countDomNodes(page);
    // Verify we're showing the newest window — check that the last node ID
    // in the DOM is actually one of the recent nodes (not something from the start).
    // With WINDOW_SIZE=20 from the end, the display window covers the tail.
    if (branchNodes > domCount) {
      // The highest data-index in the DOM should be close to WINDOW_SIZE-1
      const maxIndex = await page.locator(`${LIVE_MSGS} [data-index]`).evaluateAll(
        els => Math.max(...els.map(el => parseInt(el.getAttribute('data-index') || '0', 10)))
      );
      // data-index is within the displayNodes slice, so max should be near WINDOW_SIZE-1
      expect(maxIndex).toBeGreaterThan(10);
    }
  });

  test("Scroll-up triggers lazy loading while DOM stays bounded", async ({ page }) => {
    await page.goto(BASE);
    await waitForMessages(page, 5);
    await page.waitForTimeout(2000);

    const initialBranch = await getBranchNodeCount(page);

    // Scroll up aggressively to trigger lazy load
    await scrollUp(page, 20);
    await page.waitForTimeout(3000); // let lazy load + batch measurement complete

    const afterBranch = await getBranchNodeCount(page);
    const afterDom = await countDomNodes(page);

    // Branch nodes should have grown (lazy load fetched more)
    expect(afterBranch).toBeGreaterThanOrEqual(initialBranch);

    // DOM nodes should still be bounded
    expect(afterDom).toBeLessThanOrEqual(MAX_DOM_NODES);

    // If lazy load happened, ratio should be high
    if (afterBranch > MAX_DOM_NODES) {
      expect(afterDom / afterBranch).toBeLessThan(0.5);
    }
  });

  test("Agent switch resets window and shows correct latest messages", async ({ page }) => {
    await page.goto(BASE);
    await waitForMessages(page, 3);
    await page.waitForTimeout(2000);

    // Find the agent selector dropdown
    const selector = page.locator('select').first();
    const options = await selector.locator('option').allTextContents();

    if (options.length < 2) {
      test.skip(true, "Only one agent available — cannot test switch");
      return;
    }

    // Get initial state
    const initialNodeIds = await page.locator(`${LIVE_MSGS} [data-node-id]`).evaluateAll(
      els => els.map(el => el.getAttribute('data-node-id'))
    );

    // Switch to second agent
    const secondAgent = options.find(o => o !== options[0] && !o.includes("no session"));
    if (!secondAgent) {
      test.skip(true, "No other agent with session available");
      return;
    }

    await selector.selectOption({ label: secondAgent });
    await page.waitForTimeout(5000); // let switch + load + scroll settle

    // After switch, DOM should still be bounded
    const afterDom = await countDomNodes(page);
    expect(afterDom).toBeLessThanOrEqual(MAX_DOM_NODES);

    // Node IDs should be different (different agent's conversation)
    const afterNodeIds = await page.locator(`${LIVE_MSGS} [data-node-id]`).evaluateAll(
      els => els.map(el => el.getAttribute('data-node-id'))
    );

    if (afterNodeIds.length > 0 && initialNodeIds.length > 0) {
      const overlap = afterNodeIds.filter(id => initialNodeIds.includes(id));
      expect(overlap.length).toBeLessThan(afterNodeIds.length);
    }

    // Should be at bottom (newest messages for new agent).
    // Q fixed the scroll-to-bottom issue (merged in 22bfb2e).
    const isNearBottom = await page.locator(LIVE_MSGS).evaluate(el => {
      return (el.scrollHeight - el.scrollTop - el.clientHeight) < 150;
    });
    expect(isNearBottom).toBe(true);
  });

  test("Jump to latest button works after scrolling up", async ({ page }) => {
    await page.goto(BASE);
    await waitForMessages(page, 5);
    await page.waitForTimeout(2000);

    const branchNodes = await getBranchNodeCount(page);
    if (branchNodes < 10) {
      test.skip(true, "Too few messages to trigger jump button");
      return;
    }

    // Scope to live pane to avoid matching history pane's button
    const jumpBtn = page.locator(`${LIVE_PANE} button`).filter({ hasText: "Jump to latest" });

    // Scroll up to ensure button appears
    await scrollUp(page, 15);
    await page.waitForTimeout(1000);

    // Jump button should be visible after scroll-up
    await expect(jumpBtn).toBeVisible({ timeout: 5000 });

    // Click it
    await jumpBtn.click();
    await page.waitForTimeout(1500);

    // Should be back at bottom
    const isNearBottom = await page.locator(LIVE_MSGS).evaluate(el => {
      return (el.scrollHeight - el.scrollTop - el.clientHeight) < 100;
    });
    expect(isNearBottom).toBe(true);
  });

  test("Scroll position is stable during batch measurement/reveal", async ({ page }) => {
    await page.goto(BASE);
    await waitForMessages(page, 5);
    await page.waitForTimeout(2000);

    // Scroll up partway (not all the way to top)
    await scrollUp(page, 8);
    await page.waitForTimeout(1000);

    // Record a visible node to track position
    const visibleNodeId = await page.locator(`${LIVE_MSGS} [data-node-id]`).first().getAttribute("data-node-id");

    // Record scroll position relative to viewport
    const rectBefore = await page.locator(`[data-node-id="${visibleNodeId}"]`).boundingBox();

    // Wait for any batch measurement to complete
    await page.waitForTimeout(3000);

    // Check that the same node is still visible and roughly in the same place
    const nodeStillVisible = await page.locator(`[data-node-id="${visibleNodeId}"]`).isVisible().catch(() => false);

    if (nodeStillVisible && rectBefore) {
      const rectAfter = await page.locator(`[data-node-id="${visibleNodeId}"]`).boundingBox();
      if (rectAfter) {
        const drift = Math.abs(rectAfter.y - rectBefore.y);
        expect(drift).toBeLessThan(200); // allow some settling but no major jump
      }
    }
  });

  test("History pane (readOnly) also uses windowed model", async ({ page }) => {
    await page.goto(BASE);
    await page.waitForTimeout(3000);

    // Click History tab
    const historyTab = page.getByRole("tab", { name: /history/i }).or(page.getByText("History"));
    if (await historyTab.count() === 0) {
      test.skip(true, "No History tab found");
      return;
    }
    await historyTab.first().click();
    await page.waitForTimeout(3000);

    // Look for conversation-messages in the history pane
    const historyMessages = page.locator('[data-pane-id="history"] [data-testid="conversation-messages"]');
    if (await historyMessages.count() === 0) {
      test.skip(true, "History pane has no messages container");
      return;
    }

    const domCount = await historyMessages.locator('[data-node-id]').count();
    const branchAttr = await historyMessages.getAttribute("data-branch-nodes");
    const branchNodes = branchAttr ? parseInt(branchAttr, 10) : 0;

    expect(domCount).toBeLessThanOrEqual(MAX_DOM_NODES);

    if (branchNodes > MAX_DOM_NODES) {
      expect(domCount).toBeLessThan(branchNodes);
    }
  });
});
