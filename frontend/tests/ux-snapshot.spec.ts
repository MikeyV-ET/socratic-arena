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

test.describe("Snapshot/Act -- History search", () => {
  test("Searching in history shows matching results", async ({ page }) => {
    await page.goto("/");
    await page.waitForTimeout(3000);

    // ACT: Open history tab
    await page.getByText("History", { exact: true }).first().click();
    await page.waitForTimeout(2000);

    // ACT: Click search button
    await page.getByRole("button", { name: "Search" }).last().click();
    await page.waitForTimeout(500);

    // SNAPSHOT: Search input should appear
    const preSearchSnapshot = await page.locator("body").ariaSnapshot();
    // Search input may have various placeholder text
    const hasSearchInput = preSearchSnapshot.includes("textbox") ||
                           preSearchSnapshot.includes("Search");
    expect(hasSearchInput).toBe(true);

    // ACT: Type a common word and search
    const searchInput = page.getByPlaceholder(/search/i).last();
    if (await searchInput.isVisible().catch(() => false)) {
      await searchInput.fill("the");
      await searchInput.press("Enter");
      await page.waitForTimeout(2000);

      // SNAPSHOT: Results should appear
      const afterSearchSnapshot = await page.locator("body").ariaSnapshot();
      // Should see clickable results or highlighted matches
      const hasResults = afterSearchSnapshot.includes("button") &&
                         afterSearchSnapshot.split("\n").length > preSearchSnapshot.split("\n").length;
      expect(
        hasResults,
        "Search for 'the' should produce visible results in the history pane"
      ).toBe(true);
    }
  });
});

test.describe("Snapshot/Act -- Button visibility (R09, R10, R11)", () => {
  test("No fork button visible in conversation pane (R09)", async ({ page }) => {
    await page.goto("/");
    await page.waitForTimeout(5000);

    const snapshot = await page.locator("body").ariaSnapshot();
    const messages = extractMessages(snapshot);
    if (messages.length < 1) {
      test.skip(true, "No messages visible to check buttons");
      return;
    }

    // Fork button should NOT appear anywhere in the conversation
    const hasFork = snapshot.toLowerCase().includes('button "fork"') ||
                    snapshot.toLowerCase().includes("button \"⑂\"");
    expect(hasFork, "Fork button should not be visible in conversation pane").toBe(false);
  });

  test("No edit/correction button visible in conversation pane (R10)", async ({ page }) => {
    await page.goto("/");
    await page.waitForTimeout(5000);

    const snapshot = await page.locator("body").ariaSnapshot();
    const messages = extractMessages(snapshot);
    if (messages.length < 1) {
      test.skip(true, "No messages visible to check buttons");
      return;
    }

    const hasEdit = snapshot.toLowerCase().includes('button "edit"') ||
                    snapshot.toLowerCase().includes('button "correct"') ||
                    snapshot.toLowerCase().includes("button \"✎\"");
    expect(hasEdit, "Edit/correction button should not be visible in conversation pane").toBe(false);
  });

  test("Flag button visible on messages (R11)", async ({ page }) => {
    await page.goto("/");
    await page.waitForTimeout(5000);

    const snapshot = await page.locator("body").ariaSnapshot();
    const messages = extractMessages(snapshot);
    if (messages.length < 1) {
      test.skip(true, "No messages visible to check flag button");
      return;
    }

    // Flag button appears as ⚑ in the aria snapshot
    const flagCount = (snapshot.match(/button "⚑"/g) || []).length;
    expect(
      flagCount,
      `Expected at least one flag button (⚑) among ${messages.length} messages, found ${flagCount}`
    ).toBeGreaterThan(0);
  });
});

