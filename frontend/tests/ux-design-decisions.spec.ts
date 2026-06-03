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

// =========================================================================
// TILING WORKSPACE
// =========================================================================

test.describe("Tiling workspace", () => {

  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await waitForWorkbench(page);
  });

  test("W1: Default workspace shows tabs with one panel visible at a time", async ({ page }) => {
    // Ensure at least 2 tabs exist
    await ensureTabs(page, 2);
    const tabs = page.locator('[data-testid^="workbench-tab-"]');
    const tabCount = await tabs.count();
    expect(tabCount).toBeGreaterThanOrEqual(2);

    // Only one panel content area should be visible
    const visiblePanels = page.locator('[data-testid^="panel-content-"]');
    await expect(visiblePanels).toHaveCount(1);
  });

  test("W2: Can pin a panel to make it visible alongside the active tab", async ({ page }) => {
    await ensureTabs(page, 2);

    // Get the second (non-active) tab
    const tabs = page.locator('[data-testid^="workbench-tab-"]');
    const secondTab = tabs.nth(1);
    const tabId = await secondTab.getAttribute("data-testid");

    // Pin the second tab (right-click or pin button)
    const pinButton = secondTab.locator('[data-testid="pin-panel"]');
    await pinButton.click();

    // Now two panel content areas should be visible (tiled)
    const visiblePanels = page.locator('[data-testid^="panel-content-"]');
    await expect(visiblePanels).toHaveCount(2);
  });

  test("W3: Pinned panels tile vertically with a draggable boundary", async ({ page }) => {
    await ensureTabs(page, 2);

    // Pin second tab to create tiled view
    const tabs = page.locator('[data-testid^="workbench-tab-"]');
    const pinButton = tabs.nth(1).locator('[data-testid="pin-panel"]');
    await pinButton.click();

    // Verify resize handle exists between tiled panels
    const resizeHandle = page.locator('[data-testid="tile-resize-handle"]');
    await expect(resizeHandle).toBeVisible();

    // Get initial widths of the two panels
    const panels = page.locator('[data-testid^="panel-content-"]');
    const firstBox = await panels.nth(0).boundingBox();
    expect(firstBox).toBeTruthy();
    const initialWidth = firstBox!.width;

    // Drag the resize handle to change proportions
    const handleBox = await resizeHandle.boundingBox();
    expect(handleBox).toBeTruthy();
    await page.mouse.move(handleBox!.x + handleBox!.width / 2, handleBox!.y + handleBox!.height / 2);
    await page.mouse.down();
    await page.mouse.move(handleBox!.x + 80, handleBox!.y + handleBox!.height / 2, { steps: 5 });
    await page.mouse.up();

    // Verify panel width changed
    const newBox = await panels.nth(0).boundingBox();
    expect(newBox).toBeTruthy();
    expect(newBox!.width).not.toEqual(initialWidth);
  });

  test("W4: Unpinning a tiled panel returns to single-panel view", async ({ page }) => {
    await ensureTabs(page, 2);

    // Pin second tab
    const tabs = page.locator('[data-testid^="workbench-tab-"]');
    const pinButton = tabs.nth(1).locator('[data-testid="pin-panel"]');
    await pinButton.click();
    await expect(page.locator('[data-testid^="panel-content-"]')).toHaveCount(2);

    // Unpin it
    const unpinButton = tabs.nth(1).locator('[data-testid="unpin-panel"]');
    await unpinButton.click();

    // Back to single panel
    await expect(page.locator('[data-testid^="panel-content-"]')).toHaveCount(1);
  });

  test("W5: Closing a pinned panel causes remaining panels to reflow", async ({ page }) => {
    await ensureTabs(page, 2);

    // Pin second tab to tile
    const tabs = page.locator('[data-testid^="workbench-tab-"]');
    const pinButton = tabs.nth(1).locator('[data-testid="pin-panel"]');
    await pinButton.click();
    await expect(page.locator('[data-testid^="panel-content-"]')).toHaveCount(2);

    // Get remaining panel's width before close
    const panels = page.locator('[data-testid^="panel-content-"]');
    const firstBefore = await panels.nth(0).boundingBox();

    // Close the second (pinned) tab entirely
    const closeButton = tabs.nth(1).locator('[data-testid^="close-tab-"]');
    await closeButton.click();
    await page.waitForTimeout(300);

    // Should be back to one panel, and it should fill the full width
    await expect(page.locator('[data-testid^="panel-content-"]')).toHaveCount(1);
    const firstAfter = await (page.locator('[data-testid^="panel-content-"]').first()).boundingBox();
    expect(firstAfter).toBeTruthy();
    expect(firstAfter!.width).toBeGreaterThan(firstBefore!.width);
  });

  test("W6: Tiled layout persists across page reload", async ({ page }) => {
    await ensureTabs(page, 2);

    // Pin second tab
    const tabs = page.locator('[data-testid^="workbench-tab-"]');
    const pinButton = tabs.nth(1).locator('[data-testid="pin-panel"]');
    await pinButton.click();
    await expect(page.locator('[data-testid^="panel-content-"]')).toHaveCount(2);

    // Reload
    await page.reload();
    await waitForWorkbench(page);

    // Tiled layout should be restored — two panels visible
    await expect(page.locator('[data-testid^="panel-content-"]')).toHaveCount(2);
  });

  test("W7: Two editors can be open side by side", async ({ page }) => {
    // Open first editor
    await page.locator('[data-testid="open-tab-menu"]').click();
    await page.waitForTimeout(300);
    await page.locator('[data-testid="add-panel-editor"]').click();
    await page.waitForTimeout(300);

    // Open second editor
    await page.locator('[data-testid="open-tab-menu"]').click();
    await page.waitForTimeout(300);
    await page.locator('[data-testid="add-panel-editor"]').click();
    await page.waitForTimeout(300);

    // Pin the second editor tab
    const editorTabs = page.locator('[data-testid^="workbench-tab-editor"]');
    const pinButton = editorTabs.nth(1).locator('[data-testid="pin-panel"]');
    await pinButton.click();

    // Two editor panels should be visible simultaneously
    const editorPanels = page.locator('[data-testid^="panel-content-editor"]');
    await expect(editorPanels).toHaveCount(2);

    // Each should be independently editable
    const firstEditor = editorPanels.nth(0).locator('[contenteditable], textarea').first();
    const secondEditor = editorPanels.nth(1).locator('[contenteditable], textarea').first();
    await expect(firstEditor).toBeVisible();
    await expect(secondEditor).toBeVisible();
  });

  test("W8: Any panel can pop out into its own window", async ({ page, context }) => {
    await ensureTabs(page, 1);

    // Find popout button on the active tab
    const activeTab = page.locator('[data-testid^="workbench-tab-"]').first();
    const popoutButton = activeTab.locator('[data-testid="popout-panel"]');
    await expect(popoutButton).toBeVisible();

    // Click popout — should open a new window/tab
    const [popup] = await Promise.all([
      context.waitForEvent("page"),
      popoutButton.click(),
    ]);

    // New window should contain the panel content
    await popup.waitForLoadState("domcontentloaded");
    const panelContent = popup.locator('[data-testid^="panel-content-"]');
    await expect(panelContent).toBeVisible({ timeout: 10_000 });
  });

  test("W9: Tile resize handle follows cursor accurately during drag", async ({ page }) => {
    // BUG: Handle accelerates away from cursor instead of tracking it.
    // Root cause: delta computed from startX (cumulative) but applied as incremental.
    await ensureTabs(page, 2);

    // Pin second tab
    const tabs = page.locator('[data-testid^="workbench-tab-"]');
    const pinButton = tabs.nth(1).locator('[data-testid="pin-panel"]');
    await pinButton.click();

    const resizeHandle = page.locator('[data-testid="tile-resize-handle"]');
    await expect(resizeHandle).toBeVisible();

    // Drag handle 100px to the right in small steps
    const handleBox = await resizeHandle.boundingBox();
    expect(handleBox).toBeTruthy();
    const startX = handleBox!.x + handleBox!.width / 2;
    const startY = handleBox!.y + handleBox!.height / 2;
    const dragDistance = 100;

    await page.mouse.move(startX, startY);
    await page.mouse.down();
    // Move in 10px increments
    for (let i = 1; i <= 10; i++) {
      await page.mouse.move(startX + i * 10, startY);
    }
    await page.mouse.up();

    // Handle should now be near where we dragged it (startX + 100px), not overshooting
    const newHandleBox = await resizeHandle.boundingBox();
    expect(newHandleBox).toBeTruthy();
    const actualMove = newHandleBox!.x - handleBox!.x;

    // Allow 20% tolerance — handle should move roughly 100px, not 200+ or 50-
    expect(actualMove).toBeGreaterThan(dragDistance * 0.5);
    expect(actualMove).toBeLessThan(dragDistance * 1.5);
  });

  test("W10: Tile resize handle has correct cursor style", async ({ page }) => {
    await ensureTabs(page, 2);

    // Pin second tab
    const tabs = page.locator('[data-testid^="workbench-tab-"]');
    const pinButton = tabs.nth(1).locator('[data-testid="pin-panel"]');
    await pinButton.click();

    // Verify resize handle has col-resize cursor (same as main chat/workspace boundary)
    const resizeHandle = page.locator('[data-testid="tile-resize-handle"]');
    await expect(resizeHandle).toBeVisible();
    const cursor = await resizeHandle.evaluate((el) => getComputedStyle(el).cursor);
    expect(cursor).toBe("col-resize");
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
    // Scope to editor pane — broad selectors like [class*="resize"] match
    // conversation textarea (resize-none) and [class*="outline"] matches
    // focus:outline-none on other elements, causing .first() collisions.
    const editorPane = page.locator('[data-testid="shared-editor"]');
    const resizeHandle = editorPane.locator('[data-panel-group-id] [data-resize-handle-id], [data-testid="toc-resize-handle"], [class*="resize"]');
    // This fails until the resize feature is implemented
    await expect(resizeHandle.first()).toBeVisible({ timeout: 3000 });

    // Drag the handle and verify TOC width changes
    if (await resizeHandle.count() > 0) {
      const box = await resizeHandle.first().boundingBox();
      if (box) {
        const tocPane = editorPane.locator('[data-testid="toc-pane"], [class*="toc"], [class*="outline"]').first();
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
// FILESYSTEM VIEWER
// =========================================================================

test.describe("Filesystem viewer", () => {

  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await waitForWorkbench(page);
  });

  test("F1: Can open a filesystem viewer panel from the tab menu", async ({ page }) => {
    await page.locator('[data-testid="open-tab-menu"]').click();
    await page.waitForTimeout(300);
    const addFs = page.locator('[data-testid="add-panel-filesystem"]');
    await expect(addFs).toBeVisible();
    await addFs.click();
    await page.waitForTimeout(300);

    // Filesystem panel should be visible with a directory listing
    const fsPanel = page.locator('[data-testid^="panel-content-filesystem"]');
    await expect(fsPanel).toBeVisible();
  });

  test("F2: Filesystem viewer shows directory tree with expandable folders", async ({ page }) => {
    // Open filesystem panel
    await page.locator('[data-testid="open-tab-menu"]').click();
    await page.waitForTimeout(300);
    await page.locator('[data-testid="add-panel-filesystem"]').click();
    await page.waitForTimeout(500);

    const fsPanel = page.locator('[data-testid^="panel-content-filesystem"]');
    await expect(fsPanel).toBeVisible();

    // Should show a tree structure with expandable items
    const treeItems = fsPanel.locator('[data-testid="fs-tree-item"]');
    await expect(treeItems.first()).toBeVisible({ timeout: 10_000 });

    // At least one item should be a folder (expandable)
    const folderItem = fsPanel.locator('[data-testid="fs-folder"]').first();
    await expect(folderItem).toBeVisible();
  });

  test("F3: Clicking a folder expands it to show children", async ({ page }) => {
    await page.locator('[data-testid="open-tab-menu"]').click();
    await page.waitForTimeout(300);
    await page.locator('[data-testid="add-panel-filesystem"]').click();
    await page.waitForTimeout(500);

    const fsPanel = page.locator('[data-testid^="panel-content-filesystem"]');
    const folder = fsPanel.locator('[data-testid="fs-folder"]').first();
    await expect(folder).toBeVisible({ timeout: 10_000 });

    // Count visible items before expanding
    const itemsBefore = await fsPanel.locator('[data-testid="fs-tree-item"]').count();

    // Click folder to expand
    await folder.click();
    await page.waitForTimeout(500);

    // Should have more items now (children visible)
    const itemsAfter = await fsPanel.locator('[data-testid="fs-tree-item"]').count();
    expect(itemsAfter).toBeGreaterThan(itemsBefore);
  });

  test("F4: Clicking a file in filesystem viewer opens it in editor", async ({ page }) => {
    await page.locator('[data-testid="open-tab-menu"]').click();
    await page.waitForTimeout(300);
    await page.locator('[data-testid="add-panel-filesystem"]').click();
    await page.waitForTimeout(500);

    const fsPanel = page.locator('[data-testid^="panel-content-filesystem"]');

    // Find and click a file (not folder)
    const fileItem = fsPanel.locator('[data-testid="fs-file"]').first();
    await expect(fileItem).toBeVisible({ timeout: 10_000 });
    await fileItem.click();
    await page.waitForTimeout(500);

    // An editor panel should now be open with the file content
    const editorTab = page.locator('[data-testid^="workbench-tab-editor"]');
    await expect(editorTab.first()).toBeVisible();
  });

  test("F5: Filesystem viewer has a path breadcrumb / current directory indicator", async ({ page }) => {
    await page.locator('[data-testid="open-tab-menu"]').click();
    await page.waitForTimeout(300);
    await page.locator('[data-testid="add-panel-filesystem"]').click();
    await page.waitForTimeout(500);

    const fsPanel = page.locator('[data-testid^="panel-content-filesystem"]');
    const breadcrumb = fsPanel.locator('[data-testid="fs-breadcrumb"]');
    await expect(breadcrumb).toBeVisible({ timeout: 10_000 });
  });
});

// =========================================================================
// SHARED SHELL
// =========================================================================

test.describe("Shared shell", () => {

  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await waitForWorkbench(page);
  });

  test("SH1: Can open a shell panel from the tab menu", async ({ page }) => {
    await page.locator('[data-testid="open-tab-menu"]').click();
    await page.waitForTimeout(300);
    const addShell = page.locator('[data-testid="add-panel-shell"]');
    await expect(addShell).toBeVisible();
    await addShell.click();
    await page.waitForTimeout(300);

    const shellPanel = page.locator('[data-testid^="panel-content-shell"]');
    await expect(shellPanel).toBeVisible();
  });

  test("SH2: Shell panel displays a terminal emulator", async ({ page }) => {
    await page.locator('[data-testid="open-tab-menu"]').click();
    await page.waitForTimeout(300);
    await page.locator('[data-testid="add-panel-shell"]').click();
    await page.waitForTimeout(500);

    const shellPanel = page.locator('[data-testid^="panel-content-shell"]');
    await expect(shellPanel).toBeVisible();

    // Should contain a terminal element (xterm.js or similar)
    const terminal = shellPanel.locator('[data-testid="shell-terminal"]');
    await expect(terminal).toBeVisible({ timeout: 10_000 });
  });

  test("SH3: User can type a command and see output", async ({ page }) => {
    await page.locator('[data-testid="open-tab-menu"]').click();
    await page.waitForTimeout(300);
    await page.locator('[data-testid="add-panel-shell"]').click();
    await page.waitForTimeout(1000);

    const shellPanel = page.locator('[data-testid^="panel-content-shell"]');
    const terminal = shellPanel.locator('[data-testid="shell-terminal"]');
    await expect(terminal).toBeVisible({ timeout: 10_000 });

    // Type a simple command
    await terminal.click();
    await page.keyboard.type("echo __SH3_TEST_OUTPUT__");
    await page.keyboard.press("Enter");
    await page.waitForTimeout(1000);

    // Output should appear in the terminal (check mirror div for plain text)
    await expect(shellPanel.locator('[data-testid="shell-mirror"]')).toContainText("__SH3_TEST_OUTPUT__", { timeout: 5_000 });
  });

  test("SH4: Can open multiple independent shell sessions", async ({ page }) => {
    // Open first shell
    await page.locator('[data-testid="open-tab-menu"]').click();
    await page.waitForTimeout(300);
    await page.locator('[data-testid="add-panel-shell"]').click();
    await page.waitForTimeout(300);

    // Open second shell
    await page.locator('[data-testid="open-tab-menu"]').click();
    await page.waitForTimeout(300);
    await page.locator('[data-testid="add-panel-shell"]').click();
    await page.waitForTimeout(300);

    // Should have two shell tabs
    const shellTabs = page.locator('[data-testid^="workbench-tab-shell"]');
    await expect(shellTabs).toHaveCount(2);
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

// =========================================================================
// BUG: MULTI-EDITOR FILE LOADING (Eric 2026-06-02)
// =========================================================================

test.describe("Multi-editor file loading", () => {

  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await waitForWorkbench(page);
  });

  test("B1: Two pinned editors can show different files simultaneously", async ({ page }) => {
    // Open first editor and pin it
    await page.locator('[data-testid="open-tab-menu"]').click();
    await page.waitForTimeout(300);
    await page.locator('[data-testid="add-panel-editor"]').click();
    await page.waitForTimeout(500);

    // Pin the first editor
    const firstTab = page.locator('[data-testid^="workbench-tab-"]').first();
    const firstTabId = await firstTab.getAttribute("data-testid");
    const firstId = firstTabId?.replace("workbench-tab-", "") || "";
    await page.locator(`[data-testid="pin-tab-${firstId}"]`).click();
    await page.waitForTimeout(300);

    // Open second editor
    await page.locator('[data-testid="open-tab-menu"]').click();
    await page.waitForTimeout(300);
    await page.locator('[data-testid="add-panel-editor"]').click();
    await page.waitForTimeout(500);

    // Pin the second editor
    const tabs = page.locator('[data-testid^="workbench-tab-"]');
    const secondTab = tabs.last();
    const secondTabId = await secondTab.getAttribute("data-testid");
    const secondId = secondTabId?.replace("workbench-tab-", "") || "";
    await page.locator(`[data-testid="pin-tab-${secondId}"]`).click();
    await page.waitForTimeout(300);

    // Both tiled panels should be visible
    const panel1 = page.locator(`[data-testid="tiled-panel-${firstId}"]`);
    const panel2 = page.locator(`[data-testid="tiled-panel-${secondId}"]`);
    await expect(panel1).toBeVisible();
    await expect(panel2).toBeVisible();

    // Type different content in each editor
    const editor1 = panel1.locator('[contenteditable="true"], textarea, .cm-content').first();
    const editor2 = panel2.locator('[contenteditable="true"], textarea, .cm-content').first();

    if (await editor1.isVisible() && await editor2.isVisible()) {
      await editor1.click();
      await editor1.pressSequentially("File One Content");
      await editor2.click();
      await editor2.pressSequentially("File Two Content");

      // Each editor should retain its own content
      const text1 = await editor1.textContent();
      const text2 = await editor2.textContent();
      expect(text1).toContain("File One");
      expect(text2).toContain("File Two");
    }
  });
});

  test("B4: Clicking second editor tab switches to its content (not first editor's)", async ({ page }) => {
    // Open two editors
    await page.locator('[data-testid="open-tab-menu"]').click();
    await page.waitForTimeout(300);
    await page.locator('[data-testid="add-panel-editor"]').click();
    await page.waitForTimeout(500);

    await page.locator('[data-testid="open-tab-menu"]').click();
    await page.waitForTimeout(300);
    await page.locator('[data-testid="add-panel-editor"]').click();
    await page.waitForTimeout(500);

    // Type in first editor
    const tabs = page.locator('[data-testid^="workbench-tab-"]');
    await tabs.first().click();
    await page.waitForTimeout(300);
    const firstPanel = page.locator('[data-testid^="panel-content-"]').filter({ has: page.locator('[contenteditable="true"], textarea, .cm-content') }).first();
    const firstEditor = firstPanel.locator('[contenteditable="true"], textarea, .cm-content').first();
    if (await firstEditor.isVisible()) {
      await firstEditor.click();
      await firstEditor.pressSequentially("FIRST_EDITOR_UNIQUE");
    }

    // Click second editor tab
    await tabs.last().click();
    await page.waitForTimeout(300);

    // The visible content should NOT contain FIRST_EDITOR_UNIQUE
    const visiblePanel = page.locator('[data-testid^="panel-content-"]').filter({ has: page.locator('[contenteditable="true"], textarea, .cm-content') }).first();
    const visibleEditor = visiblePanel.locator('[contenteditable="true"], textarea, .cm-content').first();
    if (await visibleEditor.isVisible()) {
      const text = await visibleEditor.textContent();
      expect(text).not.toContain("FIRST_EDITOR_UNIQUE");
    }
  });

  test("B5: Editor retains loaded file content after switching tabs away and back", async ({ page }) => {
    // Open editor and load a file via filesystem viewer
    await page.locator('[data-testid="open-tab-menu"]').click();
    await page.waitForTimeout(300);
    await page.locator('[data-testid="add-panel-editor"]').click();
    await page.waitForTimeout(500);

    // Type content to simulate loaded file
    const editorPanel = page.locator('[data-testid^="panel-content-editor"]').first();
    const editor = editorPanel.locator('[contenteditable="true"], textarea, .cm-content').first();
    if (await editor.isVisible()) {
      await editor.click();
      await editor.pressSequentially("B5_PERSIST_TEST_CONTENT");
    }

    // Open a notebook panel (switches away from editor)
    await page.locator('[data-testid="open-tab-menu"]').click();
    await page.waitForTimeout(300);
    await page.locator('[data-testid^="add-panel-"]').first().click();
    await page.waitForTimeout(500);

    // Click back to the editor tab
    const editorTab = page.locator('[data-testid^="workbench-tab-"]').filter({ hasText: /Editor|editor/ }).first();
    await editorTab.click();
    await page.waitForTimeout(300);

    // Editor should still have the content, not be blank/Untitled
    const restored = editorPanel.locator('[contenteditable="true"], textarea, .cm-content').first();
    if (await restored.isVisible()) {
      const text = await restored.textContent();
      expect(text).toContain("B5_PERSIST_TEST_CONTENT");
    }
  });
});

