/**
 * YAML editor: CodeMirror yaml mode + Tree view (JsonTreePane).
 */
import { test, expect } from "@playwright/test";
import { writeFileSync, mkdirSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const BASE = process.env.SA_URL ?? "http://localhost:5175";
const API = process.env.SA_API ?? "http://localhost:8002";

const YAML_BODY = `service: sa-dev
port: 8002
nested:
  enabled: true
  tags:
    - yaml
    - tree
`;

test.describe("YAML editor tree view", () => {
  test("opens .yaml with Tree view showing keys", async ({ page, request }) => {
    const dir = join(tmpdir(), "sa-yaml-editor-test");
    mkdirSync(dir, { recursive: true });
    const path = join(dir, "sample.yaml");
    writeFileSync(path, YAML_BODY);

    const openResp = await request.post(`${API}/api/files/open`, { data: { path } });
    expect(openResp.status(), "files/open 200").toBe(200);
    const openData = await openResp.json();
    const docId = openData.docId || openData.doc_id || openData.id;
    expect(docId, "doc id").toBeTruthy();

    await page.goto(BASE);
    await page.waitForLoadState("networkidle");
    await page.waitForSelector("text=Live", { timeout: 5000 }).catch(() => {});

    const navResp = await request.post(`${API}/api/agent/action`, {
      data: {
        type: "workspace.navigate",
        payload: { tab: "editor", docId, newPanel: true, viewKey: "yaml-tree-test" },
      },
    });
    expect(navResp.status()).toBe(200);

    await expect(page.getByTestId("yaml-tree-btn")).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId("json-tree-view")).toBeVisible();
    await expect(page.getByTestId("json-tree-view")).toContainText("service");
    await expect(page.getByTestId("json-tree-view")).toContainText("sa-dev");
    await expect(page.getByTestId("json-tree-view")).toContainText("nested");

    await page.getByTestId("view-mode-toggle").getByText("Edit", { exact: true }).click();
    const editor = page.locator(".cm-content").first();
    await expect(editor).toContainText("service: sa-dev");
    // markdown WYSIWYG would promote "# " comments to headings; yaml comments stay text
  });
});
