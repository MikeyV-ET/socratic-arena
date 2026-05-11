import { test, expect } from "@playwright/test";

/**
 * UX tests for Conversation Pane (SA_UX_SPEC.md R08-R11)
 *
 * R08: Full text output (intermediate text visible)
 * R09: No Fork button in live conversation pane
 * R10: No Correction/Edit button in live conversation pane
 * R11: Flag button present on all messages
 */

test.describe("Conversation Pane -- Button visibility (R09, R10, R11)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    // Wait for conversation to load
    await expect(page.locator("[data-node-id]").first()).toBeVisible({ timeout: 15_000 });
  });

  test("R09: Fork button is NOT visible in live conversation", async ({ page }) => {
    // Hover over a message to trigger button visibility (buttons show on group-hover)
    const firstMessage = page.locator("[data-node-id]").first();
    await firstMessage.hover();

    // Fork button should not exist in the live conversation pane
    // ForkButton renders a button with a fork/branch icon
    const conversationPane = page.locator('[data-testid="conversation-messages"]');
    const forkButtons = conversationPane.locator("button").filter({ hasText: /fork|branch/i });
    await expect(forkButtons).toHaveCount(0);

    // Also check by the SVG path or title attribute that Q might use
    const forkByTitle = conversationPane.locator('button[title*="Fork"], button[title*="fork"]');
    await expect(forkByTitle).toHaveCount(0);
  });

  test("R10: Correction/Edit button is NOT visible in live conversation", async ({ page }) => {
    const firstMessage = page.locator("[data-node-id]").first();
    await firstMessage.hover();

    const conversationPane = page.locator('[data-testid="conversation-messages"]');

    // CorrectionButton should not be present
    const correctionButtons = conversationPane.locator(
      'button[title*="Correct"], button[title*="correct"], button[title*="Edit"], button[title*="edit"]'
    );
    await expect(correctionButtons).toHaveCount(0);
  });

  test("R11: Flag button IS visible on messages in live conversation", async ({ page }) => {
    // Hover over a non-system message to trigger button visibility
    const messages = page.locator("[data-node-id]");
    const count = await messages.count();
    expect(count).toBeGreaterThan(0);

    // Find an assistant message (has bg-card/50 class or similar)
    const assistantMessage = messages.nth(1); // Usually second message is assistant
    await assistantMessage.hover();

    // Flag button should be visible on hover
    const flagButton = assistantMessage.locator('button[title*="Flag"], button[title*="flag"]');
    // At least one flag button should be visible after hover
    await expect(flagButton.first()).toBeVisible({ timeout: 3000 });
  });
});

test.describe("Conversation Pane -- Scroll behavior", () => {
  test("R01/live: Conversation auto-scrolls to bottom on load", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("[data-node-id]").first()).toBeVisible({ timeout: 15_000 });

    // Give virtualizer time to settle
    await page.waitForTimeout(1000);

    // Scope to live conversation pane (not history pane which also uses ConversationPane)
    const container = page.locator('[data-pane-id="conversation"] [data-testid="conversation-messages"]');
    await expect(container).toBeVisible({ timeout: 10_000 });
    const isAtBottom = await container.evaluate((el) => {
      return el.scrollHeight - el.scrollTop - el.clientHeight < 50;
    });
    expect(isAtBottom).toBe(true);
  });
});