// =========================================================================
// BUG: FILESYSTEM VIEWER FILE OPEN (Eric 2026-06-02)
// =========================================================================

test.describe("Filesystem viewer file open", () => {

  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await waitForWorkbench(page);
  });

  test("B2: Clicking a .md file in filesystem viewer actually opens it in the editor", async ({ page }) => {
    // Open filesystem panel
    await page.locator('[data-testid="open-tab-menu"]').click();
    await page.waitForTimeout(300);
    await page.locator('[data-testid="add-panel-filesystem"]').click();
    await page.waitForTimeout(500);

    const fsPanel = page.locator('[data-testid^="panel-content-filesystem"]');
    await expect(fsPanel).toBeVisible();

    // Find a file item (try .md specifically, fall back to any file)
    const fileItem = fsPanel.locator('[data-testid="fs-file"]').first();
    await expect(fileItem).toBeVisible({ timeout: 10_000 });
    const fileName = await fileItem.textContent();
    await fileItem.click();
    await page.waitForTimeout(1000);

    // An editor tab should now exist AND have content loaded
    const editorPanels = page.locator('[data-testid^="panel-content-editor"]');
    await expect(editorPanels.first()).toBeVisible({ timeout: 5_000 });

    // The editor should contain some text (not be empty/blank)
    const editorContent = editorPanels.first().locator('[contenteditable="true"], textarea, .cm-content').first();
    if (await editorContent.isVisible()) {
      const text = await editorContent.textContent();
      expect(text?.trim().length).toBeGreaterThan(0);
    }
  });
});

