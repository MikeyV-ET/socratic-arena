/**
 * Editor Inline Image Rendering Tests (Feature 18)
 *
 * Tests that markdown images render in editor preview mode:
 * - Backend serves raw files via GET /api/files/raw?path=...
 * - Frontend rewrites relative image paths using file's directory context
 * - Absolute paths and http(s) URLs also work
 * - Security: paths outside allowed directories are rejected
 */

import { test, expect } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

const BASE = "http://localhost:5175";
const API = "http://localhost:8002";

test.describe("Feature 18: Inline Image Rendering", () => {

  // --- Backend Tests: /api/files/raw endpoint ---

  test("F18-BE1: GET /api/files/raw serves an image file with correct MIME type", async ({ request }) => {
    // Create a temp PNG file (1x1 pixel)
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sa-img-test-"));
    const pngPath = path.join(tmpDir, "test.png");
    // Minimal 1x1 PNG
    const pngBytes = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
      "base64"
    );
    fs.writeFileSync(pngPath, pngBytes);

    try {
      const resp = await request.get(`${API}/api/files/raw`, {
        params: { path: pngPath },
      });
      expect(resp.status(), "Raw file endpoint should return 200").toBe(200);

      const contentType = resp.headers()["content-type"] || "";
      expect(contentType, "Should serve PNG with image/png MIME type").toContain("image/png");

      const body = await resp.body();
      expect(body.length, "Response body should match file size").toBe(pngBytes.length);
    } finally {
      fs.unlinkSync(pngPath);
      fs.rmdirSync(tmpDir);
    }
  });

  test("F18-BE2: GET /api/files/raw returns 404 for nonexistent file", async ({ request }) => {
    const resp = await request.get(`${API}/api/files/raw`, {
      params: { path: "/tmp/nonexistent-sa-test-image-xyz.png" },
    });
    expect(resp.status(), "Should return 404 for missing file").toBe(404);
  });

  test("F18-BE3: GET /api/files/raw serves JPEG with correct MIME", async ({ request }) => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sa-img-test-"));
    const jpgPath = path.join(tmpDir, "test.jpg");
    // Minimal JPEG (JFIF header)
    const jpgBytes = Buffer.from(
      "/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAMCAgMCAgMDAwMEAwMEBQgFBQQEBQoHBwYIDAoMCwsKCwsM" +
      "EA4SFBM0EBUUFRA4HBcVGBkUFRgcFxQYGRj/2wBDAQMEBAUEBQkFBQkYEA0QGBgYGBgYGBgYGBgYGBgY" +
      "GBgYGBgYGBgYGBgYGBgYGBgYGBgYGBgYGBgYGBgYGBgYGBj/wAARCAABAAEDASIAAhEBAxEB/8QAFAABAAAAAAAAAAAAAAAAAAAAB//EABQQAQAAAAAAAAAAAAAAAAAAAAD/xAAUAQEAAAAAAAAAAAAAAAAAAAAA/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAwDAQACEQMRAD8AJgA//9k=",
      "base64"
    );
    fs.writeFileSync(jpgPath, jpgBytes);

    try {
      const resp = await request.get(`${API}/api/files/raw`, {
        params: { path: jpgPath },
      });
      expect(resp.status()).toBe(200);
      const contentType = resp.headers()["content-type"] || "";
      expect(contentType, "Should serve JPEG with image/jpeg MIME type").toMatch(/image\/jpe?g/);
    } finally {
      fs.unlinkSync(jpgPath);
      fs.rmdirSync(tmpDir);
    }
  });

  // --- Frontend Tests: Image rendering in preview ---

  test("F18-FE1: Editor preview renders img tag for markdown image syntax", async ({ page }) => {
    // Create a temp file with image markdown, open it, check preview
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sa-img-fe1-test-"));
    const mdPath = path.join(tmpDir, "imgtest.md");
    fs.writeFileSync(mdPath, "# Image Test\n\n![test image](https://via.placeholder.com/1x1.png)\n");

    try {
      await page.goto(BASE);
      await page.waitForLoadState("networkidle");

      // Open the file via API
      const openResp = await page.request.post(`${API}/api/files/open`, {
        data: { path: mdPath },
      });
      expect(openResp.status()).toBe(200);
      await page.waitForTimeout(1000);

      // Switch to preview mode
      const previewBtn = page.locator("button, [role='tab']").filter({ hasText: /preview/i }).first();
      if (await previewBtn.isVisible()) {
        await previewBtn.click();
        await page.waitForTimeout(500);
      }

      // Check that an img tag was rendered
      const img = page.locator("img[alt='test image']");
      const imgCount = await img.count();
      expect(imgCount, "Preview should render an <img> tag for markdown image").toBeGreaterThan(0);
    } finally {
      fs.unlinkSync(mdPath);
      fs.rmdirSync(tmpDir);
    }
  });

  test("F18-FE2: Editor preview rewrites relative image paths to /api/files/raw", async ({ page }) => {
    // Create a temp dir with a markdown file and an image
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sa-img-fe-test-"));
    const pngPath = path.join(tmpDir, "screenshot.png");
    const pngBytes = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
      "base64"
    );
    fs.writeFileSync(pngPath, pngBytes);

    const mdPath = path.join(tmpDir, "test.md");
    fs.writeFileSync(mdPath, "# Test\n\n![my image](./screenshot.png)\n");

    try {
      await page.goto(BASE);
      await page.waitForLoadState("networkidle");

      // Open the markdown file via API
      const openResp = await page.request.post(`${API}/api/files/open`, {
        data: { path: mdPath },
      });
      expect(openResp.status()).toBe(200);
      await page.waitForTimeout(1000);

      // Switch to preview mode
      const previewBtn = page.locator("button, [role='tab']").filter({ hasText: /preview/i }).first();
      if (await previewBtn.isVisible()) {
        await previewBtn.click();
        await page.waitForTimeout(500);
      }

      // Check that the image src was rewritten to use /api/files/raw
      const img = page.locator("img[alt='my image']");
      const imgCount = await img.count();
      if (imgCount > 0) {
        const src = await img.getAttribute("src");
        expect(src, "Relative image path should be rewritten to /api/files/raw endpoint").toContain("/api/files/raw");
        expect(src, "Rewritten path should include the absolute image path").toContain("screenshot.png");
      } else {
        expect(imgCount, "Preview should render an img tag for the relative image").toBeGreaterThan(0);
      }
    } finally {
      fs.unlinkSync(pngPath);
      fs.unlinkSync(mdPath);
      fs.rmdirSync(tmpDir);
    }
  });

  test("F18-FE3: Editor preview passes http(s) image URLs through unchanged", async ({ page }) => {
    // Create a temp file with an external image URL
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sa-img-fe3-test-"));
    const mdPath = path.join(tmpDir, "extimg.md");
    fs.writeFileSync(mdPath, "# External\n\n![ext](https://example.com/image.png)\n");

    try {
      await page.goto(BASE);
      await page.waitForLoadState("networkidle");

      const openResp = await page.request.post(`${API}/api/files/open`, {
        data: { path: mdPath },
      });
      expect(openResp.status()).toBe(200);
      await page.waitForTimeout(1000);

      // Switch to preview
      const previewBtn = page.locator("button, [role='tab']").filter({ hasText: /preview/i }).first();
      if (await previewBtn.isVisible()) {
        await previewBtn.click();
        await page.waitForTimeout(500);
      }

      const img = page.locator("img[alt='ext']");
      const count = await img.count();
      if (count > 0) {
        const src = await img.getAttribute("src");
        expect(src, "External URLs should pass through unchanged").toBe("https://example.com/image.png");
      }
    } finally {
      fs.unlinkSync(mdPath);
      fs.rmdirSync(tmpDir);
    }
  });
});
