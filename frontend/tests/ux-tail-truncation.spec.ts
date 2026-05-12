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

    // Install a WebSocket message interceptor to capture the state.snapshot
    await page.evaluate(() => {
      (window as any).__captured_snapshot_nodes = -1;
      const origWS = WebSocket.prototype.addEventListener;
      // Patch onmessage on any existing WebSocket
      const ws = (window as any).__SA_WS;
      if (ws && ws.onmessage) {
        const orig = ws.onmessage;
        ws.onmessage = (ev: MessageEvent) => {
          try {
            const msg = JSON.parse(ev.data);
            if (msg.type === "state.snapshot" && msg.payload?.tree?.nodes) {
              (window as any).__captured_snapshot_nodes =
                Object.keys(msg.payload.tree.nodes).length;
            }
          } catch {}
          orig.call(ws, ev);
        };
      }
    });

    // Switch to the agent — triggers _build_agent_state (100KB tail)
    await page.evaluate(async (agent: string) => {
      await fetch("/api/agent/switch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agent }),
      });
    }, target.name);

    // Wait for the state.snapshot to arrive
    await page.waitForTimeout(4000);

    // Get the full history from the API (50MB tail — ground truth)
    // Response shape: { tree: { nodes, activeNodeId, ... }, totalNodes }
    const history = await page.evaluate(async (agent: string) => {
      const resp = await fetch(
        `/api/agent/${agent}/history?tailMB=50`
      );
      const data = await resp.json();
      const nodes = data.tree?.nodes || {};
      return {
        nodeCount: Object.keys(nodes).length,
        activeId: data.tree?.activeNodeId || "",
        lastContent: (
          nodes[data.tree?.activeNodeId || ""]?.content || ""
        ).slice(0, 300),
      };
    }, target.name);

    // Also read DOM to report visible count
    const snapshot = await page.locator("body").ariaSnapshot();
    const visibleMessages = extractMessages(snapshot);

    // Try to read intercepted WS node count
    const wsNodeCount: number = await page.evaluate(
      () => (window as any).__captured_snapshot_nodes ?? -1
    );

    console.log(
      `[tail-truncation] agent=${target.name}\n` +
        `  ws_snapshot_nodes=${wsNodeCount}\n` +
        `  history_api_nodes=${history.nodeCount}\n` +
        `  visible_dom_messages=${visibleMessages.length}\n` +
        `  history_last="${history.lastContent.slice(0, 80)}..."`
    );

    // CORE ASSERTION: The node count sent by the server on switch should
    // match what the history API returns. If the switch sends drastically
    // fewer nodes, the user sees an incomplete conversation.
    //
    // We accept at least 50% of the history API's count to allow for
    // minor timing differences (live tailer may have added a few nodes).
    const switchNodeCount =
      wsNodeCount > 0 ? wsNodeCount : visibleMessages.length;
    const threshold = Math.floor(history.nodeCount * 0.5);

    expect(
      switchNodeCount,
      `After switching to ${target.name}: server sent ${switchNodeCount} nodes ` +
        `but history API has ${history.nodeCount} nodes (50MB tail). ` +
        `User is missing ${history.nodeCount - switchNodeCount} messages. ` +
        `Cause: _build_agent_state uses 100KB tail vs history API's 50MB.`
    ).toBeGreaterThanOrEqual(threshold);
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
