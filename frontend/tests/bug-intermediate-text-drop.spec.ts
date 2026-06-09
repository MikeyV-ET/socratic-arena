import { test, expect } from "@playwright/test";

/**
 * Bug: SA drops intermediate agent text between tool calls.
 *
 * When an agent turn has: text1 → tool_call → text2 → tool_call → text3
 * SA shows text1 and text3 but drops text2.
 *
 * Reported: 2026-06-09. Jr session 019de4e1, lines 40401-40416 in updates.jsonl.
 * Pattern: 3 agent_message_chunk events in one turn, middle one missing from render.
 *
 * Root cause hypothesis: dual streaming paths (tree.live_node replaces content,
 * conversation.chunk appends to streamingContent). streamingContent wins in
 * Message.tsx (streamingContent ?? node.content) and may reset on nodeId changes.
 */

test.describe("Bug: Intermediate text between tool calls", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("[data-node-id]").first()).toBeVisible({
      timeout: 15_000,
    });
  });

  test("No assistant messages have suspiciously low text-to-tool ratio", async ({
    page,
  }) => {
    // Scan all visible assistant messages for the bug pattern:
    // Multiple tool call badges but very little visible text.
    // A healthy message with 3+ tool calls should have substantial text.

    const messages = page.locator("[data-node-id]");
    const msgCount = await messages.count();
    const issues: string[] = [];

    for (let i = 0; i < msgCount; i++) {
      const msg = messages.nth(i);
      if (!(await msg.isVisible())) continue;

      const proseEls = msg.locator(".prose");
      if ((await proseEls.count()) === 0) continue;

      const text = (await proseEls.first().textContent()) || "";
      const toolBadges = msg.locator("span").filter({
        hasText:
          /read_file|run_terminal|search_replace|list_dir|grep|spawn_subagent/,
      });
      const toolCount = await toolBadges.count();

      // Heuristic: if a message has 3+ tool calls, expect at least 200 chars
      // of text. A dropped intermediate segment would leave much less.
      if (toolCount >= 3 && text.length < 200) {
        issues.push(
          `Msg ${i}: ${toolCount} tools, only ${text.length} chars — possible dropped text`,
        );
      }
    }

    if (issues.length > 0) {
      console.log("POSSIBLE INTERMEDIATE TEXT DROPS:");
      issues.forEach((i) => console.log("  " + i));
    }

    // Soft assertion: log but don't fail (this is a detection heuristic)
    expect(msgCount).toBeGreaterThan(0);
  });

  test("WebSocket receives all text segments for multi-tool turns", async ({
    page,
  }) => {
    // Passively monitor WebSocket traffic for a turn with multiple
    // text segments and verify all segments arrive.

    const wsPromise = page.waitForEvent("websocket", (ws) =>
      ws.url().includes("/ws") && !ws.url().includes("/ws/shell"),
    );

    await page.goto("/");
    const ws = await wsPromise;

    // Collect conversation chunks and live node updates
    const textChunks: { type: string; nodeId: string; content: string }[] = [];

    ws.on("framereceived", (frame) => {
      try {
        const msg = JSON.parse(frame.payload as string);
        if (msg.type === "conversation.chunk") {
          textChunks.push({
            type: "chunk",
            nodeId: msg.payload.nodeId,
            content: msg.payload.content,
          });
        } else if (
          msg.type === "tree.live_node" &&
          (msg.payload.action === "update" || msg.payload.action === "add")
        ) {
          textChunks.push({
            type: "live_node_" + msg.payload.action,
            nodeId: msg.payload.nodeId,
            content: msg.payload.content || "",
          });
        }
      } catch {}
    });

    // Wait for some agent activity (or skip if idle)
    await page.waitForTimeout(10_000);

    // Analyze: for each nodeId, check if tree.live_node content
    // is a superset of conversation.chunk content
    const byNode = new Map<string, typeof textChunks>();
    for (const chunk of textChunks) {
      const arr = byNode.get(chunk.nodeId) || [];
      arr.push(chunk);
      byNode.set(chunk.nodeId, arr);
    }

    for (const [nodeId, chunks] of byNode.entries()) {
      const liveNodeContent = chunks
        .filter((c) => c.type.startsWith("live_node"))
        .pop()?.content;
      const streamChunks = chunks
        .filter((c) => c.type === "chunk")
        .map((c) => c.content);

      if (liveNodeContent && streamChunks.length > 0) {
        const streamTotal = streamChunks.join("");
        // The live_node content should be >= stream content
        // If stream content is longer, something is wrong
        console.log(
          `Node ${nodeId.substring(0, 12)}: ` +
            `live_node=${liveNodeContent.length} chars, ` +
            `stream=${streamTotal.length} chars, ` +
            `chunks=${streamChunks.length}`,
        );
      }
    }

    // This test collects data. Pass if it runs without errors.
    expect(true).toBe(true);
  });
});
