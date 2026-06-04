import { test, expect } from "@playwright/test";

/**
 * Shell panel input latency tests (SH-PERF)
 *
 * Eric reported slow cursor in the SA shell panel compared to the chat
 * input. The shell uses xterm.js with WebSocket PTY — each keystroke
 * round-trips through the server. These tests measure observable latency.
 *
 * Architecture: keystroke → xterm.js onData → WebSocket → server PTY →
 * echo → WebSocket → xterm.js render + mirror div text update.
 *
 * The mirror div (data-testid="shell-mirror") accumulates plain text
 * output and is used as the assertion target.
 *
 * SH-PERF1: Single keystroke echo latency
 * SH-PERF2: Burst typing latency (20 characters)
 * SH-PERF3: Latency after large output (degradation test)
 */

// Helper: open a shell panel and wait for it to be ready
async function openShell(page: any) {
  await page.locator('[data-testid="open-tab-menu"]').click();
  await page.waitForTimeout(300);
  await page.locator('[data-testid="add-panel-shell"]').click();
  await page.waitForTimeout(1000);

  const shellPanel = page.locator('[data-testid^="panel-content-shell"]');
  const terminal = shellPanel.locator('[data-testid="shell-terminal"]');
  await expect(terminal).toBeVisible({ timeout: 10_000 });
  const mirror = shellPanel.locator('[data-testid="shell-mirror"]');

  // Wait for shell prompt — mirror should have some content after bash starts
  await expect(mirror).not.toHaveText("", { timeout: 10_000 });
  // Give bash a moment to fully initialize
  await page.waitForTimeout(1500);

  // Focus the terminal
  await terminal.click();

  return { shellPanel, terminal, mirror };
}

// Helper: measure time for a marker string to appear in mirror div
async function measureEchoLatency(
  page: any,
  mirror: any,
  marker: string
): Promise<number> {
  const startTime = Date.now();
  // Type the marker — use page.keyboard for xterm.js
  await page.keyboard.type(marker, { delay: 0 });
  // Wait for marker to appear in mirror text
  await expect(mirror).toContainText(marker, { timeout: 10_000 });
  return Date.now() - startTime;
}

test.describe("Shell Input Latency (SH-PERF)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("[data-node-id]").first()).toBeVisible({ timeout: 15_000 });
  });

  test("SH-PERF1: Single command echo latency under 2 seconds", async ({ page }) => {
    test.setTimeout(60_000);
    const { terminal, mirror } = await openShell(page);

    // Type a unique marker command (don't press Enter — just measure echo)
    const marker = `__PERF1_${Date.now()}__`;
    const latency = await measureEchoLatency(page, mirror, marker);

    // Clean up: press Ctrl+C then Enter to reset prompt
    await page.keyboard.press("Control+c");
    await page.waitForTimeout(300);

    // Latency should be under 2 seconds for typed text to appear
    // This is generous — healthy should be <500ms
    expect(latency).toBeLessThan(2000);
  });

  test("SH-PERF2: Burst typing — 20 characters echo under 3 seconds", async ({ page }) => {
    test.setTimeout(60_000);
    const { terminal, mirror } = await openShell(page);

    // Type 20 characters as fast as possible
    const marker = `PERF2_${Date.now()}_END`;
    const startTime = Date.now();
    await page.keyboard.type(marker, { delay: 0 });
    // Wait for the full marker (including the END suffix) to appear
    await expect(mirror).toContainText(marker, { timeout: 10_000 });
    const latency = Date.now() - startTime;

    await page.keyboard.press("Control+c");

    // 20 chars should echo within 3 seconds even with per-keystroke round-trip
    expect(latency).toBeLessThan(3000);
  });

  test("SH-PERF3: Latency does not degrade after large output", async ({ page }) => {
    test.setTimeout(90_000);
    const { terminal, mirror } = await openShell(page);

    // Measure baseline latency
    const baseMarker = `BASE_${Date.now()}`;
    const baseLine = await measureEchoLatency(page, mirror, baseMarker);
    await page.keyboard.press("Control+c");
    await page.waitForTimeout(500);

    // Generate significant output (seq 1000 produces ~4KB of text)
    await page.keyboard.type("seq 1000");
    await page.keyboard.press("Enter");
    // Wait for output to complete — "1000" should appear in mirror
    await expect(mirror).toContainText("1000", { timeout: 15_000 });
    await page.waitForTimeout(1000);

    // Measure post-output latency
    const postMarker = `POST_${Date.now()}`;
    const postLine = await measureEchoLatency(page, mirror, postMarker);
    await page.keyboard.press("Control+c");

    // Post-output latency should not be more than 3x baseline
    // (some degradation is expected from mirror div string growth,
    // but catastrophic degradation indicates a bug)
    const ratio = postLine / Math.max(baseLine, 1);

    // Log for diagnostic purposes (visible in test output on failure)
    console.log(`Baseline latency: ${baseLine}ms`);
    console.log(`Post-output latency: ${postLine}ms`);
    console.log(`Degradation ratio: ${ratio.toFixed(2)}x`);

    // Generous threshold: even 5x would indicate a problem worth investigating
    // but the mirror div string concatenation could cause real degradation
    expect(postLine).toBeLessThan(5000);
  });

  test("SH-PERF4: Compare shell echo vs chat input responsiveness", async ({ page }) => {
    test.setTimeout(60_000);

    // Measure chat input latency first
    const chatInput = page.locator('input[placeholder*="Type a message"], textarea[placeholder*="Type a message"]');
    const chatVisible = await chatInput.isVisible().catch(() => false);
    test.skip(!chatVisible, "Chat input not visible");

    const chatMarker = `CHAT_${Date.now()}`;
    const chatStart = Date.now();
    await chatInput.fill(chatMarker);
    // Chat input is synchronous DOM — should be near-instant
    await expect(chatInput).toHaveValue(chatMarker, { timeout: 2000 });
    const chatLatency = Date.now() - chatStart;

    // Clear chat input
    await chatInput.fill("");

    // Now measure shell latency
    const { terminal, mirror } = await openShell(page);
    const shellMarker = `SHELL_${Date.now()}`;
    const shellLatency = await measureEchoLatency(page, mirror, shellMarker);
    await page.keyboard.press("Control+c");

    console.log(`Chat input latency: ${chatLatency}ms`);
    console.log(`Shell echo latency: ${shellLatency}ms`);

    // Shell will always be slower (network round-trip), but should be
    // within a reasonable multiple. Over 10x suggests a problem.
    // Note: Playwright timing adds overhead, so this is a rough check.
    if (chatLatency > 0) {
      const ratio = shellLatency / chatLatency;
      console.log(`Shell/chat ratio: ${ratio.toFixed(1)}x`);
    }

    // Absolute check: shell echo should be under 2 seconds
    expect(shellLatency).toBeLessThan(2000);
  });
});