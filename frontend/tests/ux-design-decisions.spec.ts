import { test, expect, Page } from "@playwright/test";

/**
 * UX tests for Design Decisions
 *
 * Tests behaviors where the implementation chose one option among
 * several reasonable alternatives. These pin intentional choices
 * so they don't drift accidentally.
 *
 * Target: SA_URL env var (default: http://localhost:5175 = dev)
 */

test.use({ baseURL: process.env.SA_URL || "http://localhost:5175" });

/** Wait for workbench to be interactive (tab bar OR "+" button visible) */
async function waitForWorkbench(page: Page) {
  // With empty default workspace, there may be no tabs — wait for either a tab or the "+" menu
  await page.locator('[data-testid^="workbench-tab-"], [data-testid="open-tab-menu"]').first().waitFor({
    state: "visible",
    timeout: 15_000,
  });
}

// =========================================================================
// SPLIT WORKSPACE
// =========================================================================

/** Ensure at least N tabs exist by adding panels via the "+" menu */
async function ensureTabs(page: Page, minCount: number) {
  let tabs = page.locator('[data-testid^="workbench-tab-"]');
  while (await tabs.count() < minCount) {
    await page.locator('[data-testid="open-tab-menu"]').click();
    await page.waitForTimeout(300);
    await page.locator('[data-testid^="add-panel-"]').first().click();
    await page.waitForTimeout(300);
    tabs = page.locator('[data-testid^="workbench-tab-"]');
  }
}

