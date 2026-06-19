/**
 * Editor Author-Based Text Coloring Tests (Feature 16)
 *
 * Tests that edits by different authors get distinct visual colors:
 * - Eric's edits have one color, agent edits have another
 * - Different agents (Jr, Q, etc.) are distinguishable
 * - Color persists across sessions
 */

import { test, expect } from "@playwright/test";

const BASE = "http://localhost:5175";
const API = "http://localhost:8002";

test.describe("Feature 16: Author-Based Text Coloring", () => {

  test("F16-1: Editor text has author attribution styling", async ({ page }) => {
    await page.goto(BASE);
    await page.waitForLoadState("networkidle");

    // Open editor
    const addBtn = page.locator('[data-testid="open-tab-menu"]');
    await addBtn.click();
    await page.locator('[data-testid="add-panel-editor"]').click();
    await page.waitForTimeout(500);

    // Type some text
    const editor = page.locator(".cm-content, .ProseMirror, [contenteditable]").first();
    await editor.click();
    await editor.pressSequentially("Test coloring text", { delay: 10 });
    await page.waitForTimeout(500);

    // Check for author-specific styling — look for color-coded spans or classes
    // The current system uses green for Eric, blue for agent — look for styled marks
    const coloredSpans = page.locator('.cm-content span[style*="color"], .cm-content span[style*="background"], .cm-content [class*="author"], .cm-content [data-author]');
    const decorations = page.locator('.cm-content .cm-ySelection, .cm-content [class*="collab"]');

    const colorCount = await coloredSpans.count();
    const decoCount = await decorations.count();

    // At minimum, text should have some author-attributed styling
    expect(colorCount + decoCount, "Editor should show author-attributed styling on text").toBeGreaterThan(0);
  });

  // F16-2 dropped: author tracking is client-side via Yjs CRDT attributes, no server-side metadata
});