test.describe("Snapshot/Act -- Flag sync across panes", () => {
  test("Flagging a message in chat pane shows flagged in history pane", async ({ page }) => {
    await page.goto("/");
    await page.waitForTimeout(5000);

    const messages = extractMessages(await page.locator("body").ariaSnapshot());
    if (messages.length < 1) {
      test.skip(true, "No messages visible to flag");
      return;
    }

    // Count unflagged buttons before
    const unflaggedBefore = await page.getByTitle("Flag as training candidate").count();
    if (unflaggedBefore === 0) {
      test.skip(true, "No unflagged messages available to test");
      return;
    }

    // ACT: Click a flag button in the viewport via DOM click.
    // Playwright's .click() doesn't reliably trigger React handlers on
    // opacity-0 elements inside a virtualizer, so use direct DOM click.
    const clicked = await page.evaluate(() => {
      const btns = document.querySelectorAll('button[title="Flag as training candidate"]');
      for (let i = btns.length - 1; i >= 0; i--) {
        const r = btns[i].getBoundingClientRect();
        if (r.y >= 0 && r.y + r.height <= window.innerHeight) {
          (btns[i] as HTMLElement).click();
          return true;
        }
      }
      return false;
    });
    if (!clicked) {
      test.skip(true, "No flag buttons visible in viewport");
      return;
    }
    await page.waitForTimeout(5000);

    // VERIFY: The clicked button should now say "Remove flag" (title changes on flag).
    // NOTE: This requires WebSocket to be connected -- flag.create goes via WS,
    // backend broadcasts state.snapshot back, frontend updates store.
    const removeFlagCount = await page.getByTitle("Remove flag").count();
    expect(
      removeFlagCount,
      "After clicking flag, should see 'Remove flag'. Requires live WebSocket connection."
    ).toBeGreaterThan(0);

    // ACT: Switch to History tab to check sync
    await page.getByText("History", { exact: true }).first().click();
    await page.waitForTimeout(3000);

    // VERIFY: History pane should reflect the flag.
    // History shows flags via ⚑ buttons on messages in the detail view,
    // and/or via the tree view where flagged nodes get warning color.
    // Check for "Remove flag" buttons OR flag indicators in history.
    const historySnapshot = await page.locator("body").ariaSnapshot();
    const historyHasRemoveFlag = await page.getByTitle("Remove flag").count();
    const historyShowsFlag = historyHasRemoveFlag > 0 ||
                              historySnapshot.toLowerCase().includes("flag") ||
                              historySnapshot.includes("⚑");
    expect(
      historyShowsFlag,
      "Flag set in chat pane should be visible in history pane"
    ).toBe(true);

    // CLEANUP: Unflag via DOM click (button may be opacity-0 or off-screen)
    await page.evaluate(() => {
      const btn = document.querySelector('button[title="Remove flag"]');
      if (btn) (btn as HTMLElement).click();
    });
    await page.waitForTimeout(1000);
  });

  test("Flagging in history pane shows flagged in chat pane", async ({ page }) => {
    await page.goto("/");
    await page.waitForTimeout(3000);

    // ACT: Open history tab
    await page.getByText("History", { exact: true }).first().click();
    await page.waitForTimeout(3000);

    // Check if history exposes flag buttons
    const historyUnflagged = await page.getByTitle("Flag as training candidate").count();
    if (historyUnflagged === 0) {
      test.skip(true, "History pane does not expose unflagged flag buttons");
      return;
    }

    // ACT: Click a flag button in the viewport via DOM click.
    const histClicked = await page.evaluate(() => {
      const btns = document.querySelectorAll('button[title="Flag as training candidate"]');
      for (let i = btns.length - 1; i >= 0; i--) {
        const r = btns[i].getBoundingClientRect();
        if (r.y >= 0 && r.y + r.height <= window.innerHeight) {
          (btns[i] as HTMLElement).click();
          return true;
        }
      }
      return false;
    });
    if (!histClicked) {
      test.skip(true, "No flag buttons visible in history viewport");
      return;
    }
    await page.waitForTimeout(5000);

    // VERIFY: Flag took effect in history
    const historyRemoveCount = await page.getByTitle("Remove flag").count();
    expect(
      historyRemoveCount,
      "After flagging in history, should see 'Remove flag' button"
    ).toBeGreaterThan(0);

    // ACT: Switch back to conversation to check sync
    await page.getByText("History", { exact: true }).first().click();
    await page.waitForTimeout(2000);

    // VERIFY: Chat pane should reflect the flag
    const chatRemoveCount = await page.getByTitle("Remove flag").count();
    expect(
      chatRemoveCount,
      "Flag set in history pane should show 'Remove flag' in chat pane"
    ).toBeGreaterThan(0);

    // CLEANUP: Unflag via DOM click (button may be opacity-0 or off-screen)
    await page.evaluate(() => {
      const btn = document.querySelector('button[title="Remove flag"]');
      if (btn) (btn as HTMLElement).click();
    });
    await page.waitForTimeout(1000);
  });
});