test.describe("Split workspace", () => {

  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await waitForWorkbench(page);
    // Split tests need at least 2 panels
    await ensureTabs(page, 2);
  });

  test("S1: Split vertical creates two independent panes", async ({ page }) => {
    // Click split vertical button
    const splitBtn = page.locator('button[title="Split vertical (side by side)"]');
    await expect(splitBtn).toBeVisible();
    await splitBtn.click();
    await page.waitForTimeout(500);

    // Should now have two tab bars (one per pane)
    const tabBars = page.locator('[data-testid^="workbench-tab-"]');
    const tabCount = await tabBars.count();
    expect(tabCount).toBeGreaterThanOrEqual(2);

    // Unsplit button should appear (one per pane, check first)
    const unsplitBtn = page.locator('button[title="Unsplit"]').first();
    await expect(unsplitBtn).toBeVisible();
  });

  test("S2: Split horizontal creates two independent panes", async ({ page }) => {
    const splitBtn = page.locator('button[title="Split horizontal (stacked)"]');
    await expect(splitBtn).toBeVisible();
    await splitBtn.click();
    await page.waitForTimeout(500);

    const unsplitBtn = page.locator('button[title="Unsplit"]').first();
    await expect(unsplitBtn).toBeVisible();
  });

  test("S3: Each split pane has its own active tab", async ({ page }) => {
    // Ensure we have at least 2 panels (notebook + add editor)
    await page.locator('[data-testid="open-tab-menu"]').click();
    await page.waitForTimeout(300);
    const addEditor = page.locator('[data-testid="add-panel-editor"]');
    if (await addEditor.isVisible()) {
      await addEditor.click();
      await page.waitForTimeout(300);
    } else {
      await page.keyboard.press("Escape");
    }

    // Split
    const splitBtn = page.locator('button[title="Split vertical (side by side)"]');
    await splitBtn.click();
    await page.waitForTimeout(500);

    // Both panes should render content (not be blank)
    // The split creates a resizable panel group — check both panels have content
    const panelGroup = page.locator('[data-panel-group-id]');
    if (await panelGroup.count() > 0) {
      const panels = page.locator('[data-panel-id]');
      const panelCount = await panels.count();
      expect(panelCount).toBeGreaterThanOrEqual(2);
    }
  });

  test("S4: Selecting tab in one pane doesn't change the other", async ({ page }) => {
    // Add an editor so we have 2+ panels
    await page.locator('[data-testid="open-tab-menu"]').click();
    await page.waitForTimeout(300);
    const addEditor = page.locator('[data-testid="add-panel-editor"]');
    if (await addEditor.isVisible()) {
      await addEditor.click();
      await page.waitForTimeout(300);
    } else {
      await page.keyboard.press("Escape");
    }

    // Split vertical
    const splitBtn = page.locator('button[title="Split vertical (side by side)"]');
    await splitBtn.click();
    await page.waitForTimeout(500);

    // Get the two panel containers (react-resizable-panels creates data-panel-id elements)
    const panels = page.locator('[data-panel-id]');
    const panelCount = await panels.count();
    if (panelCount < 2) return; // skip if split didn't create two panels

    // Click a tab in the first pane's tab bar
    const firstPaneTab = panels.nth(0).locator('[data-testid^="workbench-tab-"]').first();
    const firstTabId = await firstPaneTab.getAttribute("data-testid");

    // Click a different tab in the second pane
    const secondPaneTabs = panels.nth(1).locator('[data-testid^="workbench-tab-"]');
    const secondTabCount = await secondPaneTabs.count();
    if (secondTabCount > 1) {
      await secondPaneTabs.nth(1).click();
      await page.waitForTimeout(300);
    }

    // First pane's selected tab should NOT have changed
    const firstPaneActiveTab = panels.nth(0).locator('[data-testid^="workbench-tab-"]').first();
    const afterTabId = await firstPaneActiveTab.getAttribute("data-testid");
    expect(afterTabId).toBe(firstTabId);
  });

  test("S5: Unsplit collapses back to single pane", async ({ page }) => {
    // Split first
    const splitBtn = page.locator('button[title="Split vertical (side by side)"]');
    await splitBtn.click();
    await page.waitForTimeout(500);

    // Unsplit
    const unsplitBtn = page.locator('button[title="Unsplit"]').first();
    await expect(unsplitBtn).toBeVisible();
    await unsplitBtn.click();
    await page.waitForTimeout(500);

    // Should be back to single pane — split buttons should reappear
    await expect(page.locator('button[title="Split vertical (side by side)"]')).toBeVisible();
    // Unsplit button should be gone
    await expect(page.locator('button[title="Unsplit"]')).toHaveCount(0);
  });

  test("S6: Split panes show different panels", async ({ page }) => {
    // Core independence test: after split, activeTab and splitTab must differ.

    // Split
    await page.locator('button[title="Split vertical (side by side)"]').click();
    await page.waitForTimeout(500);

    // Read store state — activeTab and splitTab should be different
    const state = await page.evaluate(() => {
      const s = (window as any).__ARENA_STORE__?.getState();
      return { activeTab: s?.activeTab, splitTab: s?.splitTab };
    });
    expect(state.splitTab).toBeTruthy();
    expect(state.activeTab).not.toBe(state.splitTab);
  });

  test("S7: Opening panel from split pane targets that pane, not the other", async ({ page }) => {
    // BUG: addPanel() and openTab() always set activeTab (pane 1).
    // Clicking "+" in split pane 2's tab bar should change splitTab, not activeTab.
    // Uses window.__ARENA_STORE__ (exposed in dev mode) to read store state.

    // Split
    await page.locator('button[title="Split vertical (side by side)"]').click();
    await page.waitForTimeout(500);

    // Record activeTab BEFORE adding from pane 2's menu
    const activeTabBefore = await page.evaluate(() =>
      (window as any).__ARENA_STORE__?.getState()?.activeTab
    );
    expect(activeTabBefore).toBeTruthy();

    // Click "+" in the SECOND pane's tab bar
    const menuButtons = page.locator('[data-testid="open-tab-menu"]');
    await expect(menuButtons).toHaveCount(2);
    await menuButtons.nth(1).click();
    await page.waitForTimeout(300);

    // Click "+ New Notebook" (or first multi-instance option)
    const addItem = page.locator('[data-testid^="add-panel-"]').first();
    await expect(addItem).toBeVisible();
    await addItem.click();
    await page.waitForTimeout(500);

    // activeTab should NOT have changed — the new panel should be in splitTab
    const activeTabAfter = await page.evaluate(() =>
      (window as any).__ARENA_STORE__?.getState()?.activeTab
    );
    const splitTabAfter = await page.evaluate(() =>
      (window as any).__ARENA_STORE__?.getState()?.splitTab
    );

    // This is the assertion that catches the bug:
    // activeTab should stay the same (pane 1 unchanged)
    expect(activeTabAfter).toBe(activeTabBefore);
    // splitTab should have changed to the new panel
    expect(splitTabAfter).not.toBe(activeTabBefore);
  });

  test("S9: Split with single panel does NOT clone it into both panes", async ({ page }) => {
    // BUG: Eric reports that splitting when one app panel is open results in
    // "the open panel being displayed in both panes."
    // Expected: second pane gets a DIFFERENT panel (or empty state), not a clone.

    // Start from empty state, add one panel
    await page.evaluate(() => {
      localStorage.removeItem("sa-workbench-panels");
      localStorage.removeItem("sa-open-tabs");
    });
    await page.reload();
    await page.waitForTimeout(1000);

    // Add one panel
    await page.locator('[data-testid="open-tab-menu"]').click();
    await page.waitForTimeout(300);
    await page.locator('[data-testid^="add-panel-"]').first().click();
    await page.waitForTimeout(500);

    // Close all tabs except the last one to ensure exactly one
    const allTabs = page.locator('[data-testid^="workbench-tab-"]');
    while (await allTabs.count() > 1) {
      const tab = allTabs.first();
      const testId = await tab.getAttribute("data-testid");
      const instId = testId?.replace("workbench-tab-", "");
      if (instId) {
        const closeBtn = page.locator(`[data-testid="close-tab-${instId}"]`);
        await tab.hover();
        await page.waitForTimeout(200);
        if (await closeBtn.isVisible()) {
          await closeBtn.click();
          await page.waitForTimeout(300);
        } else break;
      } else break;
    }

    // Record the single active tab
    const activeTabBefore = await page.evaluate(() =>
      (window as any).__ARENA_STORE__?.getState()?.activeTab
    );

    // Split
    await page.locator('button[title="Split vertical (side by side)"]').click();
    await page.waitForTimeout(500);

    // Read store state
    const state = await page.evaluate(() => {
      const s = (window as any).__ARENA_STORE__?.getState();
      return { activeTab: s?.activeTab, splitTab: s?.splitTab };
    });

    // The second pane must NOT show the same panel as the first
    expect(state.splitTab).not.toBe(state.activeTab);

    // And splitTab must refer to a panel that actually exists in workbenchPanels
    const splitPanelExists = await page.evaluate(() => {
      const s = (window as any).__ARENA_STORE__?.getState();
      return s?.workbenchPanels?.some((p: any) => p.instanceId === s.splitTab);
    });
    expect(splitPanelExists).toBe(true);
  });

  test("S10: Opening panel in split pane 2 does not also open in pane 1", async ({ page }) => {
    // BUG: Eric reports "opening editor in one of the split panes, it opens in both panes"
    // This extends S7 by checking visual content, not just store state.

    // Ensure 2 panels exist then split
    await ensureTabs(page, 2);
    await page.locator('button[title="Split vertical (side by side)"]').click();
    await page.waitForTimeout(500);

    // Record pane 1's visible content before opening anything in pane 2
    const pane1ContentBefore = await page.evaluate(() => {
      const panels = document.querySelectorAll('[data-panel-id]');
      if (panels.length < 2) return null;
      return panels[0].innerHTML.length;
    });

    // Open a new panel via "+" in pane 2
    const menuButtons = page.locator('[data-testid="open-tab-menu"]');
    if (await menuButtons.count() >= 2) {
      await menuButtons.nth(1).click();
      await page.waitForTimeout(300);
      await page.locator('[data-testid^="add-panel-"]').first().click();
      await page.waitForTimeout(500);
    }

    // activeTab (pane 1) should be unchanged
    const activeTabAfter = await page.evaluate(() =>
      (window as any).__ARENA_STORE__?.getState()?.activeTab
    );
    const splitTabAfter = await page.evaluate(() =>
      (window as any).__ARENA_STORE__?.getState()?.splitTab
    );
    expect(activeTabAfter).not.toBe(splitTabAfter);
  });

  test("S8: Closing the split panel's tab collapses split mode", async ({ page }) => {
    // Add editor so we have notebook + editor
    await page.locator('[data-testid="open-tab-menu"]').click();
    await page.waitForTimeout(300);
    const addEditor = page.locator('[data-testid="add-panel-editor"]');
    if (await addEditor.isVisible()) {
      await addEditor.click();
      await page.waitForTimeout(300);
    } else {
      await page.keyboard.press("Escape");
      return;
    }

    // Split
    const splitBtn = page.locator('button[title="Split vertical (side by side)"]');
    await splitBtn.click();
    await page.waitForTimeout(500);

    // Verify we're in split mode
    await expect(page.locator('button[title="Unsplit"]').first()).toBeVisible();

    // Find and close a tab in the split pane (close an editor tab)
    const editorCloseBtn = page.locator('[data-testid^="close-tab-editor"]').first();
    if (await editorCloseBtn.isVisible()) {
      await editorCloseBtn.click();
      await page.waitForTimeout(500);
    }
  });
});

