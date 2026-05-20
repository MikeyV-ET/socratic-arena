# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: frontend/tests/ux-base-functionality.spec.ts >> workbench tabs can be reordered by dragging
- Location: frontend/tests/ux-base-functionality.spec.ts:282:1

# Error details

```
Error: page.goto: Protocol error (Page.navigate): Cannot navigate to invalid URL
Call log:
  - navigating to "/", waiting until "load"

```

# Test source

```ts
  183 |     await page.waitForTimeout(100);
  184 |   }
  185 |   // Wait for any lazy loading to complete
  186 |   await page.waitForTimeout(1500);
  187 | 
  188 |   const afterScrollUpIds = await getVisibleMessageIds();
  189 | 
  190 |   // After scrolling up, we should see at least some different messages
  191 |   // (unless the conversation is very short)
  192 |   const apiMessages = await getHistoryMessages(AGENT);
  193 |   if (apiMessages.length > 20) {
  194 |     const newMessages = afterScrollUpIds.filter((id) => !originalIds.includes(id));
  195 |     expect(
  196 |       newMessages.length,
  197 |       "Scrolling up didn't reveal any new messages"
  198 |     ).toBeGreaterThan(0);
  199 |   }
  200 | 
  201 |   // Now scroll back down to the bottom
  202 |   // Try jump-to-latest button first (look broadly — it might be anywhere in the pane)
  203 |   const jumpButton = page.locator("button", { hasText: /latest|↓|⬇/i }).first();
  204 |   if (await jumpButton.count() > 0 && await jumpButton.isVisible()) {
  205 |     await jumpButton.click();
  206 |     await page.waitForTimeout(1500);
  207 |   } else {
  208 |     // Scroll to absolute bottom
  209 |     await container.evaluate((el) => el.scrollTo(0, el.scrollHeight));
  210 |     await page.waitForTimeout(1000);
  211 |     await container.evaluate((el) => el.scrollTo(0, el.scrollHeight));
  212 |     await page.waitForTimeout(1000);
  213 |   }
  214 | 
  215 |   // The bottom message should be reachable — either visible or we can get back to it
  216 |   const afterScrollBackIds = await getVisibleMessageIds();
  217 |   expect(
  218 |     afterScrollBackIds,
  219 |     "After scrolling back down, the original bottom message is gone"
  220 |   ).toContain(bottomMsgId);
  221 | });
  222 | 
  223 | // ============================================================================
  224 | // Test 5: Scrolling down from mid-history does NOT jump to latest
  225 | // ============================================================================
  226 | 
  227 | test("scrolling down from mid-history advances gradually, not jumps to latest", async ({ page }) => {
  228 |   const apiMessages = await getHistoryMessages(AGENT);
  229 |   test.skip(apiMessages.length <= 30, "Need >30 messages to test mid-history scroll");
  230 | 
  231 |   await page.goto("/");
  232 |   await waitForMessages(page);
  233 | 
  234 |   const container = page.locator('[data-testid="conversation-messages"]').first();
  235 | 
  236 |   // Record the latest message ID (the one we should NOT jump to)
  237 |   const latestId = apiMessages[apiMessages.length - 1].id;
  238 | 
  239 |   // Scroll up substantially to get into mid-history
  240 |   for (let i = 0; i < 25; i++) {
  241 |     await page.mouse.wheel(0, -400);
  242 |     await page.waitForTimeout(100);
  243 |   }
  244 |   await page.waitForTimeout(2000);
  245 | 
  246 |   // Record what messages are visible after scrolling up
  247 |   const midHistoryIds = await container.evaluate((el) => {
  248 |     const nodes = el.querySelectorAll("[data-node-id]");
  249 |     return Array.from(nodes).map((n) => n.getAttribute("data-node-id"));
  250 |   });
  251 | 
  252 |   // Confirm we're NOT seeing the latest message (we scrolled away from it)
  253 |   const seeLatestBeforeDown = midHistoryIds.includes(latestId);
  254 |   test.skip(seeLatestBeforeDown, "Could not scroll far enough from latest — history too short");
  255 | 
  256 |   // Now scroll DOWN a moderate amount (not all the way — just a few wheel ticks)
  257 |   for (let i = 0; i < 5; i++) {
  258 |     await page.mouse.wheel(0, 400);
  259 |     await page.waitForTimeout(200);
  260 |   }
  261 |   await page.waitForTimeout(1500);
  262 | 
  263 |   // Check what's visible now
  264 |   const afterDownIds = await container.evaluate((el) => {
  265 |     const nodes = el.querySelectorAll("[data-node-id]");
  266 |     return Array.from(nodes).map((n) => n.getAttribute("data-node-id"));
  267 |   });
  268 | 
  269 |   // The latest message should NOT be visible — we only scrolled down a bit,
  270 |   // not all the way. If it IS visible, the UI jumped to latest.
  271 |   expect(
  272 |     afterDownIds.includes(latestId),
  273 |     `Scrolling down 5 ticks from mid-history jumped to the latest message (${latestId?.slice(0, 12)}). ` +
  274 |     `Expected gradual scroll, got teleport. Visible IDs went from mid-history to latest.`
  275 |   ).toBe(false);
  276 | });
  277 | 
  278 | // ============================================================================
  279 | // Test 6: Workbench tabs can be reordered by dragging
  280 | // ============================================================================
  281 | 
  282 | test("workbench tabs can be reordered by dragging", async ({ page }) => {
> 283 |   await page.goto("/");
      |              ^ Error: page.goto: Protocol error (Page.navigate): Cannot navigate to invalid URL
  284 |   await page.waitForTimeout(2000);
  285 | 
  286 |   const getTabs = async () => {
  287 |     const tabs = await page.locator('[data-testid^="workbench-tab-"]').all();
  288 |     const ids: string[] = [];
  289 |     for (const t of tabs) {
  290 |       const testid = await t.getAttribute("data-testid");
  291 |       if (testid) ids.push(testid.replace("workbench-tab-", ""));
  292 |     }
  293 |     return ids;
  294 |   };
  295 | 
  296 |   const before = await getTabs();
  297 |   expect(before.length, "Need at least 2 tabs to test reorder").toBeGreaterThanOrEqual(2);
  298 | 
  299 |   const firstTab = page.locator(`[data-testid="workbench-tab-${before[0]}"]`);
  300 |   const secondTab = page.locator(`[data-testid="workbench-tab-${before[1]}"]`);
  301 | 
  302 |   // Use explicit mouse steps (pointer events)
  303 |   const srcBox = (await firstTab.boundingBox())!;
  304 |   const tgtBox = (await secondTab.boundingBox())!;
  305 |   await page.mouse.move(srcBox.x + srcBox.width / 2, srcBox.y + srcBox.height / 2);
  306 |   await page.mouse.down();
  307 |   await page.mouse.move(tgtBox.x + tgtBox.width / 2, tgtBox.y + tgtBox.height / 2, { steps: 10 });
  308 |   await page.mouse.up();
  309 |   await page.waitForTimeout(500);
  310 | 
  311 |   const after = await getTabs();
  312 | 
  313 |   // If drag worked, the first two tabs should be swapped
  314 |   expect(
  315 |     after[0],
  316 |     `Tab drag did not reorder: before=[${before.slice(0, 3)}...] after=[${after.slice(0, 3)}...]. ` +
  317 |     `Expected '${before[1]}' at position 0, got '${after[0]}'.`
  318 |   ).toBe(before[1]);
  319 |   expect(after[1]).toBe(before[0]);
  320 | });
  321 | 
  322 | // ============================================================================
  323 | // Test 7: Rendered content matches API for the last N messages
  324 | // ============================================================================
  325 | 
  326 | test("rendered messages match the API response for the last N visible messages", async ({ page }) => {
  327 |   await page.goto("/");
  328 |   await waitForMessages(page);
  329 |   await page.waitForTimeout(1000);
  330 | 
  331 |   const container = page.locator('[data-testid="conversation-messages"]').first();
  332 | 
  333 |   // Get all rendered node IDs and their text content
  334 |   const rendered = await container.evaluate((el) => {
  335 |     const nodes = el.querySelectorAll("[data-node-id]");
  336 |     return Array.from(nodes).map((n) => ({
  337 |       id: n.getAttribute("data-node-id"),
  338 |       text: (n as HTMLElement).innerText,
  339 |     }));
  340 |   });
  341 | 
  342 |   expect(rendered.length, "No messages rendered").toBeGreaterThan(0);
  343 | 
  344 |   // Query API after page has loaded
  345 |   const apiMessages = await getHistoryMessages(AGENT);
  346 | 
  347 |   // Every rendered message should correspond to an API message with matching content.
  348 |   // Note: the WebSocket may deliver extra messages (from the live tailer) that the
  349 |   // REST API doesn't include yet. Skip those rather than failing.
  350 |   let verified = 0;
  351 |   let skippedLiveTail = 0;
  352 |   for (const r of rendered) {
  353 |     const apiMsg = apiMessages.find((m: any) => m.id === r.id);
  354 |     if (!apiMsg) {
  355 |       skippedLiveTail++;
  356 |       continue; // live-tailed message not in REST API — not a content error
  357 |     }
  358 | 
  359 |     // The frontend strips [Context left ...] tags from user messages.
  360 |     // Apply the same transform before comparing.
  361 |     let apiContent = apiMsg.content;
  362 |     if (apiMsg.role === "user") {
  363 |       apiContent = apiContent.replace(/\s*\[Context left [^\]]*\]\s*/g, "").trim();
  364 |     }
  365 | 
  366 |     // For content verification, check that distinctive words from the API
  367 |     // content appear in the rendered text. Markdown rendering changes
  368 |     // formatting but preserves words.
  369 |     const plainWords = apiContent
  370 |       .replace(/[#*`_\[\]()>|~]/g, " ")
  371 |       .replace(/\n/g, " ")
  372 |       .split(/\s+/)
  373 |       .filter((w: string) => w.length > 4 && !/^(https?|mailto)/.test(w))
  374 |       .slice(0, 10);
  375 | 
  376 |     if (plainWords.length >= 2) {
  377 |       // Check that at least half the probe words appear in rendered text
  378 |       const renderedLower = r.text.toLowerCase();
  379 |       const found = plainWords.filter((w: string) => renderedLower.includes(w.toLowerCase()));
  380 |       expect(
  381 |         found.length,
  382 |         `Message ${r.id?.slice(0, 12)} (${apiMsg.role}): only ${found.length}/${plainWords.length} words matched. Missing: ${plainWords.filter((w: string) => !renderedLower.includes(w.toLowerCase())).join(", ")}`
  383 |       ).toBeGreaterThanOrEqual(Math.ceil(plainWords.length / 2));
```