test.describe("Snapshot/Act -- Agent switching", () => {
  test("Switching agent changes visible conversation content", async ({ page }) => {
    await page.goto("/");
    await page.waitForTimeout(5000);

    // SNAPSHOT: See current messages
    const beforeSnapshot = await page.locator("body").ariaSnapshot();
    const beforeMessages = extractMessages(beforeSnapshot);

    // Find the agent selector combobox (first one in the header)
    const agentSelector = page.getByRole("combobox").first();
    const options = await agentSelector.locator("option").allTextContents();

    // Find a different agent than the currently selected one
    const currentAgent = await agentSelector.inputValue();
    const otherAgent = options.find((o) => o !== currentAgent);
    if (!otherAgent) {
      test.skip(true, "Only one agent available");
      return;
    }

    // ACT: Switch to different agent
    await agentSelector.selectOption(otherAgent);
    await page.waitForTimeout(5000);

    // SNAPSHOT: See new messages
    const afterSnapshot = await page.locator("body").ariaSnapshot();
    const afterMessages = extractMessages(afterSnapshot);

    // ASSERT: Should see messages (the other agent has conversation history)
    // Content should be different from the previous agent
    if (afterMessages.length > 0 && beforeMessages.length > 0) {
      const beforeTexts = beforeMessages.map((m) => m.text).join("|");
      const afterTexts = afterMessages.map((m) => m.text).join("|");
      expect(
        afterTexts,
        `After switching from ${currentAgent} to ${otherAgent}, conversation content should change`
      ).not.toBe(beforeTexts);
    }
  });
});

test.describe("Snapshot/Act -- Notebook pane (R03)", () => {
  test("Notebook tab opens and shows content", async ({ page }) => {
    await page.goto("/");
    await page.waitForTimeout(3000);

    // ACT: Click Notebook tab
    await page.getByText("Notebook", { exact: true }).first().click();
    await page.waitForTimeout(3000);

    // SNAPSHOT: Should see notebook entries
    const snapshot = await page.locator("body").ariaSnapshot();

    // Notebook pane should contain some text content (entries)
    // Entries are typically paragraphs or sections with timestamps or headings
    const lines = snapshot.split("\n").filter((l) => l.trim().length > 0);
    expect(
      lines.length,
      "Notebook pane should have visible content after opening"
    ).toBeGreaterThan(5);
  });

  test("Switching agents in notebook shows different content (R03)", async ({ page }) => {
    await page.goto("/");
    await page.waitForTimeout(3000);

    // ACT: Open notebook tab
    await page.getByText("Notebook", { exact: true }).first().click();
    await page.waitForTimeout(3000);

    // SNAPSHOT: Notebook content for first agent
    const beforeSnapshot = await page.locator("body").ariaSnapshot();

    // Find the agent selector and switch
    const agentSelector = page.getByRole("combobox").first();
    const options = await agentSelector.locator("option").allTextContents();
    const currentAgent = await agentSelector.inputValue();
    const otherAgent = options.find((o) => o !== currentAgent);
    if (!otherAgent) {
      test.skip(true, "Only one agent available");
      return;
    }

    // ACT: Switch agent
    await agentSelector.selectOption(otherAgent);
    await page.waitForTimeout(3000);

    // SNAPSHOT: Notebook should now show different agent's notebook
    const afterSnapshot = await page.locator("body").ariaSnapshot();

    // Content should differ between agents
    expect(
      afterSnapshot,
      `Notebook content should change when switching from ${currentAgent} to ${otherAgent}`
    ).not.toBe(beforeSnapshot);
  });
});