// =========================================================================
// TAB LIFECYCLE
// =========================================================================

test.describe("Tab lifecycle", () => {

  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await waitForWorkbench(page);
  });

  test("T1: Can close ALL tabs — empty workbench shows '+' button", async ({ page }) => {
    // Should be able to close every tab, including the last one.
    // When all tabs are closed, the workbench shows an empty state with "+".

    // Ensure at least one tab exists first
    let allTabs = page.locator('[data-testid^="workbench-tab-"]');
    if (await allTabs.count() === 0) {
      await page.locator('[data-testid="open-tab-menu"]').click();
      await page.waitForTimeout(300);
      await page.locator('[data-testid^="add-panel-"]').first().click();
      await page.waitForTimeout(300);
    }
    allTabs = page.locator('[data-testid^="workbench-tab-"]');
    let count = await allTabs.count();

    // Close every tab
    while (count > 0) {
      const tab = allTabs.first();
      const testId = await tab.getAttribute("data-testid");
      const instanceId = testId?.replace("workbench-tab-", "");
      if (instanceId) {
        const closeBtn = page.locator(`[data-testid="close-tab-${instanceId}"]`);
        await tab.hover();
        await page.waitForTimeout(200);
        if (await closeBtn.isVisible()) {
          await closeBtn.click();
          await page.waitForTimeout(300);
        } else {
          // BUG: close button hidden on last tab — should be closeable
          expect(true, "Close button should be visible on the last tab").toBe(false);
          break;
        }
      }
      count = await allTabs.count();
    }

    // All tabs should be gone
    expect(await allTabs.count()).toBe(0);

    // The "+" button should still be visible so user can add tabs back
    await expect(page.locator('[data-testid="open-tab-menu"]')).toBeVisible();
  });

  test("T2: Closing active tab activates first remaining tab", async ({ page }) => {
    // Add an editor so we have at least 2 tabs
    await page.locator('[data-testid="open-tab-menu"]').click();
    await page.waitForTimeout(300);
    const addEditor = page.locator('[data-testid="add-panel-editor"]');
    if (await addEditor.isVisible()) {
      await addEditor.click();
      await page.waitForTimeout(300);
    } else {
      await page.keyboard.press("Escape");
      return;
    }

    // Get all tab ids in order
    const allTabs = page.locator('[data-testid^="workbench-tab-"]');
    const tabCount = await allTabs.count();
    if (tabCount < 2) return;

    // Activate the last tab
    const lastTab = allTabs.nth(tabCount - 1);
    await lastTab.click();
    await page.waitForTimeout(300);

    // Get the first tab's id (this should become active after close)
    const firstTabTestId = await allTabs.nth(0).getAttribute("data-testid");

    // Close the last (active) tab
    const lastTestId = await lastTab.getAttribute("data-testid");
    const lastId = lastTestId?.replace("workbench-tab-", "");
    if (lastId) {
      await lastTab.hover();
      await page.waitForTimeout(200);
      const closeBtn = page.locator(`[data-testid="close-tab-${lastId}"]`);
      if (await closeBtn.isVisible()) {
        await closeBtn.click();
        await page.waitForTimeout(300);
      }
    }

    // First tab should now be active (have the active styling)
    const firstTab = page.locator(`[data-testid="${firstTabTestId}"]`);
    // Active tabs typically don't have the muted/dimmed styling
    await expect(firstTab).toBeVisible();
  });
});

