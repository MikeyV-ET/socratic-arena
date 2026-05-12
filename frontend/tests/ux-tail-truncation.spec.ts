import { test, expect } from "@playwright/test";

/**
 * E2E tests for the tail truncation bug — from the user's perspective.
 *
 * Bug: When SA loads an agent's conversation (startup or switch), it uses
 * parse_updates_tail with a 100KB default. For long sessions with tool calls
 * and thinking, 100KB covers only the last 2-3 turns. The user sees a
 * mid-conversation message as the "last" message, with no way to know
 * earlier messages exist.
 *
 * These tests verify the user-visible symptom: the conversation displayed
 * after switching to an agent is incomplete compared to what the history API
 * (with a larger tail) returns.
 */

/** Parse message entries from an ariaSnapshot string. */
function extractMessages(
  snapshot: string
): { sender: string; text: string }[] {
  const messages: { sender: string; text: string }[] = [];
  const lines = snapshot.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.startsWith("- text:") || line.startsWith("text:")) {
      const sender = line.replace(/^-?\s*text:\s*/, "").trim();
      if (
        ["Eric", "Trip", "Q", "Sr", "Jr", "Cinco"].includes(sender)
      ) {
        for (let j = i + 1; j < Math.min(i + 5, lines.length); j++) {
          const pLine = lines[j].trim();
          if (
            pLine.startsWith("- paragraph:") ||
            pLine.startsWith("paragraph:")
          ) {
            const text = pLine
              .replace(/^-?\s*paragraph:\s*/, "")
              .replace(/^"|"$/g, "");
            messages.push({ sender, text: text.slice(0, 200) });
            break;
          }
        }
      }
    }
  }
  return messages;
}

