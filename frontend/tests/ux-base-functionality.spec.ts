import { test, expect } from "@playwright/test";

/**
 * ux-base-functionality.spec.ts — User-perspective base functionality tests.
 *
 * These tests verify what a user actually sees when they open SA.
 * No store inspection, no data-testid counting, no DOM plumbing.
 * Each test asks a question a user would ask and checks the answer.
 *
 * Requires: SA backend on port 8000, frontend serving from same origin.
 */

const API = "http://localhost:8000";
const AGENT = "Q";

/** Fetch the last N messages from the history API. */
async function getHistoryMessages(agent: string, limit?: number) {
  const url = `${API}/api/agent/${agent}/history`;
  const resp = await fetch(url);
  const data = await resp.json();
  const msgs = data.messages ?? [];
  return limit ? msgs.slice(-limit) : msgs;
}

/** Wait for conversation messages to render in the live pane. */
async function waitForMessages(page: import("@playwright/test").Page) {
  // Wait for at least one message with visible text content
  const container = page.locator('[data-testid="conversation-messages"]').first();
  await container.locator("[data-node-id]").first().waitFor({ timeout: 15_000 });
}

// ============================================================================
// Test 1: Is the right message at the bottom?
// ============================================================================

test("bottom message matches the most recent message from the API", async ({ page }) => {
  await page.goto("/");
  await waitForMessages(page);

  const container = page.locator('[data-testid="conversation-messages"]').first();

  // Scroll to the absolute bottom — what a user sees after the page loads
  await container.evaluate((el) => el.scrollTo(0, el.scrollHeight));
  await page.waitForTimeout(1500);
  // Scroll again in case content grew during the first scroll
  await container.evaluate((el) => el.scrollTo(0, el.scrollHeight));
  await page.waitForTimeout(500);

  // Get the visually bottommost message
  const bottomNodeId = await container.evaluate((el) => {
    const nodes = Array.from(el.querySelectorAll("[data-node-id]"));
    if (nodes.length === 0) return null;
    const sorted = nodes
      .map((n) => ({ id: n.getAttribute("data-node-id"), top: n.getBoundingClientRect().top }))
      .sort((a, b) => b.top - a.top);
    return sorted[0].id;
  });
  expect(bottomNodeId, "No messages rendered").toBeTruthy();

  // Query the API AFTER settling — compare against what the backend knows
  const apiMessages = await getHistoryMessages(AGENT);
  const lastApiMsg = apiMessages[apiMessages.length - 1];
  expect(lastApiMsg, "API returned no messages").toBeTruthy();

  expect(
    bottomNodeId,
    `Bottom message in UI (${bottomNodeId}) doesn't match API's latest (${lastApiMsg.id}).`
  ).toBe(lastApiMsg.id);
});

// ============================================================================
// Test 2: Are message gaps exactly 4px?
// ============================================================================

test("gap between consecutive messages is exactly 4px", async ({ page }) => {
  await page.goto("/");
  await waitForMessages(page);
  // Give the virtualizer time to measure all items and stabilize positions
  await page.waitForTimeout(3000);

  // Measure bounding rects of all visible messages
  const gaps = await page.evaluate(() => {
    const container = document.querySelector('[data-testid="conversation-messages"]');
    if (!container) return { error: "no container" };

    const nodes = Array.from(container.querySelectorAll("[data-node-id]"));
    if (nodes.length < 2) return { error: "fewer than 2 messages", count: nodes.length };

    // Sort by visual position (translateY)
    const sorted = nodes
      .map((el) => {
        const rect = el.getBoundingClientRect();
        return { top: rect.top, bottom: rect.bottom, height: rect.height, id: el.getAttribute("data-node-id") };
      })
      .sort((a, b) => a.top - b.top);

    const gaps: { between: string; gap: number }[] = [];
    for (let i = 0; i < sorted.length - 1; i++) {
      const gap = Math.round((sorted[i + 1].top - sorted[i].bottom) * 100) / 100;
      gaps.push({
        between: `${sorted[i].id?.slice(0, 8)}..${sorted[i + 1].id?.slice(0, 8)}`,
        gap,
      });
    }
    return { gaps, count: sorted.length };
  });

  expect(gaps).not.toHaveProperty("error");
  const result = gaps as { gaps: { between: string; gap: number }[]; count: number };
  expect(result.count).toBeGreaterThanOrEqual(2);

  for (const entry of result.gaps) {
    expect(entry.gap, `Gap between ${entry.between} was ${entry.gap}px, expected 4px`).toBe(4);
  }
});

// ============================================================================
// Test 3: Do thinking traces load and display?
// ============================================================================

