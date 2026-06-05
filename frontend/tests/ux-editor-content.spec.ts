/**
 * Editor Content Preservation Tests (B9 extended)
 *
 * B9d: Pinning a DIFFERENT panel (shell) should not clear editor content
 * B9e: Editor content survives opening a new panel of different type
 * B9f: Pop-out editor preserves content (or at minimum warns)
 */

import { test, expect } from "@playwright/test";

const BASE = "http://localhost:5175";

test.describe("Editor Content Preservation — Extended (B9d-f)", () => {

  test("B9d: Pinning a shell does NOT clear editor content", async ({ page }) => {
    await page.goto(BASE);
    await page.waitForLoadState("networkidle");

    // Open an editor panel
    const addBtn = page.locator('[data-testid="add-panel-button"]');
    await addBtn.click();
    await page.locator('[data-testid="add-panel-editor"]').click();
    await page.waitForTimeout(500);

    // Type content into the editor
    const editor = page.locator(".cm-content, .ProseMirror, [contenteditable]").first();
    await editor.click();
    await editor.pressSequentially("B9d test content persists", { delay: 20 });
    await page.waitForTimeout(300);

    // Verify content is there
    const textBefore = await editor.textContent();
    expect(textBefore).toContain("B9d test content");

    // Now open a shell panel
    await addBtn.click();
    await page.locator('[data-testid="add-panel-shell"]').click();
    await page.waitForTimeout(500);

    // Pin the shell panel
    const pinBtn = page.locator('[data-testid="pin-panel"]').last();
    if (await pinBtn.isVisible()) {
      await pinBtn.click();
      await page.waitForTimeout(500);
    }

    // Switch back to editor tab and verify content survived
    // Find the editor panel's tab and click it
    const editorTab = page.locator('[data-testid*="panel-tab"]').filter({ hasText: /editor/i }).first();
    if (await editorTab.isVisible()) {
      await editorTab.click();
      await page.waitForTimeout(300);
    }

    const editorAfter = page.locator(".cm-content, .ProseMirror, [contenteditable]").first();
    const textAfter = await editorAfter.textContent();
    expect(textAfter, "Editor content was cleared when shell was pinned").toContain("B9d test content");
  });

  test("B9e: Multiple editors survive adding a new panel", async ({ page }) => {
    await page.goto(BASE);
    await page.waitForLoadState("networkidle");

    const addBtn = page.locator('[data-testid="add-panel-button"]');

    // Open first editor and type
    await addBtn.click();
    await page.locator('[data-testid="add-panel-editor"]').click();
    await page.waitForTimeout(500);
    const ed1 = page.locator(".cm-content, .ProseMirror, [contenteditable]").first();
    await ed1.click();
    await ed1.pressSequentially("Editor ONE content", { delay: 20 });
    await page.waitForTimeout(300);

    // Open second editor and type
    await addBtn.click();
    await page.locator('[data-testid="add-panel-editor"]').click();
    await page.waitForTimeout(500);
    const ed2 = page.locator(".cm-content, .ProseMirror, [contenteditable]").last();
    await ed2.click();
    await ed2.pressSequentially("Editor TWO content", { delay: 20 });
    await page.waitForTimeout(300);

    // Open a history panel (triggers layout change)
    await addBtn.click();
    await page.locator('[data-testid="add-panel-history"]').click();
    await page.waitForTimeout(500);

    // Check both editors still have content
    const editors = page.locator(".cm-content, .ProseMirror, [contenteditable]");
    const allText = await editors.allTextContents();
    const combined = allText.join(" ");

    expect(combined, "Editor ONE content was lost").toContain("Editor ONE");
    expect(combined, "Editor TWO content was lost").toContain("Editor TWO");
  });
});
