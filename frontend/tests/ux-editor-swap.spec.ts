import { test, expect, Page } from "@playwright/test";

/**
 * UX test: Editor tab swap preserves content
 *
 * Bug: Open two editor instances, each with a file open. Drag to swap
 * their tab positions. Both editors go blank after the swap.
 *
 * Target: SA_URL env var (default: http://localhost:5175 = dev)
 */

const BASE_URL = process.env.SA_URL ?? "http://localhost:5175";
test.use({ baseURL: BASE_URL });

// ---------------------------------------------------------------------------
// Scoping helper: the active workbench panel's wrapper does NOT have the
// Tailwind "invisible" class, while inactive panels do. We scope all editor
// interactions through this to avoid strict-mode violations from duplicate
// testids across multiple mounted editor instances.
// ---------------------------------------------------------------------------
const ACTIVE_PANEL = 'div.absolute:not(.invisible)';

/** Wait for workbench to be interactive. */
async function waitForWorkbench(page: Page) {
  await page.locator('[data-testid^="workbench-tab-"]').first().waitFor({
    state: "visible",
    timeout: 15_000,
  });
}

/** Add a new editor panel via the + menu. Returns the instanceId. */
async function addEditorPanel(page: Page): Promise<string> {
  const editorTabs = page.locator('[data-testid^="workbench-tab-editor"]');
  const countBefore = await editorTabs.count();

  await page.locator('[data-testid="open-tab-menu"]').click();
  const addBtn = page.locator('[data-testid="add-panel-editor"]');
  await expect(addBtn).toBeVisible({ timeout: 5_000 });
  await addBtn.click({ force: true });
  await expect(editorTabs).toHaveCount(countBefore + 1, { timeout: 5_000 });
  await page.waitForTimeout(300);

  const newTab = editorTabs.nth(countBefore);
  const testId = await newTab.getAttribute("data-testid");
  return testId?.replace("workbench-tab-", "") ?? "";
}

/** Create a new doc via the "+ New" button in the currently active editor.
 *  Uses ACTIVE_PANEL scoping to avoid duplicate-element issues. */
async function createDocInActiveEditor(page: Page, title: string): Promise<void> {
  const createBtn = page.locator(`${ACTIVE_PANEL} [data-testid="create-doc-btn"]`);
  await createBtn.click();
  await page.waitForTimeout(300);

  const titleInput = page.locator(`${ACTIVE_PANEL} [data-testid="create-doc-title"]`);
  await expect(titleInput).toBeVisible({ timeout: 3_000 });
  await titleInput.fill(title);
  await titleInput.press("Enter");

  // Wait for CodeMirror to mount (openDoc → requestAnimationFrame)
  const cmEditor = page.locator(`${ACTIVE_PANEL} .cm-editor`);
  await expect(cmEditor).toBeVisible({ timeout: 10_000 });
  await page.waitForTimeout(500);
}

/** Type text into the active panel's CodeMirror editor. */
async function typeInActiveEditor(page: Page, text: string): Promise<void> {
  // CodeMirror 6: click the .cm-content contenteditable, then use
  // pressSequentially which sends key events to the focused element.
  const cmContent = page.locator(`${ACTIVE_PANEL} .cm-content`);
  await cmContent.click();
  await page.waitForTimeout(100);
  // Ensure CM has focus via direct DOM focus call
  await page.evaluate((sel) => {
    const el = document.querySelector(sel + ' .cm-content') as HTMLElement;
    if (el) el.focus();
  }, ACTIVE_PANEL);
  await page.waitForTimeout(100);
  await cmContent.pressSequentially(text, { delay: 30 });
  await page.waitForTimeout(300);
}

/** Read text from the active (visible) CodeMirror editor via DOM query.
 *  Uses page.evaluate to reliably find the visible editor regardless of
 *  CSS scoping quirks. */
async function getActiveEditorText(page: Page): Promise<string> {
  // Wait for at least one .cm-content to exist
  await page.locator('.cm-content').first().waitFor({ state: "attached", timeout: 5_000 });
  // Find the visible one via evaluate (respects computed visibility)
  const text = await page.evaluate(() => {
    const els = document.querySelectorAll('.cm-content');
    for (const el of els) {
      const style = window.getComputedStyle(el);
      if (style.visibility !== 'hidden' && style.display !== 'none') {
        const rect = el.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          return el.textContent ?? '';
        }
      }
    }
    return '__NOT_FOUND__';
  });
  expect(text, "No visible CodeMirror editor found").not.toBe('__NOT_FOUND__');
  return text;
}

/** Activate a workbench tab by instanceId and verify it becomes active. */
async function activateTab(page: Page, instanceId: string): Promise<void> {
  const tab = page.locator(`[data-testid="workbench-tab-${instanceId}"]`);
  await expect(tab).toBeVisible({ timeout: 5_000 });
  await tab.click();
  await expect(tab).toHaveClass(/border-b-primary/, { timeout: 5_000 });
  await page.waitForTimeout(400);
}

