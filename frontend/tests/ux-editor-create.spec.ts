/**
 * Editor Create New Document Tests (Feature 14)
 *
 * Tests the document creation flow:
 * - Create new document button is visible and clickable
 * - Directory picker appears for specifying save location
 * - New document is created on disk in the specified directory
 * - Document opens in editor after creation
 * - Invalid/missing directory is rejected
 */

import { test, expect } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

const BASE = "http://localhost:5175";
const API = "http://localhost:8002";

test.describe("Feature 14: Create New Document", () => {

  test("F14-1: Create doc button is visible in editor toolbar", async ({ page }) => {
    await page.goto(BASE);
    await page.waitForLoadState("networkidle");

    // Open editor panel
    const addBtn = page.locator('[data-testid="open-tab-menu"]');
    await addBtn.click();
    await page.locator('[data-testid="add-panel-editor"]').click();
    await page.waitForTimeout(500);

    const createBtn = page.locator('[data-testid="create-doc-btn"]');
    await expect(createBtn, "Create doc button should be visible").toBeVisible();
  });

  test("F14-2: API creates file on disk in specified directory", async ({ request }) => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sa-create-test-"));
    const fileName = "test-create.md";

    try {
      const resp = await request.post(`${API}/api/files/create`, {
        data: { name: fileName, directory: tmpDir },
      });
      expect(resp.status(), "Create file endpoint should return 200").toBe(200);

      const filePath = path.join(tmpDir, fileName);
      expect(fs.existsSync(filePath), "File should exist on disk").toBe(true);

      const content = fs.readFileSync(filePath, "utf-8");
      expect(content.length, "File should have some initial content").toBeGreaterThan(0);
    } finally {
      const filePath = path.join(tmpDir, fileName);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      fs.rmdirSync(tmpDir);
    }
  });

  test("F14-3: API rejects create when directory does not exist", async ({ request }) => {
    const resp = await request.post(`${API}/api/files/create`, {
      data: { name: "test.md", directory: "/tmp/nonexistent-sa-dir-xyz" },
    });
    expect(resp.status(), "Should reject nonexistent directory").toBe(400);
  });

  test("F14-4: API rejects create when file already exists", async ({ request }) => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sa-create-test-"));
    const fileName = "existing.md";
    const filePath = path.join(tmpDir, fileName);
    fs.writeFileSync(filePath, "already here");

    try {
      const resp = await request.post(`${API}/api/files/create`, {
        data: { name: fileName, directory: tmpDir },
      });
      expect(resp.status(), "Should reject when file already exists").toBe(409);
    } finally {
      fs.unlinkSync(filePath);
      fs.rmdirSync(tmpDir);
    }
  });

  test("F14-5: Create doc includes directory picker UI", async ({ page }) => {
    await page.goto(BASE);
    await page.waitForLoadState("networkidle");

    // Open editor panel
    const addBtn = page.locator('[data-testid="open-tab-menu"]');
    await addBtn.click();
    await page.locator('[data-testid="add-panel-editor"]').click();
    await page.waitForTimeout(500);

    // Click create button
    const createBtn = page.locator('[data-testid="create-doc-btn"]');
    await createBtn.click();
    await page.waitForTimeout(300);

    // Should show a form with directory input/picker
    const dirInput = page.locator('[data-testid="create-doc-directory"], [placeholder*="irectory"], [placeholder*="ocation"], [placeholder*="path"]');
    const dirCount = await dirInput.count();
    // Also check for a file browser / directory browser component
    const dirPicker = page.locator('[data-testid="directory-picker"], [data-testid="dir-picker"], [data-testid="file-browser"]');
    const pickerCount = await dirPicker.count();

    expect(dirCount + pickerCount, "Create form should include a directory picker or path input").toBeGreaterThan(0);
  });
});