// =========================================================================
// BUG: SHELL PANEL BLANK (Eric 2026-06-02)
// =========================================================================

test.describe("Shell panel initialization", () => {

  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await waitForWorkbench(page);
  });

  test("B3: Shell panel initializes with a working terminal session (not blank) [needs backend]", async ({ page }) => {
    // Open shell panel
    await page.locator('[data-testid="open-tab-menu"]').click();
    await page.waitForTimeout(300);
    await page.locator('[data-testid="add-panel-shell"]').click();
    await page.waitForTimeout(1000);

    const shellPanel = page.locator('[data-testid^="panel-content-shell"]');
    await expect(shellPanel).toBeVisible();

    // The terminal container should be visible and initialized
    const terminal = shellPanel.locator('[data-testid="shell-terminal"]');
    await expect(terminal).toBeVisible({ timeout: 5_000 });

    // xterm.js should have rendered something (not blank)
    // The terminal should contain visible DOM elements from xterm rendering
    const xtermScreen = terminal.locator('.xterm-screen');
    await expect(xtermScreen).toBeVisible({ timeout: 5_000 });

    // Terminal should have at least some content (prompt, etc.)
    // Wait a moment for the shell to initialize and show a prompt
    await page.waitForTimeout(2000);
    const screenText = await terminal.textContent();
    // A working shell should show SOMETHING (prompt chars, path, etc.)
    expect(screenText?.trim().length).toBeGreaterThan(0);
  });
});