/** Get ordered list of workbench tab instanceIds. */
async function getTabOrder(page: Page): Promise<string[]> {
  const tabs = page.locator('[data-testid^="workbench-tab-"]');
  const count = await tabs.count();
  const ids: string[] = [];
  for (let i = 0; i < count; i++) {
    const testId = await tabs.nth(i).getAttribute("data-testid");
    ids.push(testId?.replace("workbench-tab-", "") ?? "");
  }
  return ids;
}

/** Swap two tabs via pointer drag, falling back to store.reorderTabs(). */
async function swapTabs(page: Page, idA: string, idB: string): Promise<void> {
  const srcTab = page.locator(`[data-testid="workbench-tab-${idA}"]`);
  const dstTab = page.locator(`[data-testid="workbench-tab-${idB}"]`);
  const srcBox = await srcTab.boundingBox();
  const dstBox = await dstTab.boundingBox();
  const orderBefore = await getTabOrder(page);

  if (srcBox && dstBox) {
    await page.mouse.move(srcBox.x + srcBox.width / 2, srcBox.y + srcBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(
      dstBox.x + dstBox.width / 2,
      dstBox.y + dstBox.height / 2,
      { steps: 15 },
    );
    await page.mouse.up();
    await page.waitForTimeout(500);
  }

  const orderAfter = await getTabOrder(page);
  if (orderAfter.indexOf(idA) === orderBefore.indexOf(idA)) {
    console.warn("Pointer drag did not swap tabs — using store.reorderTabs()");
    await page.evaluate(([a, b]) => {
      const store = (window as any).__ARENA_STORE__;
      if (!store) return;
      const ids = store.getState().workbenchPanels.map((p: any) => p.instanceId);
      const ai = ids.indexOf(a), bi = ids.indexOf(b);
      if (ai >= 0 && bi >= 0) {
        ids[ai] = b;
        ids[bi] = a;
        store.getState().reorderTabs(ids);
      }
    }, [idA, idB]);
    await page.waitForTimeout(500);
  }
}


test.describe("Editor tab swap preserves content", () => {

  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await waitForWorkbench(page);
  });

  test("Two editors with docs — swap positions — content survives", async ({ page }) => {
    // Known bug: both editors go blank after tab swap. Remove test.fail()
    // once the fix lands. When fixed, this test will "unexpectedly pass"
    // and Playwright will flag it — that's the signal to remove this line.
    test.fail();
    const textA = "Document Alpha content";
    const textB = "Document Beta content";

    // --- Setup: two editors, each with a doc and typed content ---

    // Editor A (only editor in DOM — no scoping ambiguity)
    const idA = await addEditorPanel(page);
    await createDocInActiveEditor(page, "Alpha");
    await typeInActiveEditor(page, textA);
    const preA = await getActiveEditorText(page);
    expect(preA).toContain(textA);

    // Editor B (now two editors; B is active, A is invisible)
    const idB = await addEditorPanel(page);
    await createDocInActiveEditor(page, "Beta");
    await typeInActiveEditor(page, textB);
    const preB = await getActiveEditorText(page);
    expect(preB).toContain(textB);

    // Verify editor A still has its content
    await activateTab(page, idA);
    const checkA = await getActiveEditorText(page);
    expect(checkA, "Editor A content before swap").toContain(textA);

    // Back to B for the swap
    await activateTab(page, idB);

    // --- Act: swap tab positions ---
    await swapTabs(page, idA, idB);

    // --- Assert: both editors still show their content ---

    await activateTab(page, idA);
    const afterA = await getActiveEditorText(page);
    expect(
      afterA,
      `Editor A went blank after tab swap. Expected "${textA}".`,
    ).toContain(textA);

    await activateTab(page, idB);
    const afterB = await getActiveEditorText(page);
    expect(
      afterB,
      `Editor B went blank after tab swap. Expected "${textB}".`,
    ).toContain(textB);
  });

  test("Swap editors then continue typing — editor still functional", async ({ page }) => {
    // Known bug: same root cause as above — swap kills CodeMirror.
    test.fail();
    const textA = "AlphaStart";
    const textB = "BetaStart";

    // Setup two editors with content
    const idA = await addEditorPanel(page);
    await createDocInActiveEditor(page, "Alpha Func");
    await typeInActiveEditor(page, textA);

    const idB = await addEditorPanel(page);
    await createDocInActiveEditor(page, "Beta Func");
    await typeInActiveEditor(page, textB);

    // --- Swap ---
    await swapTabs(page, idA, idB);

    // --- Verify editors still exist and are typeable after swap ---
    // Check content first (fast fail via page.evaluate), then type.

    await activateTab(page, idA);
    const afterA = await getActiveEditorText(page);
    expect(afterA, "Editor A blank after swap — can't type").toContain(textA);
    await typeInActiveEditor(page, " AlphaMore");
    const finalA = await getActiveEditorText(page);
    expect(finalA, "Typing in editor A after swap failed").toContain("AlphaMore");

    await activateTab(page, idB);
    const afterB = await getActiveEditorText(page);
    expect(afterB, "Editor B blank after swap — can't type").toContain(textB);
    await typeInActiveEditor(page, " BetaMore");
    const finalB = await getActiveEditorText(page);
    expect(finalB, "Typing in editor B after swap failed").toContain("BetaMore");
  });
});