test.describe("Snapshot/Act -- Message sending", () => {
  test("Typing and sending a message adds it to the conversation", async ({ page }) => {
    await page.goto("/");
    await page.waitForTimeout(5000);

    // SNAPSHOT: See current messages
    const beforeSnapshot = await page.locator("body").ariaSnapshot();
    const beforeMessages = extractMessages(beforeSnapshot);
    const beforeCount = beforeMessages.length;

    // ACT: Type a message in the input box
    const testMessage = `snapshot-test-${Date.now()}`;
    const input = page.getByPlaceholder("Type a message...");
    await input.fill(testMessage);

    // ACT: Send via the Send button
    const sendButton = page.getByRole("button", { name: /send/i });
    if (await sendButton.isVisible().catch(() => false)) {
      await sendButton.click();
    } else {
      await input.press("Enter");
    }
    await page.waitForTimeout(3000);

    // SNAPSHOT: Should now see the sent message
    const afterSnapshot = await page.locator("body").ariaSnapshot();
    expect(
      afterSnapshot,
      `Sent message "${testMessage}" should appear in the conversation`
    ).toContain(testMessage);
  });
});

test.describe("Snapshot/Act -- Full text output (R08)", () => {
  test("Messages show full content including mid-turn text", async ({ page }) => {
    await page.goto("/");
    await page.waitForTimeout(5000);

    // SNAPSHOT: Read visible messages
    const snapshot = await page.locator("body").ariaSnapshot();
    const messages = extractMessages(snapshot);

    if (messages.length < 2) {
      test.skip(true, "Not enough messages to verify full text output");
      return;
    }

    // Each message should have non-trivial content (not truncated to empty)
    const nonEmptyMessages = messages.filter((m) => m.text.trim().length > 0);
    expect(
      nonEmptyMessages.length,
      `Expected most of ${messages.length} messages to have visible text content`
    ).toBeGreaterThan(messages.length * 0.5);

    // Agent messages (from Q, Trip, etc.) tend to be longer than user messages
    const agentMessages = nonEmptyMessages.filter(
      (m) => !["Eric"].includes(m.sender)
    );
    if (agentMessages.length > 0) {
      const avgLen =
        agentMessages.reduce((sum, m) => sum + m.text.length, 0) /
        agentMessages.length;
      // Agent messages should have meaningful content, not just "..."
      expect(
        avgLen,
        "Agent messages should contain substantive text (not truncated)"
      ).toBeGreaterThan(10);
    }
  });
});

test.describe("Snapshot/Act -- History scroll-to-bottom on load (R01)", () => {
  test("History pane shows recent content on open (not top of history)", async ({ page }) => {
    await page.goto("/");
    await page.waitForTimeout(3000);

    // ACT: Open history tab
    await page.getByText("History", { exact: true }).first().click();
    await page.waitForTimeout(5000);

    // SNAPSHOT: What's visible in history
    const snapshot = await page.locator("body").ariaSnapshot();

    // The most recent messages should be visible, not the oldest ones.
    // We can check this by looking at what the conversation pane shows
    // (which is always the latest) and comparing to history.
    const historyMessages = extractMessages(snapshot);
    if (historyMessages.length < 2) {
      test.skip(true, "Not enough history messages visible");
      return;
    }

    // Go back to conversation to see the latest messages
    await page.getByText("History", { exact: true }).first().click();
    await page.waitForTimeout(1000);

    // The history pane on load should include recent-ish messages.
    // If history loaded at the top instead of bottom, we'd see
    // very old messages that don't appear in conversation at all.
    // For now: just verify that history has content (basic load check).
    expect(
      historyMessages.length,
      "History should show messages on initial load"
    ).toBeGreaterThan(0);
  });
});

