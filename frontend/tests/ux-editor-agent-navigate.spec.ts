/**
 * Editor Agent Navigate Tests
 *
 * Tests the flow where an agent opens a document for the user:
 * 1. Agent calls POST /api/files/open with a file path -> gets doc id
 * 2. Agent sends workspace.navigate via POST /api/agent/action
 *    with tab='editor' and docId
 * 3. User sees the editor tab activate with the file loaded
 *
 * Test request #9 from Jr (2026-06-25).
 */

import { test, expect } from "@playwright/test";

const BASE = "http://localhost:5175";
const API = "http://localhost:8002";

// Use a file that definitely exists on the system
const TEST_FILE_PATH = "/home/eric/agents/Trip/MikeyV_Trip_notes_to_self.md";

test.describe("Agent opens document for user", () => {

  test("API: /api/files/open returns a doc id for a valid file", async ({ request }) => {
    const resp = await request.post(`${API}/api/files/open`, {
      data: { path: TEST_FILE_PATH },
    });
    expect(resp.status(), "files/open should return 200").toBe(200);
    const data = await resp.json();
    expect(data.docId || data.doc_id || data.id, "Response should include a doc id").toBeTruthy();
  });

  test("API: /api/agent/action broadcasts workspace.navigate", async ({ request }) => {
    // First open a file to get a doc id
    const openResp = await request.post(`${API}/api/files/open`, {
      data: { path: TEST_FILE_PATH },
    });
    const openData = await openResp.json();
    const docId = openData.docId || openData.doc_id || openData.id;
    expect(docId, "Should have a doc id from files/open").toBeTruthy();

    // Send workspace.navigate via agent action endpoint
    const navResp = await request.post(`${API}/api/agent/action`, {
      data: {
        type: "workspace.navigate",
        payload: { tab: "editor", docId },
      },
    });
    expect(navResp.status(), "agent/action should return 200").toBe(200);
    const navData = await navResp.json();
    expect(navData.status, "agent/action should return ok").toBe("ok");
  });

  test("E2E: agent navigate opens editor tab with document loaded", async ({ page, request }) => {
    // Step 1: Open the file via API to get doc id
    const openResp = await request.post(`${API}/api/files/open`, {
      data: { path: TEST_FILE_PATH },
    });
    expect(openResp.status()).toBe(200);
    const openData = await openResp.json();
    const docId = openData.docId || openData.doc_id || openData.id;
    expect(docId, "Should have a doc id").toBeTruthy();

    // Step 2: Load the page and wait for WebSocket connection
    await page.goto(BASE);
    await page.waitForLoadState("networkidle");

    // Step 3: Agent sends workspace.navigate via REST
    const navResp = await request.post(`${API}/api/agent/action`, {
      data: {
        type: "workspace.navigate",
        payload: { tab: "editor", docId },
      },
    });
    expect(navResp.status()).toBe(200);

    // Step 4: Wait for editor tab to become active
    // The editor tab should appear and be selected
    await page.waitForTimeout(1000);

    // Check that editor content is visible — look for editor-related elements
    const editorPane = page.locator(
      '[data-testid="editor-pane"], [data-testid="editor-panel"], .editor-pane, .ProseMirror, .cm-editor, [data-testid*="editor"]'
    ).first();
    const editorVisible = await editorPane.isVisible().catch(() => false);

    // Also check if the file content appears somewhere on the page
    // Trip's notes file contains "MikeyV-Trip" — use that as a content signal
    const contentVisible = await page.locator('text=MikeyV-Trip').first().isVisible().catch(() => false);

    expect(
      editorVisible || contentVisible,
      "Editor pane should be visible with document content after workspace.navigate"
    ).toBe(true);
  });
});