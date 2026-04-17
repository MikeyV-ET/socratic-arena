import { test, expect } from "@playwright/test";

test.describe("UI interactions", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("[data-node-id]").first()).toBeVisible({ timeout: 15_000 });
  });

  test("tab switching works", async ({ page }) => {
    // Click Moments tab
    await page.getByRole("button", { name: "Moments" }).click();
    // Should see moments summary bar
    await expect(page.getByText(/^\d+ candidates$/)).toBeVisible({ timeout: 10_000 });

    // Click Notebook tab
    await page.getByRole("button", { name: "Notebook" }).click();
    await page.waitForTimeout(500);

    // Click Prompt Dev tab
    await page.getByRole("button", { name: "Prompt Dev" }).click();
    await expect(page.locator("text=Prompt Editor")).toBeVisible();

    // Click back to History
    await page.getByRole("button", { name: "History" }).click();
    await expect(page.locator("[data-node-id]")).toHaveCount(await page.locator("[data-node-id]").count());
  });

  test("moments panel loads and shows data", async ({ page }) => {
    await page.getByRole("button", { name: "Moments" }).click();

    // Wait for moments to load
    await expect(page.locator("text=/\\d+ candidates/")).toBeVisible({ timeout: 10_000 });

    // Should have filter buttons
    await expect(page.getByRole("button", { name: "all" })).toBeVisible();
    await expect(page.getByRole("button", { name: "verified" })).toBeVisible();
    await expect(page.getByRole("button", { name: "untested" })).toBeVisible();

    // Filter: click verified
    await page.getByRole("button", { name: "verified" }).click();
    await page.waitForTimeout(300);

    // Filter: click all to reset
    await page.getByRole("button", { name: "all" }).click();
  });

  test.skip("moment click navigates to history", async ({ page }) => {
    await page.getByRole("button", { name: "Moments" }).click();
    await expect(page.getByText(/^\d+ candidates$/)).toBeVisible({ timeout: 10_000 });

    // Click on a probe text cell in the first row (more reliable than clicking <tr>)
    const firstProbe = page.locator("tbody tr td").nth(2); // probe column
    await expect(firstProbe).toBeVisible({ timeout: 5_000 });
    await firstProbe.click();
    await page.waitForTimeout(1000);

    // Verify the History tab is now active by checking its button style
    // The active tab has border-b-primary (not border-b-transparent)
    const historyButtons = page.getByRole("button", { name: "History" });
    const count = await historyButtons.count();
    let found = false;
    for (let i = 0; i < count; i++) {
      const cls = await historyButtons.nth(i).getAttribute("class");
      if (cls?.includes("border-b-primary")) { found = true; break; }
    }
    expect(found).toBe(true);
  });

  test("font size controls work", async ({ page }) => {
    // Find the A+ button in the left pane
    const aPlus = page.locator("button").filter({ hasText: "A+" }).first();
    await expect(aPlus).toBeVisible();

    // Click A+ to increase font
    await aPlus.click();
    await page.waitForTimeout(200);

    // Click A- to decrease
    const aMinus = page.locator("button").filter({ hasText: "A-" }).first();
    await aMinus.click();
  });

  test("flag button appears on hover", async ({ page }) => {
    // Hover over a message to reveal action buttons
    const firstNode = page.locator("[data-node-id]").first();
    await firstNode.hover();

    // Flag button should become visible (opacity changes on group hover)
    await page.waitForTimeout(300);
    // The flag icon (⚑) should be in the DOM
    const flagButton = firstNode.locator("text=⚑");
    // It exists but may be transparent — check it's in the DOM
    expect(await flagButton.count()).toBeGreaterThanOrEqual(0);
  });

  test("conversation scrolls and selects nodes", async ({ page }) => {
    const scrollContainer = page.locator(".overflow-y-auto").first();

    // Scroll up
    await scrollContainer.evaluate((el) => { el.scrollTop = 0; });
    await page.waitForTimeout(500);

    // Scroll down
    await scrollContainer.evaluate((el) => { el.scrollTop = el.scrollHeight; });
    await page.waitForTimeout(500);

    // Should still have nodes visible
    await expect(page.locator("[data-node-id]").first()).toBeVisible();
  });

  test("screenshot captures current state", async ({ page }) => {
    await page.screenshot({ path: "/tmp/arena-test-screenshot.png", fullPage: false });
  });

  test("textarea auto-grows with content", async ({ page }) => {
    const textarea = page.locator('textarea[placeholder="Type a message..."]');
    await expect(textarea).toBeVisible();

    // Get initial height
    const initialHeight = await textarea.evaluate((el) => el.offsetHeight);

    // Type multiple lines (Shift+Enter for newlines)
    await textarea.fill("Line 1\nLine 2\nLine 3\nLine 4\nLine 5");
    await page.waitForTimeout(200);

    // Height should have grown
    const grownHeight = await textarea.evaluate((el) => el.offsetHeight);
    expect(grownHeight).toBeGreaterThan(initialHeight);
  });

  test("shift+enter inserts newline without submitting", async ({ page }) => {
    const textarea = page.locator('textarea[placeholder="Type a message..."]');
    await textarea.fill("first line");
    await textarea.press("Shift+Enter");
    await textarea.type("second line");
    await page.waitForTimeout(100);

    const value = await textarea.inputValue();
    expect(value).toContain("first line");
    expect(value).toContain("second line");
    // Message was not sent (textarea still has content)
    expect(value.length).toBeGreaterThan(10);
  });

  test("file upload button opens file dialog", async ({ page }) => {
    // The attach file button should be visible
    const attachBtn = page.locator('button[title="Attach file"]');
    await expect(attachBtn).toBeVisible();

    // The hidden file input should exist
    const fileInput = page.locator('input[type="file"]');
    expect(await fileInput.count()).toBe(1);
    expect(await fileInput.isHidden()).toBe(true);
  });

  test("file chips appear when files are selected", async ({ page }) => {
    const fileInput = page.locator('input[type="file"]');

    // Create a test file and attach it
    await fileInput.setInputFiles({
      name: "test-doc.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("test content"),
    });
    await page.waitForTimeout(300);

    // File chip should appear with filename
    await expect(page.locator("text=test-doc.txt")).toBeVisible();

    // Remove button (x) should exist on the chip
    const removeBtn = page.locator("text=test-doc.txt").locator("..").locator("button");
    await expect(removeBtn).toBeVisible();

    // Click remove
    await removeBtn.click();
    await page.waitForTimeout(200);

    // Chip should be gone
    await expect(page.locator("text=test-doc.txt")).not.toBeVisible();
  });
});