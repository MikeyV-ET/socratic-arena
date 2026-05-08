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

  /**
   * Helper: send a file attachment and wait for the user message containing
   * the filename to appear in the live conversation pane. Returns the
   * matching node's textContent.
   *
   * Backend format:
   *   inlined:  "--- Attached file: {name} ---"
   *   pointer:  "[Attached file: {name} (...) saved to: ...]"
   * Both contain the filename, so we wait for a node whose text includes it.
   */
  async function sendFileAndGetMessage(
    page: import("@playwright/test").Page,
    files: Parameters<import("@playwright/test").Locator["setInputFiles"]>[0],
    filename: string,
  ): Promise<string> {
    const container = page.locator('[data-testid="conversation-messages"]');
    const nodesBefore = await container.locator("[data-node-id]").count();

    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles(files);
    await page.locator('[data-testid="conversation-send"]').click();

    // Wait for a NEW node containing the filename (backend echoes it back)
    const msgNode = container.locator("[data-node-id]", { hasText: filename });
    await expect(msgNode.first()).toBeVisible({ timeout: 15_000 });
    return (await msgNode.first().textContent()) ?? "";
  }

  test("R16: Small text file (<=200 bytes) is inlined in conversation", async ({ page }) => {
    const smallContent = "This is a small file under 200 bytes.";
    const text = await sendFileAndGetMessage(page, {
      name: "small.txt",
      mimeType: "text/plain",
      buffer: Buffer.from(smallContent),
    }, "small.txt");
    expect(text).toContain("--- Attached file: small.txt ---");
    expect(text).toContain(smallContent);
  });

  test("R16: Large text file (>200 bytes) gets pointer, not inlined content", async ({ page }) => {
    const largeContent = "x".repeat(300);
    const text = await sendFileAndGetMessage(page, {
      name: "large.txt",
      mimeType: "text/plain",
      buffer: Buffer.from(largeContent),
    }, "large.txt");
    expect(text).toContain("large.txt");
    expect(text).toContain("saved to");
    expect(text).not.toContain("x".repeat(250));
  });

  test("R16: Exactly 200 byte file is inlined (boundary)", async ({ page }) => {
    const exactContent = "a".repeat(200);
    const text = await sendFileAndGetMessage(page, {
      name: "exact200.txt",
      mimeType: "text/plain",
      buffer: Buffer.from(exactContent),
    }, "exact200.txt");
    expect(text).toContain("--- Attached file: exact200.txt ---");
    expect(text).toContain("a".repeat(50));
  });

  test("R16: 201 byte file gets pointer (boundary)", async ({ page }) => {
    const text = await sendFileAndGetMessage(page, {
      name: "over201.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("b".repeat(201)),
    }, "over201.txt");
    expect(text).toContain("over201.txt");
    expect(text).toContain("saved to");
  });

  test("R16: Binary file always gets pointer regardless of size", async ({ page }) => {
    const text = await sendFileAndGetMessage(page, {
      name: "icon.png",
      mimeType: "image/png",
      buffer: Buffer.alloc(50, 0x89),
    }, "icon.png");
    expect(text).toContain("icon.png");
    expect(text).toContain("saved to");
  });

  test("R16: Multiple files can be attached and sent together", async ({ page }) => {
    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles([
      { name: "a.txt", mimeType: "text/plain", buffer: Buffer.from("file a") },
      { name: "b.txt", mimeType: "text/plain", buffer: Buffer.from("file b") },
    ]);
    await expect(page.locator("span.truncate", { hasText: "a.txt" })).toBeVisible();
    await expect(page.locator("span.truncate", { hasText: "b.txt" })).toBeVisible();
    await page.locator('[data-testid="conversation-send"]').click();

    // Both filenames should appear in the conversation (may be same or separate nodes)
    const container = page.locator('[data-testid="conversation-messages"]');
    await expect(container.locator("[data-node-id]", { hasText: "a.txt" }).first()).toBeVisible({ timeout: 15_000 });
    const node = container.locator("[data-node-id]", { hasText: "a.txt" }).first();
    const text = (await node.textContent()) ?? "";
    expect(text).toContain("a.txt");
    expect(text).toContain("b.txt");
  });
});
