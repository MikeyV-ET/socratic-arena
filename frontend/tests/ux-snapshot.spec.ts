import { test, expect } from "@playwright/test";

/**
 * UX tests using the snapshot/act pattern.
 *
 * These tests interact with SA the way an agent (or user) would:
 * read what's visible, act on it, read again to see the result.
 *
 * No data-testid, no data-pane-id, no implementation coupling.
 * Uses ariaSnapshot() for reading and getByRole/getByText for acting.
 */

/** Parse message entries from an ariaSnapshot string.
 *  Messages appear as: sender name line, then paragraph with content. */
function extractMessages(snapshot: string): { sender: string; text: string }[] {
  const messages: { sender: string; text: string }[] = [];
  const lines = snapshot.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    // Sender lines look like: - text: Eric  or  - text: Trip
    // followed by button "⚑" then paragraph with content
    if (line.startsWith("- text:") || line.startsWith("text:")) {
      const sender = line.replace(/^-?\s*text:\s*/, "").trim();
      if (["Eric", "Trip", "Q", "Sr", "Jr", "Cinco"].includes(sender)) {
        // Look ahead for paragraph content
        for (let j = i + 1; j < Math.min(i + 5, lines.length); j++) {
          const pLine = lines[j].trim();
          if (pLine.startsWith("- paragraph:") || pLine.startsWith("paragraph:")) {
            const text = pLine.replace(/^-?\s*paragraph:\s*/, "").replace(/^"|"$/g, "");
            messages.push({ sender, text: text.slice(0, 120) });
            break;
          }
        }
      }
    }
  }
  return messages;
}

test.describe("Snapshot/Act -- Scroll behavior", () => {
  test("Scrolling up reveals older messages (not the same ones)", async ({ page }) => {
    await page.goto("/");
    // Wait for messages to appear -- an agent would just wait until it sees content
    await page.waitForTimeout(5000);

    // SNAPSHOT: What messages can I see right now?
    const beforeSnapshot = await page.locator("body").ariaSnapshot();
    const beforeMessages = extractMessages(beforeSnapshot);

    // Skip if not enough messages to scroll
    if (beforeMessages.length < 2) {
      test.skip(true, "Too few messages to test scrolling");
      return;
    }

    // Remember the first message visible (should be near the bottom / most recent)
    const lastMessageBefore = beforeMessages[beforeMessages.length - 1].text;

    // ACT: Scroll up with mouse wheel (the way a user does)
    // Find the conversation area -- an agent would look for where the messages are
    const messageArea = page.getByText(beforeMessages[0].text).first();
    await messageArea.hover();
    for (let i = 0; i < 15; i++) {
      await page.mouse.wheel(0, -600);
    }
    await page.waitForTimeout(2000);

    // SNAPSHOT: What do I see now?
    const afterSnapshot = await page.locator("body").ariaSnapshot();
    const afterMessages = extractMessages(afterSnapshot);

    // ASSERT: After scrolling up, we should see different messages than before.
    // If the same last message is still the last visible, scroll had no effect
    // (snap-back or no content loaded).
    if (afterMessages.length > 0) {
      const lastMessageAfter = afterMessages[afterMessages.length - 1].text;
      // At minimum, the set of visible messages should have changed
      const beforeTexts = new Set(beforeMessages.map((m) => m.text));
      const afterTexts = new Set(afterMessages.map((m) => m.text));
      const overlap = [...afterTexts].filter((t) => beforeTexts.has(t)).length;
      const totalUnique = new Set([...beforeTexts, ...afterTexts]).size;

      // If every message after scroll is identical to before, scroll did nothing
      expect(
        totalUnique,
        `Scrolled up but see the same ${overlap} messages. Before: ${beforeMessages.length}, After: ${afterMessages.length}. Scroll may have snapped back.`
      ).toBeGreaterThan(beforeTexts.size);
    }
  });

  test("Scroll position holds after mouse wheel up (no snap-back)", async ({ page }) => {
    await page.goto("/");
    await page.waitForTimeout(5000);

    // SNAPSHOT: See what's on screen
    const initialSnapshot = await page.locator("body").ariaSnapshot();
    const initialMessages = extractMessages(initialSnapshot);
    if (initialMessages.length < 2) {
      test.skip(true, "Too few messages to test scroll stability");
      return;
    }

    // ACT: Scroll up
    const messageArea = page.getByText(initialMessages[0].text).first();
    await messageArea.hover();
    for (let i = 0; i < 5; i++) {
      await page.mouse.wheel(0, -400);
    }
    await page.waitForTimeout(500);

    // SNAPSHOT: What do I see right after scrolling?
    const rightAfterSnapshot = await page.locator("body").ariaSnapshot();
    const rightAfterMessages = extractMessages(rightAfterSnapshot);

    // Wait 3 seconds (snap-back happens after a delay)
    await page.waitForTimeout(3000);

    // SNAPSHOT: What do I see 3 seconds later?
    const laterSnapshot = await page.locator("body").ariaSnapshot();
    const laterMessages = extractMessages(laterSnapshot);

    // ASSERT: The messages visible right after scroll should be the same 3s later.
    // If they changed, something moved the scroll position (snap-back).
    if (rightAfterMessages.length > 0 && laterMessages.length > 0) {
      const afterFirst = rightAfterMessages[0].text;
      const laterFirst = laterMessages[0].text;
      expect(
        laterFirst,
        `Snap-back detected: right after scroll saw "${afterFirst.slice(0, 60)}...", but 3s later saw "${laterFirst.slice(0, 60)}..."`
      ).toBe(afterFirst);
    }
  });
});

test.describe("Snapshot/Act -- Page structure", () => {
  test("SA shows agent selector, messages, input box, and workbench tabs", async ({ page }) => {
    await page.goto("/");
    await page.waitForTimeout(3000);

    const snapshot = await page.locator("body").ariaSnapshot();

    // An agent should see these elements in SA:
    // 1. A heading identifying the app
    expect(snapshot).toContain('heading "Socratic Arena"');

    // 2. An agent selector (combobox with agent names)
    expect(snapshot).toMatch(/combobox[\s\S]*option "Q"/);

    // 3. Messages with sender names and content
    const messages = extractMessages(snapshot);
    expect(messages.length).toBeGreaterThan(0);

    // 4. An input area to type messages
    expect(snapshot).toContain('textbox "Type a message..."');

    // 5. Workbench tabs
    expect(snapshot).toContain("History");
    expect(snapshot).toContain("Notebook");
  });

  test("Clicking History tab shows history pane with session selector", async ({ page }) => {
    await page.goto("/");
    await page.waitForTimeout(3000);

    // ACT: Click the History tab (by its visible text)
    await page.getByText("History", { exact: true }).first().click();
    await page.waitForTimeout(2000);

    // SNAPSHOT: History pane should now be visible with a session selector
    const snapshot = await page.locator("body").ariaSnapshot();
    expect(snapshot).toMatch(/combobox "Select session"/);
    expect(snapshot).toContain('button "Search"');
  });
});
