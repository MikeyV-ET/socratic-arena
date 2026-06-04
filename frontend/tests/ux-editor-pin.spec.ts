import { test, expect } from "@playwright/test";

/**
 * B9: Editor content disappears when panel is pinned.
 *
 * Eric had a doc open in an editor, pinned the editor panel, and the
 * document content disappeared. Pinning should only affect panel layout
 * (position/visibility), not editor state.
 *
 * Likely cause: pinning may re-mount the React component, losing
 * CodeMirror/Yjs state or the document reference.
 */

test.describe("Editor Pin — Content Preservation (B9)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("[data-node-id]").first()).toBeVisible({ timeout: 15_000 });
  });

  test("B9a: Editor content survives pinning", async ({ page }) => {
    test.setTimeout(60_000);

    // Open an editor panel
    await page.locator('[data-testid="open-tab-menu"]').click();
    await page.waitForTimeout(300);
    await page.locator('[data-testid="add-panel-editor"]').click();
    await page.waitForTimeout(1000);

    const editorPanel = page.locator('[data-testid="shared-editor"]');
    await expect(editorPanel).toBeVisible({ timeout: 5000 });

    // Create a new document
    const createBtn = editorPanel.locator('[data-testid="create-doc-btn"]');
    await createBtn.click();
    await page.waitForTimeout(500);

    const titleInput = editorPanel.locator('[data-testid="create-doc-title"]');
    await titleInput.fill("B9 Test Document");
    await titleInput.press("Enter");
    await page.waitForTimeout(1000);

    // Type content into the CodeMirror editor
    const cmContent = editorPanel.locator(".cm-content");
    await expect(cmContent).toBeVisible({ timeout: 5000 });
    await cmContent.click();
    const testContent = "B9_PIN_TEST_CONTENT_SHOULD_SURVIVE";
    await page.keyboard.type(testContent);
    await page.waitForTimeout(500);

    // Verify content is there before pinning
    await expect(cmContent).toContainText(testContent);

    // Find the editor tab and pin it
    const editorTab = page.locator('[data-testid^="workbench-tab-editor"]').first();
    await editorTab.hover();
    await page.waitForTimeout(300);
    const pinButton = editorTab.locator('[data-testid="pin-panel"]');
    await pinButton.click();
    await page.waitForTimeout(1000);

    // Content should still be visible after pinning
    const editorAfterPin = page.locator('[data-testid="shared-editor"]');
    await expect(editorAfterPin).toBeVisible({ timeout: 5000 });

    // The document title should still show
    const title = editorAfterPin.locator('[data-testid="shared-editor-title"]');
    await expect(title).toContainText("B9 Test Document", { timeout: 5000 });

    // The editor content should still contain our text
    const cmAfterPin = editorAfterPin.locator(".cm-content");
    await expect(cmAfterPin).toBeVisible({ timeout: 5000 });
    await expect(cmAfterPin).toContainText(testContent, { timeout: 5000 });
  });

  test("B9b: Editor content survives unpin", async ({ page }) => {
    test.setTimeout(60_000);

    // Open editor, create doc, type content, pin, then unpin
    await page.locator('[data-testid="open-tab-menu"]').click();
    await page.waitForTimeout(300);
    await page.locator('[data-testid="add-panel-editor"]').click();
    await page.waitForTimeout(1000);

    const editorPanel = page.locator('[data-testid="shared-editor"]');
    await expect(editorPanel).toBeVisible({ timeout: 5000 });

    const createBtn = editorPanel.locator('[data-testid="create-doc-btn"]');
    await createBtn.click();
    await page.waitForTimeout(500);
    const titleInput = editorPanel.locator('[data-testid="create-doc-title"]');
    await titleInput.fill("B9b Unpin Test");
    await titleInput.press("Enter");
    await page.waitForTimeout(1000);

    const cmContent = editorPanel.locator(".cm-content");
    await expect(cmContent).toBeVisible({ timeout: 5000 });
    await cmContent.click();
    const testContent = "B9B_UNPIN_TEST_CONTENT";
    await page.keyboard.type(testContent);
    await page.waitForTimeout(500);

    // Pin
    const editorTab = page.locator('[data-testid^="workbench-tab-editor"]').first();
    await editorTab.hover();
    await page.waitForTimeout(300);
    await editorTab.locator('[data-testid="pin-panel"]').click();
    await page.waitForTimeout(1000);

    // Unpin
    const pinnedTab = page.locator('[data-testid^="workbench-tab-editor"]').first();
    await pinnedTab.hover();
    await page.waitForTimeout(300);
    await pinnedTab.locator('[data-testid="unpin-panel"]').click();
    await page.waitForTimeout(1000);

    // Content should survive the pin/unpin cycle
    const editorAfter = page.locator('[data-testid="shared-editor"]');
    const cmAfter = editorAfter.locator(".cm-content");
    await expect(cmAfter).toContainText(testContent, { timeout: 5000 });
  });
});