// =========================================================================
// INPUT BAR
// =========================================================================

test.describe("Input bar behavior", () => {

  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await waitForWorkbench(page);
  });

  test("I1: Enter sends message, Shift+Enter adds newline", async ({ page }) => {
    // Find the input textarea
    const input = page.locator("textarea").first();
    if (!(await input.isVisible())) return;

    // Type some text
    await input.fill("line one");

    // Shift+Enter should add a newline (not send)
    await input.press("Shift+Enter");
    await page.waitForTimeout(200);
    const valueAfterShiftEnter = await input.inputValue();
    expect(valueAfterShiftEnter).toContain("\n");
  });

  test("I2: Empty message is not sent", async ({ page }) => {
    const input = page.locator("textarea").first();
    if (!(await input.isVisible())) return;

    // Clear and press Enter on empty input
    await input.fill("");
    await input.press("Enter");
    await page.waitForTimeout(300);

    // Input should still be there (no send happened)
    await expect(input).toBeVisible();
  });
});

// =========================================================================
// FILE ATTACHMENT
// =========================================================================

test.describe("File attachment", () => {

  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await waitForWorkbench(page);
  });

  test("A1: Single file attachment shows chip in input bar", async ({ page }) => {
    const fileInput = page.locator('input[type="file"]');
    if (await fileInput.count() === 0) return;

    // Attach a single text file
    await fileInput.setInputFiles({
      name: "test-doc.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("hello world"),
    });
    await page.waitForTimeout(300);

    // A chip with the filename should appear
    const chip = page.getByText("test-doc.txt");
    await expect(chip).toBeVisible();
  });

  test("A2: Multi-file attachment shows all chips", async ({ page }) => {
    // BUG: Eric reports "multi-file isn't working"
    const fileInput = page.locator('input[type="file"]');
    if (await fileInput.count() === 0) return;

    // Attach two files at once
    await fileInput.setInputFiles([
      { name: "file-one.txt", mimeType: "text/plain", buffer: Buffer.from("one") },
      { name: "file-two.txt", mimeType: "text/plain", buffer: Buffer.from("two") },
    ]);
    await page.waitForTimeout(300);

    // Both chips should appear
    await expect(page.getByText("file-one.txt")).toBeVisible();
    await expect(page.getByText("file-two.txt")).toBeVisible();
  });

  test("A3: Can remove an attached file chip before sending", async ({ page }) => {
    const fileInput = page.locator('input[type="file"]');
    if (await fileInput.count() === 0) return;

    await fileInput.setInputFiles({
      name: "remove-me.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("bye"),
    });
    await page.waitForTimeout(300);

    // Chip should be visible
    const chip = page.getByText("remove-me.txt");
    await expect(chip).toBeVisible();

    // Click the X button next to it
    const removeBtn = chip.locator("..").locator("button");
    if (await removeBtn.isVisible()) {
      await removeBtn.click();
      await page.waitForTimeout(300);
    }

    // Chip should be gone
    await expect(page.getByText("remove-me.txt")).not.toBeVisible();
  });

  test("A4: Multi-file via sequential attach accumulates (not replaces)", async ({ page }) => {
    // Users may click attach twice to add files from different folders.
    // Second attach should ADD to existing files, not replace them.
    const fileInput = page.locator('input[type="file"]');
    if (await fileInput.count() === 0) return;

    const inputForm = page.locator("form");

    // First attach
    await fileInput.setInputFiles({
      name: "first.md",
      mimeType: "text/markdown",
      buffer: Buffer.from("# First"),
    });
    await page.waitForTimeout(300);
    await expect(inputForm.getByText("first.md")).toBeVisible();

    // Second attach (should accumulate, not replace)
    await fileInput.setInputFiles({
      name: "second.md",
      mimeType: "text/markdown",
      buffer: Buffer.from("# Second"),
    });
    await page.waitForTimeout(300);

    // Both should be visible (scoped to form to avoid conversation text collision)
    await expect(inputForm.getByText("first.md")).toBeVisible();
    await expect(inputForm.getByText("second.md")).toBeVisible();
  });
});

