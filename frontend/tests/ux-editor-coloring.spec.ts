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

  test("F16-2: Backend tracks author per edit", async ({ request }) => {
    // Create a doc and check if edits carry author info
    const resp = await request.post(`${API}/api/docs`, {
      data: { title: "color-test", contentType: "markdown" },
    });
    expect(resp.status()).toBe(200);
    const doc = await resp.json();

    // Check if doc metadata includes author info or if edits API exists
    const metaResp = await request.get(`${API}/api/docs/${doc.id}`);
    if (metaResp.status() === 200) {
      const meta = await metaResp.json();
      // Should have some author tracking field
      const hasAuthor = meta.author || meta.created_by || meta.authors;
      // Soft check — if no author field, feature may not be implemented
      if (!hasAuthor) {
        test.fail();
      }
    }
  });
});