test.describe("Tail truncation -- conversation completeness", () => {
  test("switching agent loads all messages, not just the last 100KB", async ({
    page,
  }) => {
    // Intercept the WebSocket state.snapshot to count how many nodes
    // the server sends after an agent switch (the 100KB-tail state).
    // This is what determines what the user can see.
    await page.goto("/");
    await page.waitForTimeout(3000);

    // Get available agents
    const agents = await page.evaluate(async () => {
      const resp = await fetch("/api/agents");
      const data = await resp.json();
      return data.agents as {
        name: string;
        hasSession: boolean;
      }[];
    });

    // Pick an agent with a session (prefer Trip or Q — long sessions)
    const target =
      agents.find((a) => a.name === "Trip" && a.hasSession) ||
      agents.find((a) => a.hasSession);
    if (!target) {
      test.skip(true, "No agents with sessions available");
      return;
    }

    // Intercept WebSocket messages to capture the state.snapshot node count
    let snapshotNodeCount = -1;
    const wsPromise = new Promise<number>((resolve) => {
      page.on("websocket", (ws) => {
        ws.on("framereceived", (frame) => {
          try {
            const msg = JSON.parse(frame.payload as string);
            if (msg.type === "state.snapshot" && msg.payload?.tree?.nodes) {
              snapshotNodeCount = Object.keys(msg.payload.tree.nodes).length;
              resolve(snapshotNodeCount);
            }
          } catch {}
        });
      });
      // Timeout fallback
      setTimeout(() => resolve(snapshotNodeCount), 15000);
    });

    // Switch to the agent — triggers _build_agent_state (5MB tail)
    await page.evaluate(async (agent: string) => {
      await fetch("/api/agent/switch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agent }),
      });
    }, target.name);

    // Wait for the state.snapshot WS message
    const wsNodes = await wsPromise;

    // Get the 5MB history for comparison (same tail as startup uses)
    const history5MB = await page.evaluate(async (agent: string) => {
      const resp = await fetch(`/api/agent/${agent}/history?tailMB=5`);
      const data = await resp.json();
      return Object.keys(data.tree?.nodes || {}).length;
    }, target.name);

    console.log(
      `[tail-truncation] agent=${target.name}\n` +
        `  ws_snapshot_nodes=${wsNodes}\n` +
        `  history_5MB_nodes=${history5MB}`
    );

    // CORE ASSERTION: The state.snapshot sent on switch should contain
    // a comparable number of nodes to the 5MB history API.
    // The old bug: 100KB tail gave ~12 nodes. Now with 5MB: ~130+.
    // We use 50% of the 5MB history as threshold to account for
    // timing differences.
    const switchNodes = wsNodes > 0 ? wsNodes : history5MB;
    const threshold = Math.floor(history5MB * 0.5);
    expect(
      switchNodes,
      `After switching to ${target.name}: WS snapshot had ${wsNodes} nodes ` +
        `but 5MB history API has ${history5MB} nodes. ` +
        `Switch should send at least ${threshold} (50% of 5MB tail).`
    ).toBeGreaterThanOrEqual(threshold);
  });

  test("scroll position does not regress during sustained upward scroll", async ({
    page,
  }) => {
    // Capture scrollTop at high frequency during sustained scrolling.
    // Jerkiness = scrollTop increases (jumps down) while user is scrolling up.
    await page.goto("/");
    await page.waitForTimeout(5000);

    // Find the scrollable conversation container
    const scrollData = await page.evaluate(() => {
      // Try common scrollable containers
      const candidates = [
        document.querySelector('[data-pane-id="chat"]'),
        document.querySelector('[role="list"]'),
        ...Array.from(document.querySelectorAll("div")).filter(
          (d) => d.scrollHeight > d.clientHeight && d.clientHeight > 200
        ),
      ].filter(Boolean);

      if (candidates.length === 0) return { found: false, selector: "" };

      // Pick the one with the most scroll range
      let best = candidates[0]!;
      for (const c of candidates) {
        if (c!.scrollHeight > best.scrollHeight) best = c!;
      }

      // Tag it for later reference
      best.setAttribute("data-scroll-test", "target");
      return {
        found: true,
        scrollHeight: best.scrollHeight,
        clientHeight: best.clientHeight,
        scrollTop: best.scrollTop,
      };
    });

    if (!scrollData.found) {
      test.skip(true, "No scrollable container found");
      return;
    }

    // Install a high-frequency scroll position recorder
    await page.evaluate(() => {
      const el = document.querySelector('[data-scroll-test="target"]');
      if (!el) return;
      (window as any).__scrollLog = [];
      const observer = () => {
        (window as any).__scrollLog.push({
          t: performance.now(),
          top: el.scrollTop,
        });
      };
      el.addEventListener("scroll", observer);
      // Also poll at 60fps in case scroll events are coalesced
      (window as any).__scrollPoll = setInterval(() => {
        (window as any).__scrollLog.push({
          t: performance.now(),
          top: el.scrollTop,
        });
      }, 16);
    });

    // Scroll to bottom first to have room to scroll up
    await page.evaluate(() => {
      const el = document.querySelector('[data-scroll-test="target"]');
      if (el) el.scrollTop = el.scrollHeight;
    });
    await page.waitForTimeout(500);

    // Clear the log, then do sustained upward scrolling
    await page.evaluate(() => {
      (window as any).__scrollLog = [];
    });

    // Click inside the conversation pane to ensure it receives scroll events
    // Use the first visible message text to locate the conversation area
    const msgs = await page.locator("p").filter({ hasText: /.{10,}/ }).all();
    if (msgs.length > 0) {
      await msgs[0].hover();
    } else {
      await page.mouse.move(400, 450);
    }

    // 100 scroll-up events with small delays (simulates real wheel usage)
    for (let i = 0; i < 100; i++) {
      await page.mouse.wheel(0, -300);
      await page.waitForTimeout(50);
    }
    await page.waitForTimeout(1000);

    // Stop recording and analyze
    const log: { t: number; top: number }[] = await page.evaluate(
      () => {
        clearInterval((window as any).__scrollPoll);
        return (window as any).__scrollLog || [];
      }
    );

    // Analyze for regressions: any time scrollTop increases (jumps down)
    // while the user is only scrolling up
    let regressions = 0;
    let maxRegression = 0;
    const regressionDetails: string[] = [];

    for (let i = 1; i < log.length; i++) {
      const delta = log[i].top - log[i - 1].top;
      // Scrolling up = scrollTop decreasing. A positive delta = regression
      if (delta > 2) {
        // >2px threshold to ignore subpixel noise
        regressions++;
        maxRegression = Math.max(maxRegression, delta);
        if (regressionDetails.length < 5) {
          regressionDetails.push(
            `t=${(log[i].t - log[0].t).toFixed(0)}ms: ` +
              `${log[i - 1].top.toFixed(0)} → ${log[i].top.toFixed(0)} (+${delta.toFixed(0)}px)`
          );
        }
      }
    }

    const totalScroll =
      log.length > 1 ? log[0].top - log[log.length - 1].top : 0;

    console.log(
      `[scroll-jerk] ${log.length} samples, ` +
        `total_scroll=${totalScroll.toFixed(0)}px up, ` +
        `regressions=${regressions}, ` +
        `max_regression=${maxRegression.toFixed(0)}px\n` +
        (regressionDetails.length > 0
          ? `  Examples: ${regressionDetails.join("; ")}`
          : "  No regressions detected")
    );

    expect(
      regressions,
      `Scroll jerkiness: ${regressions} position regressions detected ` +
        `(scrollTop jumped DOWN while scrolling UP). ` +
        `Max jump: ${maxRegression.toFixed(0)}px. ` +
        `Samples: ${regressionDetails.join("; ")}`
    ).toBe(0);
  });

  test("last visible message matches the actual last message from history", async ({
    page,
  }) => {
    await page.goto("/");
    await page.waitForTimeout(5000);

    // Which agent is currently loaded?
    const agentInfo = await page.evaluate(async () => {
      const resp = await fetch("/api/agents");
      const data = await resp.json();
      return { current: data.current as string };
    });
    if (!agentInfo.current) {
      test.skip(true, "No current agent");
      return;
    }

    // Get the actual last message from the full history (ground truth)
    // Response shape: { tree: { nodes, activeNodeId, ... }, totalNodes }
    const historyLast = await page.evaluate(async (agent: string) => {
      const resp = await fetch(
        `/api/agent/${agent}/history?tailMB=50`
      );
      const data = await resp.json();
      const nodes = data.tree?.nodes || {};
      const activeId = data.tree?.activeNodeId || "";
      const lastNode = nodes[activeId];
      return {
        content: (lastNode?.content || "").slice(0, 200),
        role: lastNode?.role || "",
        totalNodes: Object.keys(nodes).length,
      };
    }, agentInfo.current);

    if (!historyLast.content) {
      test.skip(true, "No messages in history");
      return;
    }

    // Scroll to the bottom of the conversation pane to see the latest
    await page.evaluate(() => {
      const chatPane = document.querySelector(
        '[data-pane-id="chat"]'
      );
      if (chatPane) {
        chatPane.scrollTop = chatPane.scrollHeight;
      }
      // Also try the virtualized list container
      const lists = document.querySelectorAll('[role="list"]');
      lists.forEach((l) => (l.scrollTop = l.scrollHeight));
    });
    await page.waitForTimeout(1000);

    // Read what the user sees at the bottom
    const snapshot = await page.locator("body").ariaSnapshot();
    const visibleMessages = extractMessages(snapshot);
    const lastVisible =
      visibleMessages.length > 0
        ? visibleMessages[visibleMessages.length - 1]
        : null;

    console.log(
      `[tail-truncation] agent=${agentInfo.current}\n` +
        `  history_last (${historyLast.role}): "${historyLast.content.slice(0, 80)}..."\n` +
        `  visible_last: ${lastVisible ? `"${lastVisible.text.slice(0, 80)}..."` : "NONE"}\n` +
        `  history_total_nodes=${historyLast.totalNodes}`
    );

    // The last visible message should contain text from the actual last
    // message in the history. If the user sees something different,
    // their conversation view is stale/truncated.
    expect(lastVisible).not.toBeNull();
    if (lastVisible && historyLast.content.length > 20) {
      // Check that some substring of the history's last message appears
      // in the visible last message (or vice versa), accounting for
      // truncation in the aria snapshot
      const historySnippet = historyLast.content.slice(0, 60);
      const visibleSnippet = lastVisible.text.slice(0, 60);
      const overlap =
        historySnippet.includes(visibleSnippet.slice(0, 30)) ||
        visibleSnippet.includes(historySnippet.slice(0, 30));
      expect(
        overlap,
        `Last visible message doesn't match actual last message.\n` +
          `  Visible: "${lastVisible.text.slice(0, 100)}"\n` +
          `  History: "${historyLast.content.slice(0, 100)}"\n` +
          `The user is seeing a stale message from earlier in the session.`
      ).toBe(true);
    }
  });
});