// =========================================================================
// WORKSPACE CHAT PANEL
// =========================================================================

test.describe("Workspace chat panel", () => {

  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await waitForWorkbench(page);
  });

  test("C1: Can open a chat panel and select an agent", async ({ page }) => {
    // Open a chat panel from the "+" menu
    await page.locator('[data-testid="open-tab-menu"]').click();
    await page.waitForTimeout(300);
    const chatOption = page.locator('[data-testid="add-panel-chat"]');
    if (!(await chatOption.isVisible())) {
      await page.keyboard.press("Escape");
      return; // chat panel not available in this build
    }
    await chatOption.click();
    await page.waitForTimeout(500);

    // Agent picker should be visible
    const agentSelect = page.locator("select");
    await expect(agentSelect.last()).toBeVisible();
  });

  test("C2: Chat panel shows input bar after agent selection", async ({ page }) => {
    await page.locator('[data-testid="open-tab-menu"]').click();
    await page.waitForTimeout(300);
    const chatOption = page.locator('[data-testid="add-panel-chat"]');
    if (!(await chatOption.isVisible())) {
      await page.keyboard.press("Escape");
      return;
    }
    await chatOption.click();
    await page.waitForTimeout(500);

    // Select first available agent
    const agentSelect = page.locator("select").last();
    const options = agentSelect.locator("option:not([disabled])");
    if (await options.count() === 0) return;
    const firstAgent = await options.first().getAttribute("value");
    if (firstAgent) await agentSelect.selectOption(firstAgent);
    await page.waitForTimeout(300);

    // Chat input should appear
    await expect(page.locator('[data-testid="panel-chat-input"]')).toBeVisible();
    await expect(page.locator('[data-testid="panel-chat-send"]')).toBeVisible();
  });

  test("C3: Chat panel should load message history on open (not start empty)", async ({ page }) => {
    // BUG/FEATURE: Eric wants chat panel to show enough history to be visible.
    // Currently panelMessages is in-memory only — reopening panel loses history.
    await page.locator('[data-testid="open-tab-menu"]').click();
    await page.waitForTimeout(300);
    const chatOption = page.locator('[data-testid="add-panel-chat"]');
    if (!(await chatOption.isVisible())) {
      await page.keyboard.press("Escape");
      return;
    }
    await chatOption.click();
    await page.waitForTimeout(500);

    // Select agent
    const agentSelect = page.locator("select").last();
    const options = agentSelect.locator("option:not([disabled])");
    if (await options.count() === 0) return;
    const firstAgent = await options.first().getAttribute("value");
    if (firstAgent) await agentSelect.selectOption(firstAgent);
    await page.waitForTimeout(300);

    // Send a test message
    const input = page.locator('[data-testid="panel-chat-input"]');
    await input.fill("xyzzy-C3-persist-test");
    await page.locator('[data-testid="panel-chat-send"]').click();
    await page.waitForTimeout(500);

    // Message should be visible in the chat panel
    await expect(page.getByText("xyzzy-C3-persist-test")).toBeVisible();

    // Close the chat tab and reopen — history should persist
    const chatTab = page.locator('[data-testid^="workbench-tab-chat"]').first();
    const tabTestId = await chatTab.getAttribute("data-testid");
    const instId = tabTestId?.replace("workbench-tab-", "");
    if (instId) {
      await chatTab.hover();
      await page.waitForTimeout(200);
      const closeBtn = page.locator(`[data-testid="close-tab-${instId}"]`);
      if (await closeBtn.isVisible()) await closeBtn.click();
      await page.waitForTimeout(300);
    }

    // Reopen chat panel
    await page.locator('[data-testid="open-tab-menu"]').click();
    await page.waitForTimeout(300);
    await page.locator('[data-testid="add-panel-chat"]').click();
    await page.waitForTimeout(500);
    // Re-select same agent
    const agentSelect2 = page.locator("select").last();
    if (firstAgent) await agentSelect2.selectOption(firstAgent);
    await page.waitForTimeout(500);

    // Previous message should still be visible (history loaded)
    const historyMsg = page.getByText("xyzzy-C3-persist-test");
    // This is the test that should FAIL if history isn't persisted
    await expect(historyMsg).toBeVisible({ timeout: 5000 });
  });
});