test.describe("Conversation Pane -- Chat panel lazy loading (R20)", () => {
  test("R20: Chat panel loads full agent history, not just live session", async ({ page, request }) => {
    await page.goto("/");
    await expect(page.locator("[data-node-id]").first()).toBeVisible({ timeout: 15_000 });

    // Check how many total nodes the default agent has
    const base = new URL(page.url()).origin;
    const resp = await request.get(`${base}/api/agent/Q/history`);
    test.skip(!resp.ok(), "Q history not available");
    const data = await resp.json();
    test.skip(data.status !== "ok" || !data.truncated, "Q history not truncated -- nothing to lazy-load");

    const totalNodes = data.totalNodes;
    const loadedApiNodes = Object.keys(data.tree?.nodes ?? {}).length;

    // The conversation pane (left side, readOnly=false) should have awareness
    // of the full history, not just the live WebSocket session. Verify by
    // checking that the conversation pane has a spacer div or totalNodes
    // indicator when the agent has truncated history.
    const convPane = page.locator('[data-pane-id="conversation"] [data-testid="conversation-messages"]');
    await expect(convPane).toBeVisible({ timeout: 10_000 });

    // Wait for the live pane to finish loading history (async fetch on mount)
    await expect(convPane).toHaveAttribute("data-live-history", "loaded", { timeout: 15_000 });

    // The conversation pane should show significant history, not just a few
    // live-session nodes. If totalNodes is 9000+ but we only see 10-20,
    // the chat panel is NOT loading all history.
    // For a properly working lazy-load chat panel, we expect either:
    // (a) a spacer div indicating more content above, OR
    // (b) a node count comparable to what the API loads (~100+ from 5MB tail)
    const hasSpacerOrManyNodes = await convPane.evaluate((el) => {
      const nodes = el.querySelectorAll("[data-node-id]");
      // Check for a spacer div (sign of lazy-load awareness)
      const allDivs = el.querySelectorAll("div");
      let hasLargeSpacer = false;
      for (const d of allDivs) {
        const h = d.getBoundingClientRect().height;
        if (h > 5000 && d.children.length === 0) {
          hasLargeSpacer = true;
          break;
        }
      }
      return { nodeCount: nodes.length, hasLargeSpacer };
    });

    // ASSERTION: Chat panel must lazy-load history.
    // Either it has a spacer (aware of unloaded content) or loads many nodes.
    // If neither, the chat panel only shows the live session -- which is the bug
    // Eric identified: "the chat panel should lazy load all of it"
    expect(
      hasSpacerOrManyNodes.hasLargeSpacer || hasSpacerOrManyNodes.nodeCount >= loadedApiNodes,
      `Chat panel shows ${hasSpacerOrManyNodes.nodeCount} nodes but API has ${loadedApiNodes} loaded (${totalNodes} total). Chat panel should lazy-load all history.`
    ).toBe(true);
  });

  test("R20: Chat panel scrolling up triggers lazy loading of older content", async ({ page, request }) => {
    await page.goto("/");
    await expect(page.locator("[data-node-id]").first()).toBeVisible({ timeout: 15_000 });

    const base = new URL(page.url()).origin;
    const resp = await request.get(`${base}/api/agent/Q/history`);
    test.skip(!resp.ok(), "Q history not available");
    const data = await resp.json();
    test.skip(data.status !== "ok" || !data.truncated, "Q history not truncated -- nothing to lazy-load");

    const convPane = page.locator('[data-pane-id="conversation"] [data-testid="conversation-messages"]');
    await expect(convPane).toBeVisible({ timeout: 10_000 });

    // Wait for live history to finish loading
    await expect(convPane).toHaveAttribute("data-live-history", "loaded", { timeout: 15_000 });
    await page.waitForTimeout(2000);

    // Read total branch nodes from data attribute (virtualizer only renders viewport items,
    // so DOM [data-node-id] count stays ~6 regardless of total)
    const initialBranchNodes = Number(await convPane.getAttribute("data-branch-nodes") ?? "0");
    expect(initialBranchNodes).toBeGreaterThan(0);

    // Scroll to the top of loaded content (at spacer boundary)
    const scrollInfo = await convPane.evaluate((el) => {
      const firstChild = el.querySelector("[style*='position: relative']");
      const spacer = firstChild?.previousElementSibling as HTMLElement | null;
      const spacerH = spacer?.offsetHeight ?? 0;
      el.scrollTop = spacerH;
      return { spacerHeight: spacerH, scrollTop: el.scrollTop };
    });

    expect(scrollInfo.spacerHeight).toBeGreaterThan(0);

    // Mouse wheel up from the spacer boundary
    await convPane.hover();
    for (let i = 0; i < 10; i++) {
      await page.mouse.wheel(0, -1000);
    }
    await page.waitForTimeout(2000);

    // Also set scrollTop directly near spacer boundary
    await convPane.evaluate((el) => {
      const firstChild = el.querySelector("[style*='position: relative']");
      const spacer = firstChild?.previousElementSibling as HTMLElement | null;
      const spacerH = spacer?.offsetHeight ?? 0;
      el.scrollTop = Math.max(0, spacerH - 50);
    });
    await page.waitForTimeout(3000);

    // After scrolling up, lazy loading should increase branch node count or show loading
    const afterBranchNodes = Number(await convPane.getAttribute("data-branch-nodes") ?? "0");
    const loadingShown = await page
      .locator('[data-pane-id="conversation"] [data-testid="history-loading-older"]')
      .isVisible()
      .catch(() => false);

    expect(
      afterBranchNodes > initialBranchNodes || loadingShown,
      `Chat panel scroll-up: started with ${initialBranchNodes} branch nodes, now ${afterBranchNodes}. Lazy loading should have loaded more.`
    ).toBe(true);
  });
});

test.describe("Conversation Pane -- Full text output (R08)", () => {
  test("R08: Messages render markdown content", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("[data-node-id]").first()).toBeVisible({ timeout: 15_000 });

    // Every non-empty message should have rendered prose content
    const messages = page.locator("[data-node-id]");
    const count = await messages.count();
    expect(count).toBeGreaterThan(0);

    // At least one message should have visible text content
    const firstContent = messages.first().locator(".prose");
    await expect(firstContent).toBeVisible();
    const text = await firstContent.textContent();
    expect(text?.length).toBeGreaterThan(0);
  });
});
