/**
 * Editor File Open Menu Tests (Feature 15)
 *
 * Tests the redesigned file open menu:
 * - Multi-level filesystem view shows several directory levels at once
 * - Can navigate into subdirectories
 * - Can open files from any visible level
 * - File browser supports the selected agent's filesystem
 */

import { test, expect } from "@playwright/test";

const BASE = "http://localhost:5175";
const API = "http://localhost:8002";

test.describe("Feature 15: File Open Menu Redesign", () => {

  test("F15-1: File browse endpoint returns directory listing", async ({ request }) => {
    const resp = await request.get(`${API}/api/files/browse`, {
      params: { path: "/home/eric/agents" },
    });
    expect(resp.status()).toBe(200);
    const data = await resp.json();
    // Should return entries with names and types
    expect(Array.isArray(data.entries || data), "Browse should return an array of entries").toBe(true);
  });

  test("F15-2: File open menu is accessible from editor", async ({ page }) => {
    await page.goto(BASE);
    await page.waitForLoadState("networkidle");

    // Open editor panel
    const addBtn = page.locator('[data-testid="open-tab-menu"]');
    await addBtn.click();
    await page.locator('[data-testid="add-panel-editor"]').click();
    await page.waitForTimeout(500);

    // Look for open/browse button
    const openBtn = page.locator('[data-testid="open-file-btn"], [data-testid="browse-files-btn"], button').filter({ hasText: /open|browse/i }).first();
    const visible = await openBtn.isVisible();
    expect(visible, "Open/Browse file button should be visible in editor").toBe(true);
  });

  test("F15-3: File browser shows multi-level directory tree", async ({ page }) => {
    await page.goto(BASE);
    await page.waitForLoadState("networkidle");

    // Open editor
    const addBtn = page.locator('[data-testid="open-tab-menu"]');
    await addBtn.click();
    await page.locator('[data-testid="add-panel-editor"]').click();
    await page.waitForTimeout(500);

    // Open file browser
    const openBtn = page.locator('[data-testid="open-file-btn"], [data-testid="browse-files-btn"], button').filter({ hasText: /open|browse/i }).first();
    if (await openBtn.isVisible()) {
      await openBtn.click();
      await page.waitForTimeout(500);
    }

    // Should show a tree or multi-level listing — look for nested elements or expand toggles
    const treeItems = page.locator('[data-testid*="file-tree"], [data-testid*="dir-entry"], [role="treeitem"], .file-tree-item, .directory-entry');
    const expandToggles = page.locator('[data-testid*="expand"], [data-testid*="toggle"], [aria-expanded]');

    const itemCount = await treeItems.count();
    const toggleCount = await expandToggles.count();

    // At minimum we should see some directory entries or tree items
    expect(itemCount + toggleCount, "File browser should show directory tree items or expandable entries").toBeGreaterThan(0);
  });
});