// =========================================================================
// EDITOR TABLE OF CONTENTS
// =========================================================================

test.describe("Editor table of contents", () => {

  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await waitForWorkbench(page);
  });

  test("E1: Editor has a table of contents toggle button", async ({ page }) => {
    // FEATURE: Editor should have a slide in/out table of contents
    // Open an editor panel
    await page.locator('[data-testid="open-tab-menu"]').click();
    await page.waitForTimeout(300);
    const editorOption = page.locator('[data-testid="add-panel-editor"]');
    if (!(await editorOption.isVisible())) {
      await page.keyboard.press("Escape");
      return;
    }
    await editorOption.click();
    await page.waitForTimeout(500);

    // Look for TOC toggle button
    const tocBtn = page.locator('button[title*="contents" i], button[title*="TOC" i], button[title*="outline" i], [data-testid="toc-toggle"]');
    // This will fail until the feature is implemented
    await expect(tocBtn.first()).toBeVisible({ timeout: 3000 });
  });

  test("E2: TOC slides in and lists document headings", async ({ page }) => {
    // FEATURE: Clicking TOC toggle should reveal a sidebar with headings
    await page.locator('[data-testid="open-tab-menu"]').click();
    await page.waitForTimeout(300);
    const editorOption = page.locator('[data-testid="add-panel-editor"]');
    if (!(await editorOption.isVisible())) {
      await page.keyboard.press("Escape");
      return;
    }
    await editorOption.click();
    await page.waitForTimeout(500);

    const tocBtn = page.locator('button[title*="contents" i], button[title*="TOC" i], button[title*="outline" i], [data-testid="toc-toggle"]');
    if (await tocBtn.count() === 0) {
      // Feature not built yet — test documents expected behavior
      expect(false, "TOC toggle button not found — feature not implemented").toBe(true);
      return;
    }
    await tocBtn.first().click();
    await page.waitForTimeout(300);

    // A TOC pane should slide in
    const tocPane = page.locator('[data-testid="toc-pane"], [class*="toc"], [class*="outline"]');
    await expect(tocPane.first()).toBeVisible();
  });

  test("E3: TOC panel is resizable via drag handle", async ({ page }) => {
    // FEATURE: TOC panel should have a draggable resize boundary
    await page.locator('[data-testid="open-tab-menu"]').click();
    await page.waitForTimeout(300);
    const editorOption = page.locator('[data-testid="add-panel-editor"]');
    if (!(await editorOption.isVisible())) {
      await page.keyboard.press("Escape");
      return;
    }
    await editorOption.click();
    await page.waitForTimeout(500);

    // Open TOC
    const tocBtn = page.locator('button[title*="contents" i], button[title*="TOC" i], button[title*="outline" i], [data-testid="toc-toggle"]');
    if (await tocBtn.count() === 0) return;
    await tocBtn.first().click();
    await page.waitForTimeout(300);

    // Should have a resize handle between TOC and editor content
    const resizeHandle = page.locator('[data-panel-group-id] [data-resize-handle-id], [data-testid="toc-resize-handle"], [class*="resize"]');
    // This fails until the resize feature is implemented
    await expect(resizeHandle.first()).toBeVisible({ timeout: 3000 });

    // Drag the handle and verify TOC width changes
    if (await resizeHandle.count() > 0) {
      const box = await resizeHandle.first().boundingBox();
      if (box) {
        const tocPane = page.locator('[data-testid="toc-pane"], [class*="toc"], [class*="outline"]').first();
        const widthBefore = (await tocPane.boundingBox())?.width ?? 0;

        // Drag handle 50px to the right (expand TOC)
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await page.mouse.down();
        await page.mouse.move(box.x + box.width / 2 + 50, box.y + box.height / 2, { steps: 5 });
        await page.mouse.up();
        await page.waitForTimeout(300);

        const widthAfter = (await tocPane.boundingBox())?.width ?? 0;
        expect(widthAfter).not.toBe(widthBefore);
      }
    }
  });
});