test("messages with thinking traces show a thinking toggle", async ({ page }) => {
  const apiMessages = await getHistoryMessages(AGENT);
  const withThinking = apiMessages.filter((m: any) => m.thinking);
  test.skip(withThinking.length === 0, "No messages with thinking traces in current history");

  await page.goto("/");
  await waitForMessages(page);
  await page.waitForTimeout(1000);

  const container = page.locator('[data-testid="conversation-messages"]').first();
  const thinkingButton = container.locator("button", { hasText: "thinking" }).first();

  // Check the initial viewport — thinking toggle may already be visible
  let foundToggle = await thinkingButton.count() > 0;

  if (!foundToggle) {
    // Scroll up slowly, checking after each scroll. The windowed model
    // removes items from DOM as you scroll, so check frequently.
    for (let i = 0; i < 40 && !foundToggle; i++) {
      await page.mouse.wheel(0, -300);
      await page.waitForTimeout(300);
      foundToggle = await thinkingButton.count() > 0;
    }
  }

  expect(foundToggle, "No thinking toggle found after scrolling through all messages").toBe(true);

  // Click the toggle and verify thinking content appears
  await thinkingButton.click();
  const thinkingContent = container.locator(".italic.whitespace-pre-wrap").first();
  await expect(thinkingContent).toBeVisible({ timeout: 2000 });
  const text = await thinkingContent.innerText();
  expect(text.length, "Thinking content is empty").toBeGreaterThan(0);
});

// ============================================================================
// Test 4: Scroll up loads older messages, scroll back down finds newer ones
// ============================================================================

test("scrolling up reveals older messages, scrolling back down shows the original ones", async ({ page }) => {
  await page.goto("/");
  await waitForMessages(page);

  const container = page.locator('[data-testid="conversation-messages"]').first();

  // Record the messages currently visible at the bottom
  const getVisibleMessageIds = async () => {
    return container.evaluate((el) => {
      const nodes = el.querySelectorAll("[data-node-id]");
      return Array.from(nodes).map((n) => n.getAttribute("data-node-id"));
    });
  };

  const originalIds = await getVisibleMessageIds();
  expect(originalIds.length).toBeGreaterThan(0);

  // Remember the last message (the one at the very bottom)
  const bottomMsgId = originalIds[originalIds.length - 1];

  // Scroll up substantially — multiple wheel events
  for (let i = 0; i < 20; i++) {
    await page.mouse.wheel(0, -300);
    await page.waitForTimeout(100);
  }
  // Wait for any lazy loading to complete
  await page.waitForTimeout(1500);

  const afterScrollUpIds = await getVisibleMessageIds();

  // After scrolling up, we should see at least some different messages
  // (unless the conversation is very short)
  const apiMessages = await getHistoryMessages(AGENT);
  if (apiMessages.length > 20) {
    const newMessages = afterScrollUpIds.filter((id) => !originalIds.includes(id));
    expect(
      newMessages.length,
      "Scrolling up didn't reveal any new messages"
    ).toBeGreaterThan(0);
  }

  // Now scroll back down to the bottom
  // Try jump-to-latest button first (look broadly — it might be anywhere in the pane)
  const jumpButton = page.locator("button", { hasText: /latest|↓|⬇/i }).first();
  if (await jumpButton.count() > 0 && await jumpButton.isVisible()) {
    await jumpButton.click();
    await page.waitForTimeout(1500);
  } else {
    // Scroll to absolute bottom
    await container.evaluate((el) => el.scrollTo(0, el.scrollHeight));
    await page.waitForTimeout(1000);
    await container.evaluate((el) => el.scrollTo(0, el.scrollHeight));
    await page.waitForTimeout(1000);
  }

  // The bottom message should be reachable — either visible or we can get back to it
  const afterScrollBackIds = await getVisibleMessageIds();
  expect(
    afterScrollBackIds,
    "After scrolling back down, the original bottom message is gone"
  ).toContain(bottomMsgId);
});

// ============================================================================
// Test 5: Scrolling down from mid-history does NOT jump to latest
// ============================================================================

test("scrolling down from mid-history advances gradually, not jumps to latest", async ({ page }) => {
  const apiMessages = await getHistoryMessages(AGENT);
  test.skip(apiMessages.length <= 30, "Need >30 messages to test mid-history scroll");

  await page.goto("/");
  await waitForMessages(page);

  const container = page.locator('[data-testid="conversation-messages"]').first();

  // Record the latest message ID (the one we should NOT jump to)
  const latestId = apiMessages[apiMessages.length - 1].id;

  // Scroll up substantially to get into mid-history
  for (let i = 0; i < 25; i++) {
    await page.mouse.wheel(0, -400);
    await page.waitForTimeout(100);
  }
  await page.waitForTimeout(2000);

  // Record what messages are visible after scrolling up
  const midHistoryIds = await container.evaluate((el) => {
    const nodes = el.querySelectorAll("[data-node-id]");
    return Array.from(nodes).map((n) => n.getAttribute("data-node-id"));
  });

  // Confirm we're NOT seeing the latest message (we scrolled away from it)
  const seeLatestBeforeDown = midHistoryIds.includes(latestId);
  test.skip(seeLatestBeforeDown, "Could not scroll far enough from latest — history too short");

  // Now scroll DOWN a moderate amount (not all the way — just a few wheel ticks)
  for (let i = 0; i < 5; i++) {
    await page.mouse.wheel(0, 400);
    await page.waitForTimeout(200);
  }
  await page.waitForTimeout(1500);

  // Check what's visible now
  const afterDownIds = await container.evaluate((el) => {
    const nodes = el.querySelectorAll("[data-node-id]");
    return Array.from(nodes).map((n) => n.getAttribute("data-node-id"));
  });

  // The latest message should NOT be visible — we only scrolled down a bit,
  // not all the way. If it IS visible, the UI jumped to latest.
  expect(
    afterDownIds.includes(latestId),
    `Scrolling down 5 ticks from mid-history jumped to the latest message (${latestId?.slice(0, 12)}). ` +
    `Expected gradual scroll, got teleport. Visible IDs went from mid-history to latest.`
  ).toBe(false);
});