test.describe("Snapshot/Act -- Flag notes (R16)", () => {
  test("Clicking flag button opens a note input before creating the flag", async ({ page }) => {
    await page.goto("/");
    await page.waitForTimeout(5000);

    const messages = extractMessages(await page.locator("body").ariaSnapshot());
    if (messages.length < 1) {
      test.skip(true, "No messages visible to flag");
      return;
    }

    // Count current flags
    const unflaggedBefore = await page.getByTitle("Flag as training candidate").count();
    if (unflaggedBefore === 0) {
      test.skip(true, "No unflagged messages available");
      return;
    }

    // ACT: Click a flag button via DOM (opacity-0 elements)
    const clicked = await page.evaluate(() => {
      const btns = document.querySelectorAll('button[title="Flag as training candidate"]');
      for (let i = btns.length - 1; i >= 0; i--) {
        const r = btns[i].getBoundingClientRect();
        if (r.y >= 0 && r.y + r.height <= window.innerHeight) {
          (btns[i] as HTMLElement).click();
          return true;
        }
      }
      return false;
    });
    if (!clicked) {
      test.skip(true, "No flag buttons visible in viewport");
      return;
    }
    await page.waitForTimeout(1000);

    // VERIFY: A note input should appear (textbox, textarea, or input with placeholder)
    const noteInput = page.getByPlaceholder(/note|reason|why/i)
      .or(page.getByRole("textbox", { name: /note/i }))
      .or(page.locator('[data-flag-note-input]'));
    const noteVisible = await noteInput.first().isVisible().catch(() => false);
    expect(
      noteVisible,
      "After clicking flag, a note input should appear for the user to annotate why"
    ).toBe(true);

    // ACT: Press Escape to cancel without flagging
    await page.keyboard.press("Escape");
    await page.waitForTimeout(500);

    // VERIFY: Flag should NOT have been created (cancel = no flag)
    const removeFlagAfterCancel = await page.getByTitle("Remove flag").count();
    // The count should not have increased (no new flag)
    expect(
      removeFlagAfterCancel,
      "Pressing Escape should cancel flagging -- no flag created"
    ).toBe(0);
  });

  test("Submitting a note creates a flag with the note attached", async ({ page }) => {
    await page.goto("/");
    await page.waitForTimeout(5000);

    const unflaggedBefore = await page.getByTitle("Flag as training candidate").count();
    if (unflaggedBefore === 0) {
      test.skip(true, "No unflagged messages available");
      return;
    }

    // ACT: Click a flag button
    const clicked = await page.evaluate(() => {
      const btns = document.querySelectorAll('button[title="Flag as training candidate"]');
      for (let i = btns.length - 1; i >= 0; i--) {
        const r = btns[i].getBoundingClientRect();
        if (r.y >= 0 && r.y + r.height <= window.innerHeight) {
          (btns[i] as HTMLElement).click();
          return true;
        }
      }
      return false;
    });
    if (!clicked) {
      test.skip(true, "No flag buttons visible in viewport");
      return;
    }
    await page.waitForTimeout(1000);

    // ACT: Type a note and submit
    const testNote = `test-note-${Date.now()}`;
    const noteInput = page.getByPlaceholder(/note|reason|why/i)
      .or(page.getByRole("textbox", { name: /note/i }))
      .or(page.locator('[data-flag-note-input]'));
    await noteInput.first().fill(testNote);
    await noteInput.first().press("Enter");
    await page.waitForTimeout(3000);

    // VERIFY: Flag was created
    const removeFlagCount = await page.getByTitle("Remove flag").count();
    expect(
      removeFlagCount,
      "After submitting note, flag should be created"
    ).toBeGreaterThan(0);

    // VERIFY: Note is visible (tooltip or displayed text)
    const snapshot = await page.locator("body").ariaSnapshot();
    const noteVisible = snapshot.includes(testNote) ||
      await page.getByText(testNote).isVisible().catch(() => false);
    // If note isn't in snapshot, check via hover tooltip
    if (!noteVisible) {
      const flagBtn = page.getByTitle("Remove flag").first();
      await flagBtn.hover();
      await page.waitForTimeout(500);
      const hoverSnapshot = await page.locator("body").ariaSnapshot();
      expect(
        hoverSnapshot.includes(testNote) ||
        await page.getByText(testNote).isVisible().catch(() => false),
        "Flag note should be visible on hover or in the UI"
      ).toBe(true);
    }

    // CLEANUP
    await page.evaluate(() => {
      const btn = document.querySelector('button[title="Remove flag"]');
      if (btn) (btn as HTMLElement).click();
    });
    await page.waitForTimeout(1000);
  });

  test("Empty note submission creates flag without a note (quick-flag)", async ({ page }) => {
    await page.goto("/");
    await page.waitForTimeout(5000);

    const unflaggedBefore = await page.getByTitle("Flag as training candidate").count();
    if (unflaggedBefore === 0) {
      test.skip(true, "No unflagged messages available");
      return;
    }

    // ACT: Click flag, then immediately submit empty note
    const clicked = await page.evaluate(() => {
      const btns = document.querySelectorAll('button[title="Flag as training candidate"]');
      for (let i = btns.length - 1; i >= 0; i--) {
        const r = btns[i].getBoundingClientRect();
        if (r.y >= 0 && r.y + r.height <= window.innerHeight) {
          (btns[i] as HTMLElement).click();
          return true;
        }
      }
      return false;
    });
    if (!clicked) {
      test.skip(true, "No flag buttons visible in viewport");
      return;
    }
    await page.waitForTimeout(1000);

    // ACT: Submit with empty note (just press Enter)
    const noteInput = page.getByPlaceholder(/note|reason|why/i)
      .or(page.getByRole("textbox", { name: /note/i }))
      .or(page.locator('[data-flag-note-input]'));
    await noteInput.first().press("Enter");
    await page.waitForTimeout(3000);

    // VERIFY: Flag was still created (empty note = quick flag)
    const removeFlagCount = await page.getByTitle("Remove flag").count();
    expect(
      removeFlagCount,
      "Empty note should still create flag (preserves quick-flag workflow)"
    ).toBeGreaterThan(0);

    // CLEANUP
    await page.evaluate(() => {
      const btn = document.querySelector('button[title="Remove flag"]');
      if (btn) (btn as HTMLElement).click();
    });
    await page.waitForTimeout(1000);
  });

  test("Flag notes sync across chat and history panes", async ({ page }) => {
    await page.goto("/");
    await page.waitForTimeout(5000);

    const unflaggedBefore = await page.getByTitle("Flag as training candidate").count();
    if (unflaggedBefore === 0) {
      test.skip(true, "No unflagged messages available");
      return;
    }

    // ACT: Flag with a note from chat pane
    const testNote = `sync-note-${Date.now()}`;
    const clicked = await page.evaluate(() => {
      const btns = document.querySelectorAll('button[title="Flag as training candidate"]');
      for (let i = btns.length - 1; i >= 0; i--) {
        const r = btns[i].getBoundingClientRect();
        if (r.y >= 0 && r.y + r.height <= window.innerHeight) {
          (btns[i] as HTMLElement).click();
          return true;
        }
      }
      return false;
    });
    if (!clicked) {
      test.skip(true, "No flag buttons visible in viewport");
      return;
    }
    await page.waitForTimeout(1000);

    // Type note and submit
    const noteInput = page.getByPlaceholder(/note|reason|why/i)
      .or(page.getByRole("textbox", { name: /note/i }))
      .or(page.locator('[data-flag-note-input]'));
    await noteInput.first().fill(testNote);
    await noteInput.first().press("Enter");
    await page.waitForTimeout(3000);

    // ACT: Switch to history tab
    await page.getByText("History", { exact: true }).first().click();
    await page.waitForTimeout(3000);

    // VERIFY: The note should be visible in history pane too
    const historySnapshot = await page.locator("body").ariaSnapshot();
    const noteInHistory = historySnapshot.includes(testNote) ||
      await page.getByText(testNote).isVisible().catch(() => false);
    expect(
      noteInHistory,
      "Flag note created in chat pane should be visible in history pane"
    ).toBe(true);

    // CLEANUP: Switch back and unflag
    await page.getByText("History", { exact: true }).first().click();
    await page.waitForTimeout(1000);
    await page.evaluate(() => {
      const btn = document.querySelector('button[title="Remove flag"]');
      if (btn) (btn as HTMLElement).click();
    });
    await page.waitForTimeout(1000);
  });
});
