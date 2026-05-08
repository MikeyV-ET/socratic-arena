import { test, expect } from "@playwright/test";

/**
 * UX tests for Attachment handling (SA_UX_SPEC.md R16+)
 *
 * R16: File attachment via chat input
 *   - Attach button visible and functional
 *   - File chips shown after selection
 *   - Files removable before send
 *   - Small text files (<=200 bytes) inlined in conversation
 *   - Large files (>200 bytes) saved with pointer/reference in conversation
 *   - Multiple file types handled (text, binary, code)
 */

test.describe("Attachment -- UI Controls", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("[data-node-id]").first()).toBeVisible({ timeout: 15_000 });
  });

  test("R16: Attach button is visible in input bar", async ({ page }) => {
    const attachBtn = page.locator('button[title="Attach file"]');
    await expect(attachBtn).toBeVisible();
  });

  test("R16: File input accepts files and shows chips", async ({ page }) => {
    const fileInput = page.locator('input[type="file"]');
    // Create a small test file via the file chooser
    await fileInput.setInputFiles({
      name: "test.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("hello world"),
    });
    // Chip should appear with filename
    const chip = page.locator("span.truncate", { hasText: "test.txt" });
    await expect(chip).toBeVisible({ timeout: 3000 });
  });

  test("R16: File chip has remove button that works", async ({ page }) => {
    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles({
      name: "removeme.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("temp"),
    });
    const chip = page.locator("span.truncate", { hasText: "removeme.txt" });
    await expect(chip).toBeVisible();
    // Click the remove button (x) next to the chip
    const removeBtn = chip.locator("..").locator("button");
    await removeBtn.click();
    await expect(chip).not.toBeVisible();
  });

  test("R16: Send button enabled when file attached (even without text)", async ({ page }) => {
    const sendBtn = page.locator('[data-testid="conversation-send"]');
    // Initially disabled (no text, no file)
    await expect(sendBtn).toBeDisabled();
    // Attach a file
    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles({
      name: "data.csv",
      mimeType: "text/csv",
      buffer: Buffer.from("a,b\n1,2"),
    });
    await expect(sendBtn).toBeEnabled();
  });
});

test.describe("Attachment -- 200 byte inline/pointer threshold", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("[data-node-id]").first()).toBeVisible({ timeout: 15_000 });
  });

  test("R16: Small text file (<=200 bytes) is inlined in conversation", async ({ page }) => {
    const smallContent = "This is a small file under 200 bytes.";
    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles({
      name: "small.txt",
      mimeType: "text/plain",
      buffer: Buffer.from(smallContent),
    });
    // Send the attachment
    await page.locator('[data-testid="conversation-send"]').click();
    // Wait for the message to appear in conversation
    await page.waitForTimeout(3000);
    // The inlined content should appear as "--- Attached file: small.txt ---" with the text
    const messages = page.locator('[data-pane-id="conversation"] [data-node-id]');
    const lastMessage = messages.last();
    const text = await lastMessage.textContent();
    expect(text).toContain("small.txt");
    expect(text).toContain(smallContent);
  });

  test("R16: Large text file (>200 bytes) gets pointer, not inlined content", async ({ page }) => {
    // Create content well over 200 bytes
    const largeContent = "x".repeat(300);
    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles({
      name: "large.txt",
      mimeType: "text/plain",
      buffer: Buffer.from(largeContent),
    });
    await page.locator('[data-testid="conversation-send"]').click();
    await page.waitForTimeout(3000);
    const messages = page.locator('[data-pane-id="conversation"] [data-node-id]');
    const lastMessage = messages.last();
    const text = await lastMessage.textContent();
    // Should reference the file but NOT contain the full 300 bytes of x's
    expect(text).toContain("large.txt");
    expect(text).toContain("saved to");
    expect(text).not.toContain("x".repeat(250));
  });

  test("R16: Exactly 200 byte file is inlined (boundary)", async ({ page }) => {
    const exactContent = "a".repeat(200);
    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles({
      name: "exact200.txt",
      mimeType: "text/plain",
      buffer: Buffer.from(exactContent),
    });
    await page.locator('[data-testid="conversation-send"]').click();
    await page.waitForTimeout(3000);
    const messages = page.locator('[data-pane-id="conversation"] [data-node-id]');
    const lastMessage = messages.last();
    const text = await lastMessage.textContent();
    expect(text).toContain("exact200.txt");
    // 200 bytes should be inlined (<=200 threshold)
    expect(text).toContain("a".repeat(50)); // at least some of the content visible
  });

  test("R16: 201 byte file gets pointer (boundary)", async ({ page }) => {
    const overContent = "b".repeat(201);
    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles({
      name: "over201.txt",
      mimeType: "text/plain",
      buffer: Buffer.from(overContent),
    });
    await page.locator('[data-testid="conversation-send"]').click();
    await page.waitForTimeout(3000);
    const messages = page.locator('[data-pane-id="conversation"] [data-node-id]');
    const lastMessage = messages.last();
    const text = await lastMessage.textContent();
    expect(text).toContain("over201.txt");
    expect(text).toContain("saved to");
  });

  test("R16: Binary file always gets pointer regardless of size", async ({ page }) => {
    // A 50-byte PNG-like file (binary, not text)
    const binaryData = Buffer.alloc(50, 0x89);
    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles({
      name: "icon.png",
      mimeType: "image/png",
      buffer: binaryData,
    });
    await page.locator('[data-testid="conversation-send"]').click();
    await page.waitForTimeout(3000);
    const messages = page.locator('[data-pane-id="conversation"] [data-node-id]');
    const lastMessage = messages.last();
    const text = await lastMessage.textContent();
    expect(text).toContain("icon.png");
    expect(text).toContain("saved to");
  });

  test("R16: Multiple files can be attached and sent together", async ({ page }) => {
    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles([
      { name: "a.txt", mimeType: "text/plain", buffer: Buffer.from("file a") },
      { name: "b.txt", mimeType: "text/plain", buffer: Buffer.from("file b") },
    ]);
    // Both chips visible
    await expect(page.locator("span.truncate", { hasText: "a.txt" })).toBeVisible();
    await expect(page.locator("span.truncate", { hasText: "b.txt" })).toBeVisible();
    await page.locator('[data-testid="conversation-send"]').click();
    await page.waitForTimeout(3000);
    const messages = page.locator('[data-pane-id="conversation"] [data-node-id]');
    const lastMessage = messages.last();
    const text = await lastMessage.textContent();
    expect(text).toContain("a.txt");
    expect(text).toContain("b.txt");
  });
});