// ============================================================================
// Test 6: Workbench tabs can be reordered by dragging
// ============================================================================

test("workbench tabs can be reordered by dragging", async ({ page }) => {
  await page.goto("/");
  await page.waitForTimeout(2000);

  const getTabs = async () => {
    const tabs = await page.locator('[data-testid^="workbench-tab-"]').all();
    const ids: string[] = [];
    for (const t of tabs) {
      const testid = await t.getAttribute("data-testid");
      if (testid) ids.push(testid.replace("workbench-tab-", ""));
    }
    return ids;
  };

  const before = await getTabs();
  expect(before.length, "Need at least 2 tabs to test reorder").toBeGreaterThanOrEqual(2);

  const firstTab = page.locator(`[data-testid="workbench-tab-${before[0]}"]`);
  const secondTab = page.locator(`[data-testid="workbench-tab-${before[1]}"]`);

  // Use explicit mouse steps (pointer events)
  const srcBox = (await firstTab.boundingBox())!;
  const tgtBox = (await secondTab.boundingBox())!;
  await page.mouse.move(srcBox.x + srcBox.width / 2, srcBox.y + srcBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(tgtBox.x + tgtBox.width / 2, tgtBox.y + tgtBox.height / 2, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(500);

  const after = await getTabs();

  // If drag worked, the first two tabs should be swapped
  expect(
    after[0],
    `Tab drag did not reorder: before=[${before.slice(0, 3)}...] after=[${after.slice(0, 3)}...]. ` +
    `Expected '${before[1]}' at position 0, got '${after[0]}'.`
  ).toBe(before[1]);
  expect(after[1]).toBe(before[0]);
});

// ============================================================================
// Test 7: Rendered content matches API for the last N messages
// ============================================================================

test("rendered messages match the API response for the last N visible messages", async ({ page }) => {
  await page.goto("/");
  await waitForMessages(page);
  await page.waitForTimeout(1000);

  const container = page.locator('[data-testid="conversation-messages"]').first();

  // Get all rendered node IDs and their text content
  const rendered = await container.evaluate((el) => {
    const nodes = el.querySelectorAll("[data-node-id]");
    return Array.from(nodes).map((n) => ({
      id: n.getAttribute("data-node-id"),
      text: (n as HTMLElement).innerText,
    }));
  });

  expect(rendered.length, "No messages rendered").toBeGreaterThan(0);

  // Query API after page has loaded
  const apiMessages = await getHistoryMessages(AGENT);

  // Every rendered message should correspond to an API message with matching content.
  // Note: the WebSocket may deliver extra messages (from the live tailer) that the
  // REST API doesn't include yet. Skip those rather than failing.
  let verified = 0;
  let skippedLiveTail = 0;
  for (const r of rendered) {
    const apiMsg = apiMessages.find((m: any) => m.id === r.id);
    if (!apiMsg) {
      skippedLiveTail++;
      continue; // live-tailed message not in REST API — not a content error
    }

    // The frontend strips [Context left ...] tags from user messages.
    // Apply the same transform before comparing.
    let apiContent = apiMsg.content;
    if (apiMsg.role === "user") {
      apiContent = apiContent.replace(/\s*\[Context left [^\]]*\]\s*/g, "").trim();
    }

    // For content verification, check that distinctive words from the API
    // content appear in the rendered text. Markdown rendering changes
    // formatting but preserves words.
    const plainWords = apiContent
      .replace(/[#*`_\[\]()>|~]/g, " ")
      .replace(/\n/g, " ")
      .split(/\s+/)
      .filter((w: string) => w.length > 4 && !/^(https?|mailto)/.test(w))
      .slice(0, 10);

    if (plainWords.length >= 2) {
      // Check that at least half the probe words appear in rendered text
      const renderedLower = r.text.toLowerCase();
      const found = plainWords.filter((w: string) => renderedLower.includes(w.toLowerCase()));
      expect(
        found.length,
        `Message ${r.id?.slice(0, 12)} (${apiMsg.role}): only ${found.length}/${plainWords.length} words matched. Missing: ${plainWords.filter((w: string) => !renderedLower.includes(w.toLowerCase())).join(", ")}`
      ).toBeGreaterThanOrEqual(Math.ceil(plainWords.length / 2));
    }
    verified++;
  }

  expect(verified, "No messages were verified").toBeGreaterThan(0);
});