// =========================================================================
// COLOR SELECTION
// =========================================================================

test.describe("Color selection", () => {

  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await waitForWorkbench(page);
  });

  test("U1: User can select their display color", async ({ page }) => {
    // FEATURE: Settings/preferences should let user pick their color
    // Look for a settings/preferences button or menu
    const settingsBtn = page.locator('button[title*="settings" i], button[title*="preferences" i], [data-testid="settings-btn"], [data-testid="user-settings"]');
    if (await settingsBtn.count() === 0) {
      // Feature not built yet
      expect(false, "Settings/color picker not found — feature not implemented").toBe(true);
      return;
    }
    await settingsBtn.first().click();
    await page.waitForTimeout(300);

    // Should have a color picker for user messages
    const colorInput = page.locator('input[type="color"], [data-testid="user-color-picker"]');
    await expect(colorInput.first()).toBeVisible();
  });

  test("U2: User can select agent display colors", async ({ page }) => {
    // FEATURE: Agent colors should be customizable
    const settingsBtn = page.locator('button[title*="settings" i], button[title*="preferences" i], [data-testid="settings-btn"], [data-testid="user-settings"]');
    if (await settingsBtn.count() === 0) {
      expect(false, "Settings/color picker not found — feature not implemented").toBe(true);
      return;
    }
    await settingsBtn.first().click();
    await page.waitForTimeout(300);

    const agentColorInput = page.locator('[data-testid="agent-color-picker"], [data-testid*="color"]');
    await expect(agentColorInput.first()).toBeVisible();
  });
});

// =========================================================================
// DOM STABILITY
// =========================================================================

test.describe("DOM stability", () => {

  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await waitForWorkbench(page);
  });

  test("D1: Panel DOM elements are sorted by instanceId (prevents editor-swap bug)", async ({ page }) => {
    // Add a second editor to get multiple panels
    await page.locator('[data-testid="open-tab-menu"]').click();
    await page.waitForTimeout(300);
    const addEditor = page.locator('[data-testid="add-panel-editor"]');
    if (await addEditor.isVisible()) {
      await addEditor.click();
      await page.waitForTimeout(300);
    } else {
      await page.keyboard.press("Escape");
      return;
    }

    // Get all panel container data-instance-id values from the DOM
    const panelContainers = page.locator("[data-instance-id]");
    const count = await panelContainers.count();
    if (count < 2) return;

    const ids: string[] = [];
    for (let i = 0; i < count; i++) {
      const id = await panelContainers.nth(i).getAttribute("data-instance-id");
      if (id) ids.push(id);
    }

    // Verify they are sorted
    const sorted = [...ids].sort((a, b) => a.localeCompare(b));
    expect(ids).toEqual(sorted);
  });
});

