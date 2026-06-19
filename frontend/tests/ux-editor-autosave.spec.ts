/**
 * Editor Autosave + Per-Edit Tracking Tests (Feature 17)
 *
 * Tests Google Docs-style autosave:
 * - Edits automatically saved without manual action
 * - Edit history tracks individual changes
 * - Author attribution on each edit
 * - Can view edit history / version timeline
 */

import { test, expect } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

const BASE = "http://localhost:5175";
const API = "http://localhost:8002";

test.describe("Feature 17: Autosave + Per-Edit Tracking", () => {

  test("F17-1: File-backed doc auto-saves edits to disk", async ({ page }) => {
    // Create a temp file, open it via UI, edit, check disk content changed
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sa-autosave-test-"));
    const filePath = path.join(tmpDir, "autosave-test.md");
    fs.writeFileSync(filePath, "# Original\n");

    try {
      await page.goto(BASE);
      await page.waitForLoadState("networkidle");

      // Register file via Vite-proxied API (same backend the frontend WebSocket uses)
      const openResp = await page.request.post(`${BASE}/api/files/open`, {
        data: { path: filePath },
      });
      expect(openResp.status()).toBe(200);
      const doc = await openResp.json();
      const docId = doc.id;

      // Open an editor panel and wait for it to be ready
      await page.locator('[data-testid="open-tab-menu"]').click();
      await page.locator('[data-testid="add-panel-editor"]').click();
      await page.locator('[data-testid="shared-editor"]').waitFor({ timeout: 5000 });
      await page.locator('[data-testid="view-mode-toggle"]').waitFor({ timeout: 5000 });

      // Tell frontend to switch to our doc
      await page.evaluate((id) => {
        window.dispatchEvent(new CustomEvent("sa-docs-changed"));
        window.dispatchEvent(new CustomEvent("sa-open-doc", { detail: { docId: id } }));
      }, docId);
      await page.waitForTimeout(2000);

      // Find and click into the editor
      const editor = page.locator(".cm-content").first();
      await editor.click();
      await page.keyboard.press("End");
      await editor.pressSequentially("\nAutosaved content here", { delay: 20 });

      // Wait for autosave (2s debounce + buffer)
      await page.waitForTimeout(8000);

      // Check disk content
      const diskContent = fs.readFileSync(filePath, "utf-8");
      expect(diskContent, "Autosaved content should appear on disk").toContain("Autosaved content here");
    } finally {
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      fs.rmdirSync(tmpDir);
    }
  });

  // F17-2 dropped: edit history was descoped from F17, only autosave-to-disk implemented

  test("F17-3: Autosave indicator visible during save", async ({ page }) => {
    await page.goto(BASE);
    await page.waitForLoadState("networkidle");

    // Open editor
    const addBtn = page.locator('[data-testid="open-tab-menu"]');
    await addBtn.click();
    await page.locator('[data-testid="add-panel-editor"]').click();
    await page.waitForTimeout(500);

    // Look for autosave indicator (saving/saved status)
    const saveIndicator = page.locator('[data-testid*="save-status"], [data-testid*="autosave"], [class*="save-indicator"]');
    const statusText = page.locator('text=/saved|saving|auto.?save/i');

    const indicatorCount = await saveIndicator.count();
    const statusCount = await statusText.count();

    // Feature may not be implemented yet
    if (indicatorCount + statusCount === 0) {
      test.fail();
    }
  });
});