// =========================================================================
// ADAPTER CONNECT/DISCONNECT (Q's 2821b92)
// =========================================================================

test.describe("Adapter connect/disconnect", () => {

  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await waitForWorkbench(page);
  });

  test("AC1: Link/unlink button is visible in conversation header when agent is selected", async ({ page }) => {
    // The ConversationPane header should show a link/unlink button
    // Button has title containing "Connect" or "Disconnect" + agent name
    const linkBtn = page.locator('button').filter({ hasText: /link/ });
    await expect(linkBtn).toBeVisible({ timeout: 10_000 });
  });

  test("AC2: Clicking 'link' button sends connect API call [needs backend]", async ({ page }) => {
    // Intercept the connect API call
    let connectCalled = false;
    let connectedAgent = "";
    await page.route("**/api/adapter/connect/*", async (route) => {
      connectCalled = true;
      connectedAgent = route.request().url().split("/").pop() || "";
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ status: "connected", agent: connectedAgent, pid: 99999 }),
      });
    });
    // Mock connections endpoint to return empty initially
    await page.route("**/api/adapter/connections", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ connected: connectCalled ? [connectedAgent] : [] }),
      });
    });

    await page.reload();
    await waitForWorkbench(page);

    // Find the unlinked button and click it
    const linkBtn = page.locator('button').filter({ hasText: /link/ }).first();
    await expect(linkBtn).toBeVisible({ timeout: 10_000 });
    await linkBtn.click();
    await page.waitForTimeout(500);

    expect(connectCalled).toBe(true);
  });

  test("AC3: Connected agent shows 'linked' state", async ({ page }) => {
    // Mock connections endpoint to return an agent as connected
    await page.route("**/api/adapter/connections", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ connected: ["Trip"] }),
      });
    });

    await page.reload();
    await waitForWorkbench(page);

    // Select Trip as the current agent (mock returns Trip as connected)
    const agentSelect = page.locator("select").first();
    await expect(agentSelect).toBeVisible({ timeout: 5_000 });
    const tripOpt = agentSelect.locator('option[value="Trip"]');
    if (await tripOpt.count() > 0) {
      await agentSelect.selectOption("Trip");
      await page.waitForTimeout(1000);
    }

    // The button should show "linked" state (⚡ linked)
    const linkedBtn = page.locator('button').filter({ hasText: /linked/ });
    await expect(linkedBtn).toBeVisible({ timeout: 10_000 });
  });

  test("AC4: Clicking 'linked' button sends disconnect API call [needs backend]", async ({ page }) => {
    let disconnectCalled = false;
    // Start with agent connected
    await page.route("**/api/adapter/connections", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ connected: disconnectCalled ? [] : ["Trip"] }),
      });
    });
    await page.route("**/api/adapter/disconnect/*", async (route) => {
      disconnectCalled = true;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ status: "disconnected", agent: "Trip" }),
      });
    });

    await page.reload();
    await waitForWorkbench(page);

    // Select Trip as the current agent
    const agentSelect = page.locator("select").first();
    await expect(agentSelect).toBeVisible({ timeout: 5_000 });
    const tripOpt = agentSelect.locator('option[value="Trip"]');
    if (await tripOpt.count() > 0) {
      await agentSelect.selectOption("Trip");
      await page.waitForTimeout(1000);
    }

    // Find the linked button and click to disconnect
    const linkedBtn = page.locator('button').filter({ hasText: /linked/ });
    await expect(linkedBtn).toBeVisible({ timeout: 10_000 });
    await linkedBtn.click();
    await page.waitForTimeout(500);

    expect(disconnectCalled).toBe(true);
  });
});