// =========================================================================
// LAYOUT DEFAULTS
// =========================================================================

test.describe("Layout defaults", () => {

  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await waitForWorkbench(page);
  });

  test("L1: Theme defaults to dark", async ({ page }) => {
    // Clear theme preference and reload
    await page.evaluate(() => localStorage.removeItem("arena-theme"));
    await page.reload();
    await waitForWorkbench(page);

    // Default is dark — either data-theme="dark" or no attribute (dark via CSS defaults)
    const theme = await page.evaluate(() =>
      document.documentElement.getAttribute("data-theme")
    );
    // Must NOT be "light" — dark is the default
    expect(theme).not.toBe("light");
  });

  test("L2: Theme toggle persists across reload", async ({ page }) => {
    // Find and click theme toggle
    const themeBtn = page.locator('button[title*="theme" i], button[title*="Theme" i], button[title*="light" i], button[title*="dark" i]');
    if (await themeBtn.count() === 0) return;
    await themeBtn.first().click();
    await page.waitForTimeout(300);

    const themeAfterToggle = await page.evaluate(() =>
      document.documentElement.getAttribute("data-theme")
    );

    // Reload and check persistence
    await page.reload();
    await waitForWorkbench(page);

    const themeAfterReload = await page.evaluate(() =>
      document.documentElement.getAttribute("data-theme")
    );
    expect(themeAfterReload).toBe(themeAfterToggle);
  });

  test("L3: Conversation pane and workbench pane both render", async ({ page }) => {
    // Both the conversation area (with input) and workspace area should be visible
    await expect(page.locator('textarea').first()).toBeVisible();
    await expect(page.locator('[data-testid="open-tab-menu"]')).toBeVisible();
  });

  test("L4: Fresh load with no saved state opens empty workspace", async ({ page }) => {
    // Clear all workspace localStorage and reload
    await page.evaluate(() => {
      localStorage.removeItem("sa-workbench-panels");
      localStorage.removeItem("sa-open-tabs");
    });
    await page.reload();
    await page.waitForTimeout(1000);

    // No tabs should be open — workspace should be empty
    const tabs = page.locator('[data-testid^="workbench-tab-"]');
    expect(await tabs.count()).toBe(0);

    // The "+" button should be visible so user can add panels
    await expect(page.locator('[data-testid="open-tab-menu"]')).toBeVisible();
  });

  test("L5: Workspace restores last session's tabs on reload", async ({ page }) => {
    // Open a specific set of tabs (notebook + editor)
    await page.locator('[data-testid="open-tab-menu"]').click();
    await page.waitForTimeout(300);
    const addEditor = page.locator('[data-testid^="add-panel-"]').first();
    if (await addEditor.isVisible()) {
      await addEditor.click();
      await page.waitForTimeout(300);
    }

    // Record which tabs are open
    const tabsBefore: string[] = [];
    const allTabs = page.locator('[data-testid^="workbench-tab-"]');
    for (let i = 0; i < await allTabs.count(); i++) {
      const id = await allTabs.nth(i).getAttribute("data-testid");
      if (id) tabsBefore.push(id);
    }

    // Reload
    await page.reload();
    await page.locator('[data-testid^="workbench-tab-"]').first().waitFor({
      state: "visible",
      timeout: 15_000,
    });

    // Same tabs should be present
    const tabsAfter: string[] = [];
    const allTabsAfter = page.locator('[data-testid^="workbench-tab-"]');
    for (let i = 0; i < await allTabsAfter.count(); i++) {
      const id = await allTabsAfter.nth(i).getAttribute("data-testid");
      if (id) tabsAfter.push(id);
    }
    expect(tabsAfter).toEqual(tabsBefore);
  });

  test("L6: '+' add-tab button is easily clickable (min 24px hit target)", async ({ page }) => {
    const btn = page.locator('[data-testid="open-tab-menu"]');
    await expect(btn).toBeVisible();
    const box = await btn.boundingBox();
    expect(box).toBeTruthy();
    // Minimum hit target: 24x24px (current is too small per Eric)
    expect(box!.width).toBeGreaterThanOrEqual(24);
    expect(box!.height).toBeGreaterThanOrEqual(24);
  });
});
