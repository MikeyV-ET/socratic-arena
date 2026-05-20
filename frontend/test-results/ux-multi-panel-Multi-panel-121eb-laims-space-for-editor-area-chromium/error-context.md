# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: ux-multi-panel.spec.ts >> Multi-panel architecture >> 9: Collapsed sidebar reclaims space for editor area
- Location: tests/ux-multi-panel.spec.ts:273:3

# Error details

```
TimeoutError: locator.waitFor: Timeout 15000ms exceeded.
Call log:
  - waiting for locator('[data-testid^="workbench-tab-"]').first() to be visible

```

# Page snapshot

```yaml
- generic [ref=e3]:
  - generic [ref=e6]:
    - generic [ref=e7]:
      - banner [ref=e9]:
        - generic [ref=e10]:
          - generic [ref=e11]: Socratic Arena
          - combobox [ref=e12]:
            - option "Cinco"
            - option "Jr"
            - option "Q" [selected]
            - option "Sr"
            - option "Trip"
          - generic "active" [ref=e13]
        - generic [ref=e14]:
          - generic [ref=e15]:
            - button "A-" [ref=e16]
            - button "A+" [ref=e17]
          - button "⇀" [ref=e18]
          - button "☀" [ref=e19]
          - 'generic "Q context: 68% used" [ref=e20]':
            - generic [ref=e23]: 68%
          - generic [ref=e26]: Live
      - generic [ref=e28]:
        - generic [ref=e31]:
          - generic [ref=e32]:
            - generic [ref=e34]: Q
            - button "⚑" [ref=e36]
          - paragraph [ref=e38]:
            - text: Now update SharedEditorPane to accept
            - code [ref=e39]: "`instanceId`"
            - text: and
            - code [ref=e40]: "`config`"
            - text: "props:"
        - generic [ref=e43]:
          - generic [ref=e44]:
            - generic [ref=e46]: Q
            - button "⚑" [ref=e48]
          - paragraph [ref=e50]: "Now let's build to see if there are any type errors:"
        - generic [ref=e53]:
          - generic [ref=e54]:
            - generic [ref=e56]: Q
            - button "⚑" [ref=e58]
          - paragraph [ref=e60]:
            - text: Builds clean. Now let me also check for the
            - code [ref=e61]: "`openTabIds`"
            - text: "reference in useWebSocket since I removed that from the interface:"
        - generic [ref=e64]:
          - generic [ref=e65]:
            - generic [ref=e67]: Q
            - button "⚑" [ref=e69]
          - paragraph [ref=e71]:
            - text: Good — no remaining references. Let me also verify
            - code [ref=e72]: "`ConversationPane.tsx`"
            - text: still works since it references
            - code [ref=e73]: "`activeTab`"
            - text: ":"
        - generic [ref=e76]:
          - generic [ref=e77]:
            - generic [ref=e79]: Q
            - button "⚑" [ref=e81]
          - paragraph [ref=e83]:
            - text: That still works —
            - code [ref=e84]: "`activeTab`"
            - text: is still a string, and for the singleton "history" panel,
            - code [ref=e85]: "`instanceId === \"history\"`"
            - text: . Now let me start the dev server to test visually.
        - generic [ref=e88]:
          - generic [ref=e89]:
            - generic [ref=e91]: Q
            - button "⚑" [ref=e93]
          - paragraph [ref=e95]: Dev backend is up. Let me take a screenshot of the dev instance to verify the UI.
        - generic [ref=e98]:
          - generic [ref=e99]:
            - generic [ref=e101]: Q
            - button "⚑" [ref=e103]
          - button "▶ thinking" [ref=e104]:
            - generic [ref=e105]: ▶
            - text: thinking
          - paragraph [ref=e107]: No browser tool available. Let me verify with the existing E2E tests instead.
        - generic [ref=e110]:
          - generic [ref=e111]:
            - generic [ref=e113]: Q
            - button "⚑" [ref=e115]
          - paragraph [ref=e117]: Tests are hardcoded to port 8000 (Eric's production). I shouldn't run them against production during development — that's the whole point of the split. Let me just verify the build is clean and the dev backend serves properly, then commit.
        - generic [ref=e120]:
          - generic [ref=e121]:
            - generic [ref=e123]: Q
            - button "⚑" [ref=e125]
          - paragraph [ref=e127]: Dev frontend is serving. Let me commit everything and then notify Trip.
        - generic [ref=e130]:
          - generic [ref=e131]:
            - generic [ref=e133]: Q
            - button "⚑" [ref=e135]
          - paragraph [ref=e137]: Now let me update the lab notebook and notes.
        - generic [ref=e140]:
          - generic [ref=e141]:
            - generic [ref=e143]: Q
            - button "⚑" [ref=e145]
          - paragraph [ref=e147]: All done. Set delay — waiting for Trip's test results or Eric's next direction.
        - generic [ref=e150]:
          - generic [ref=e151]:
            - generic [ref=e153]: Q
            - button "⚑" [ref=e155]
          - generic [ref=e156]:
            - paragraph [ref=e157]: "Summary of work done this session:"
            - table [ref=e158]:
              - rowgroup [ref=e159]:
                - row "Commit Branch Description" [ref=e160]:
                  - columnheader "Commit" [ref=e161]
                  - columnheader "Branch" [ref=e162]
                  - columnheader "Description" [ref=e163]
              - rowgroup [ref=e164]:
                - 'row "`808ceb3` main (prod) Notebook font: match chat (text-sm text-foreground)" [ref=e165]':
                  - 'cell "`808ceb3`" [ref=e166]':
                    - code [ref=e167]: "`808ceb3`"
                  - cell "main (prod)" [ref=e168]
                  - 'cell "Notebook font: match chat (text-sm text-foreground)" [ref=e169]'
                - 'row "`449e9e4` main (prod) Notebook title: text-sm font-semibold" [ref=e170]':
                  - 'cell "`449e9e4`" [ref=e171]':
                    - code [ref=e172]: "`449e9e4`"
                  - cell "main (prod)" [ref=e173]
                  - 'cell "Notebook title: text-sm font-semibold" [ref=e174]'
                - 'row "`e461e71` multi-panel (dev) Collapsible editor sidebar" [ref=e175]':
                  - 'cell "`e461e71`" [ref=e176]':
                    - code [ref=e177]: "`e461e71`"
                  - cell "multi-panel (dev)" [ref=e178]
                  - cell "Collapsible editor sidebar" [ref=e179]
                - 'row "`5096ad5` multi-panel (dev) Multi-instance panel architecture" [ref=e180]':
                  - 'cell "`5096ad5`" [ref=e181]':
                    - code [ref=e182]: "`5096ad5`"
                  - cell "multi-panel (dev)" [ref=e183]
                  - cell "Multi-instance panel architecture" [ref=e184]
            - paragraph [ref=e185]:
              - text: Production tagged
              - code [ref=e186]: "`stable-v2`"
              - text: ", dev running on 8002/5175. Trip notified with test scenarios. Waiting for feedback."
        - generic [ref=e189]:
          - generic [ref=e190]:
            - generic [ref=e192]: Eric
            - button "⚑" [ref=e194]
          - paragraph [ref=e196]: make sure to create the github project for the dev version and make sure to committ/push as you go
        - generic [ref=e199]:
          - generic [ref=e200]:
            - generic [ref=e202]: Q
            - button "⚑" [ref=e204]
          - paragraph [ref=e206]: "Branch pushed. Also pushing the stable-v2 tag:"
        - generic [ref=e209]:
          - generic [ref=e210]:
            - generic [ref=e212]: Q
            - button "⚑" [ref=e214]
          - paragraph [ref=e216]:
            - text: Done. Branch
            - code [ref=e217]: "`multi-panel`"
            - text: and tag
            - code [ref=e218]: "`stable-v2`"
            - text: are both on GitHub. I'll push to
            - code [ref=e219]: "`origin multi-panel`"
            - text: as I go.
        - generic [ref=e222]:
          - generic [ref=e223]:
            - generic [ref=e225]: Eric
            - button "⚑" [ref=e227]
          - paragraph [ref=e229]: <eric (via tui) [sent during your previous turn]> make sure to update trip on what's going on so es can start to write the tests
        - generic [ref=e232]:
          - generic [ref=e233]:
            - generic [ref=e235]: Q
            - button "⚑" [ref=e237]
          - paragraph [ref=e239]: Already sent Trip a detailed briefing a few minutes ago — covers the dev/stable split (ports, branches, what not to touch), both commits on the multi-panel branch, and 9 specific test scenarios. Es should have it in sein localmail inbox now.
        - generic [ref=e242]:
          - generic [ref=e243]:
            - generic [ref=e245]: Q
            - button "⚑" [ref=e247]
          - paragraph [ref=e249]: Waiting for Trip's response or Eric's next direction.
        - generic [ref=e252]:
          - generic [ref=e253]:
            - generic [ref=e255]: Q
            - button "⚑" [ref=e257]
          - paragraph [ref=e259]: No new mail from Trip yet. Nothing to do — setting delay.
        - generic [ref=e262]:
          - generic [ref=e263]:
            - generic [ref=e265]: Q
            - button "⚑" [ref=e267]
          - paragraph [ref=e269]: Sleeping until event. All work committed and pushed, Trip briefed, waiting for feedback.
    - generic [ref=e271]:
      - button "Attach file" [ref=e272]:
        - img [ref=e273]
      - textbox "Type a message..." [ref=e275]
      - button "Send" [disabled] [ref=e276]
  - separator [ref=e277]
  - generic [ref=e280]:
    - generic [ref=e281]:
      - generic [ref=e282] [cursor=pointer]:
        - generic [ref=e283]: History
        - button "×" [ref=e284]
      - generic [ref=e285] [cursor=pointer]:
        - generic [ref=e286]: Moments
        - button "×" [ref=e287]
      - generic [ref=e288] [cursor=pointer]:
        - generic [ref=e289]: Notebook
        - button "×" [ref=e290]
      - generic [ref=e291] [cursor=pointer]:
        - generic [ref=e292]: Prompt Dev
        - button "×" [ref=e293]
      - generic [ref=e294] [cursor=pointer]:
        - generic [ref=e295]: Prompt Test
        - button "×" [ref=e296]
      - generic [ref=e297] [cursor=pointer]:
        - generic [ref=e298]: Inspector
        - button "×" [ref=e299]
      - generic [ref=e300] [cursor=pointer]:
        - generic [ref=e301]: Artifact
        - button "×" [ref=e302]
      - generic [ref=e303] [cursor=pointer]:
        - generic [ref=e304]: Apps
        - button "×" [ref=e305]
      - generic [ref=e306] [cursor=pointer]:
        - generic [ref=e307]: Boundaries
        - button "×" [ref=e308]
      - generic [ref=e309] [cursor=pointer]:
        - generic [ref=e310]: Corrections
        - button "×" [ref=e311]
      - generic [ref=e312] [cursor=pointer]:
        - generic [ref=e313]: Episodes
        - button "×" [ref=e314]
      - generic [ref=e315] [cursor=pointer]:
        - generic [ref=e316]: Editor
        - button "×" [ref=e317]
      - button "+" [ref=e319]
      - generic [ref=e320]:
        - button "A-" [ref=e321]
        - button "A+" [ref=e322]
      - button "┅" [ref=e323]
      - button "┇" [ref=e324]
    - generic [ref=e325]:
      - generic [ref=e328]:
        - generic [ref=e331]:
          - generic [ref=e332]:
            - generic [ref=e333]: Agent
            - combobox [ref=e334]:
              - option "Cinco"
              - option "Jr"
              - option "Q" [selected]
              - option "Sr"
              - option "Trip"
            - combobox "Select session" [ref=e335]:
              - option "019e1dbe - May 20 - 44.4MB (live)" [selected]
              - option "019e2904 - May 14 - 8.3KB"
              - option "019e2900 - May 14 - 16.6KB"
              - option "019e1dbe - May 12 - 8.3KB"
              - option "019d1ec2 - May 12 - 1021.8MB"
              - option "019e1d82 - May 12 - 8.3KB"
              - option "019e1d81 - May 12 - 8.3KB"
          - button "Search" [ref=e336]
        - generic [ref=e338]:
          - generic [ref=e341]:
            - generic [ref=e342]:
              - generic [ref=e344]: Q
              - button "⚑" [ref=e346]
            - paragraph [ref=e348]:
              - text: Now update SharedEditorPane to accept
              - code [ref=e349]: "`instanceId`"
              - text: and
              - code [ref=e350]: "`config`"
              - text: "props:"
          - generic [ref=e353]:
            - generic [ref=e354]:
              - generic [ref=e356]: Q
              - button "⚑" [ref=e358]
            - paragraph [ref=e360]: "Now let's build to see if there are any type errors:"
          - generic [ref=e363]:
            - generic [ref=e364]:
              - generic [ref=e366]: Q
              - button "⚑" [ref=e368]
            - paragraph [ref=e370]:
              - text: Builds clean. Now let me also check for the
              - code [ref=e371]: "`openTabIds`"
              - text: "reference in useWebSocket since I removed that from the interface:"
          - generic [ref=e374]:
            - generic [ref=e375]:
              - generic [ref=e377]: Q
              - button "⚑" [ref=e379]
            - paragraph [ref=e381]:
              - text: Good — no remaining references. Let me also verify
              - code [ref=e382]: "`ConversationPane.tsx`"
              - text: still works since it references
              - code [ref=e383]: "`activeTab`"
              - text: ":"
          - generic [ref=e386]:
            - generic [ref=e387]:
              - generic [ref=e389]: Q
              - button "⚑" [ref=e391]
            - paragraph [ref=e393]:
              - text: That still works —
              - code [ref=e394]: "`activeTab`"
              - text: is still a string, and for the singleton "history" panel,
              - code [ref=e395]: "`instanceId === \"history\"`"
              - text: . Now let me start the dev server to test visually.
          - generic [ref=e398]:
            - generic [ref=e399]:
              - generic [ref=e401]: Q
              - button "⚑" [ref=e403]
            - paragraph [ref=e405]: Dev backend is up. Let me take a screenshot of the dev instance to verify the UI.
          - generic [ref=e408]:
            - generic [ref=e409]:
              - generic [ref=e411]: Q
              - button "⚑" [ref=e413]
            - button "▶ thinking" [ref=e414]:
              - generic [ref=e415]: ▶
              - text: thinking
            - paragraph [ref=e417]: No browser tool available. Let me verify with the existing E2E tests instead.
          - generic [ref=e420]:
            - generic [ref=e421]:
              - generic [ref=e423]: Q
              - button "⚑" [ref=e425]
            - paragraph [ref=e427]: Tests are hardcoded to port 8000 (Eric's production). I shouldn't run them against production during development — that's the whole point of the split. Let me just verify the build is clean and the dev backend serves properly, then commit.
          - generic [ref=e430]:
            - generic [ref=e431]:
              - generic [ref=e433]: Q
              - button "⚑" [ref=e435]
            - paragraph [ref=e437]: Dev frontend is serving. Let me commit everything and then notify Trip.
          - generic [ref=e440]:
            - generic [ref=e441]:
              - generic [ref=e443]: Q
              - button "⚑" [ref=e445]
            - paragraph [ref=e447]: Now let me update the lab notebook and notes.
          - generic [ref=e450]:
            - generic [ref=e451]:
              - generic [ref=e453]: Q
              - button "⚑" [ref=e455]
            - paragraph [ref=e457]: All done. Set delay — waiting for Trip's test results or Eric's next direction.
          - generic [ref=e460]:
            - generic [ref=e461]:
              - generic [ref=e463]: Q
              - button "⚑" [ref=e465]
            - generic [ref=e466]:
              - paragraph [ref=e467]: "Summary of work done this session:"
              - table [ref=e468]:
                - rowgroup [ref=e469]:
                  - row "Commit Branch Description" [ref=e470]:
                    - columnheader "Commit" [ref=e471]
                    - columnheader "Branch" [ref=e472]
                    - columnheader "Description" [ref=e473]
                - rowgroup [ref=e474]:
                  - 'row "`808ceb3` main (prod) Notebook font: match chat (text-sm text-foreground)" [ref=e475]':
                    - 'cell "`808ceb3`" [ref=e476]':
                      - code [ref=e477]: "`808ceb3`"
                    - cell "main (prod)" [ref=e478]
                    - 'cell "Notebook font: match chat (text-sm text-foreground)" [ref=e479]'
                  - 'row "`449e9e4` main (prod) Notebook title: text-sm font-semibold" [ref=e480]':
                    - 'cell "`449e9e4`" [ref=e481]':
                      - code [ref=e482]: "`449e9e4`"
                    - cell "main (prod)" [ref=e483]
                    - 'cell "Notebook title: text-sm font-semibold" [ref=e484]'
                  - 'row "`e461e71` multi-panel (dev) Collapsible editor sidebar" [ref=e485]':
                    - 'cell "`e461e71`" [ref=e486]':
                      - code [ref=e487]: "`e461e71`"
                    - cell "multi-panel (dev)" [ref=e488]
                    - cell "Collapsible editor sidebar" [ref=e489]
                  - 'row "`5096ad5` multi-panel (dev) Multi-instance panel architecture" [ref=e490]':
                    - 'cell "`5096ad5`" [ref=e491]':
                      - code [ref=e492]: "`5096ad5`"
                    - cell "multi-panel (dev)" [ref=e493]
                    - cell "Multi-instance panel architecture" [ref=e494]
              - paragraph [ref=e495]:
                - text: Production tagged
                - code [ref=e496]: "`stable-v2`"
                - text: ", dev running on 8002/5175. Trip notified with test scenarios. Waiting for feedback."
          - generic [ref=e499]:
            - generic [ref=e500]:
              - generic [ref=e502]: Eric
              - button "⚑" [ref=e504]
            - paragraph [ref=e506]: make sure to create the github project for the dev version and make sure to committ/push as you go
          - generic [ref=e509]:
            - generic [ref=e510]:
              - generic [ref=e512]: Q
              - button "⚑" [ref=e514]
            - paragraph [ref=e516]: "Branch pushed. Also pushing the stable-v2 tag:"
          - generic [ref=e519]:
            - generic [ref=e520]:
              - generic [ref=e522]: Q
              - button "⚑" [ref=e524]
            - paragraph [ref=e526]:
              - text: Done. Branch
              - code [ref=e527]: "`multi-panel`"
              - text: and tag
              - code [ref=e528]: "`stable-v2`"
              - text: are both on GitHub. I'll push to
              - code [ref=e529]: "`origin multi-panel`"
              - text: as I go.
          - generic [ref=e532]:
            - generic [ref=e533]:
              - generic [ref=e535]: Eric
              - button "⚑" [ref=e537]
            - paragraph [ref=e539]: <eric (via tui) [sent during your previous turn]> make sure to update trip on what's going on so es can start to write the tests
          - generic [ref=e542]:
            - generic [ref=e543]:
              - generic [ref=e545]: Q
              - button "⚑" [ref=e547]
            - paragraph [ref=e549]: Already sent Trip a detailed briefing a few minutes ago — covers the dev/stable split (ports, branches, what not to touch), both commits on the multi-panel branch, and 9 specific test scenarios. Es should have it in sein localmail inbox now.
          - generic [ref=e552]:
            - generic [ref=e553]:
              - generic [ref=e555]: Q
              - button "⚑" [ref=e557]
            - paragraph [ref=e559]: Waiting for Trip's response or Eric's next direction.
          - generic [ref=e562]:
            - generic [ref=e563]:
              - generic [ref=e565]: Q
              - button "⚑" [ref=e567]
            - paragraph [ref=e569]: No new mail from Trip yet. Nothing to do — setting delay.
          - generic [ref=e572]:
            - generic [ref=e573]:
              - generic [ref=e575]: Q
              - button "⚑" [ref=e577]
            - paragraph [ref=e579]: Sleeping until event. All work committed and pushed, Trip briefed, waiting for feedback.
      - option "Cinco"
      - option "Jr"
      - option "Q" [selected]
      - option "Sr"
      - option "Trip"
      - option "019e1dbe - May 20 - 44.4MB (live)" [selected]
      - option "019e2904 - May 14 - 8.3KB"
      - option "019e2900 - May 14 - 16.6KB"
      - option "019e1dbe - May 12 - 8.3KB"
      - option "019d1ec2 - May 12 - 1021.8MB"
      - option "019e1d82 - May 12 - 8.3KB"
      - option "019e1d81 - May 12 - 8.3KB"
      - option "Cinco"
      - option "Jr"
      - option "Q" [selected]
      - option "Sr"
      - option "Trip"
      - option "grok-4.20-0403-reasoning" [selected]
      - option "Sr"
      - option "Cinco"
      - option "Trip"
      - option "Q" [selected]
      - option "Jr"
      - option "Squiggy"
      - option "#1 - May 14, 11:44 AM (turn 28)"
      - option "#2 - May 14, 04:30 PM (turn 63)"
      - option "#3 - May 15, 10:35 AM (turn 54)"
      - option "#4 - May 15, 09:58 PM (turn 93)"
      - option "#5 - May 16, 12:04 AM (turn 127)"
      - option "#6 - May 16, 12:24 AM (turn 128)"
      - option "#7 - May 16, 08:45 AM (turn 148)"
      - option "#8 - May 16, 09:31 AM (turn 12)"
      - option "#9 - May 16, 11:07 PM (turn 14)"
      - option "#10 - May 19, 03:36 PM (turn 23)"
      - option "#11 - May 19, 06:25 PM (turn 69)" [selected]
      - option "coding-mix-latest" [selected]
```

# Test source

```ts
  1   | import { test, expect, Page } from "@playwright/test";
  2   | 
  3   | /**
  4   |  * UX tests for Multi-instance Panel Architecture
  5   |  *
  6   |  * Tests the workbench panel system: singleton tabs, multi-instance editors,
  7   |  * drag-reorder, localStorage persistence, sidebar collapse.
  8   |  *
  9   |  * Target: dev instance on port 5175
  10  |  */
  11  | 
  12  | test.use({ baseURL: "http://localhost:5175" });
  13  | 
  14  | // Known singleton panel types (instanceId === type)
  15  | const KNOWN_SINGLETONS = [
  16  |   "history", "notebook", "editor", "apps",
  17  | ];
  18  | 
  19  | /** Wait for workbench to be interactive */
  20  | async function waitForWorkbench(page: Page) {
  21  |   // Wait for at least one workbench tab to be visible
> 22  |   await page.locator('[data-testid^="workbench-tab-"]').first().waitFor({
      |                                                                 ^ TimeoutError: locator.waitFor: Timeout 15000ms exceeded.
  23  |     state: "visible",
  24  |     timeout: 15_000,
  25  |   });
  26  | }
  27  | 
  28  | test.describe("Multi-panel architecture", () => {
  29  | 
  30  |   test.beforeEach(async ({ page }) => {
  31  |     await page.goto("/");
  32  |     await waitForWorkbench(page);
  33  |   });
  34  | 
  35  |   test("1: Default panel set loads correctly", async ({ page }) => {
  36  |     // Clear localStorage and reload to get default set
  37  |     await page.evaluate(() => localStorage.removeItem("sa-workbench-panels"));
  38  |     await page.reload();
  39  |     await waitForWorkbench(page);
  40  | 
  41  |     // All known singletons should be in the DOM
  42  |     for (const type of KNOWN_SINGLETONS) {
  43  |       const tab = page.locator(`[data-testid="workbench-tab-${type}"]`);
  44  |       await expect(tab).toBeAttached({ timeout: 5_000 });
  45  |     }
  46  | 
  47  |     // Should have at least as many tabs as known singletons
  48  |     const allTabs = page.locator('[data-testid^="workbench-tab-"]');
  49  |     const tabCount = await allTabs.count();
  50  |     expect(tabCount).toBeGreaterThanOrEqual(KNOWN_SINGLETONS.length);
  51  |   });
  52  | 
  53  |   test("2: Close singleton tab then reopen — tab reappears", async ({ page }) => {
  54  |     // Activate notebook tab
  55  |     const notebookTab = page.locator('[data-testid="workbench-tab-notebook"]');
  56  |     await notebookTab.click();
  57  |     await page.waitForTimeout(300);
  58  | 
  59  |     // Close it
  60  |     const closeBtn = page.locator('[data-testid="close-tab-notebook"]');
  61  |     // Close button may only appear on hover
  62  |     await notebookTab.hover();
  63  |     await page.waitForTimeout(200);
  64  | 
  65  |     if (await closeBtn.isVisible()) {
  66  |       await closeBtn.click();
  67  |       await page.waitForTimeout(300);
  68  | 
  69  |       // Verify it's gone
  70  |       await expect(notebookTab).not.toBeAttached();
  71  | 
  72  |       // Reopen from + menu
  73  |       await page.locator('[data-testid="open-tab-menu"]').click();
  74  |       await page.waitForTimeout(300);
  75  |       const reopenBtn = page.locator('[data-testid="reopen-tab-notebook"]');
  76  |       await expect(reopenBtn).toBeVisible();
  77  |       await reopenBtn.click();
  78  |       await page.waitForTimeout(300);
  79  | 
  80  |       // Verify it's back
  81  |       await expect(page.locator('[data-testid="workbench-tab-notebook"]')).toBeAttached();
  82  |     }
  83  |   });
  84  | 
  85  |   test("3: Create new editor instance — appears as new tab", async ({ page }) => {
  86  |     // Count editor tabs before
  87  |     const editorTabsBefore = page.locator('[data-testid^="workbench-tab-editor"]');
  88  |     const countBefore = await editorTabsBefore.count();
  89  | 
  90  |     // Open + menu and wait for dropdown to fully render
  91  |     await page.locator('[data-testid="open-tab-menu"]').click();
  92  |     const addEditorBtn = page.locator('[data-testid="add-panel-editor"]');
  93  |     await expect(addEditorBtn).toBeVisible({ timeout: 5_000 });
  94  | 
  95  |     // Click with force to bypass any overlay issues
  96  |     await addEditorBtn.click({ force: true });
  97  | 
  98  |     // Wait for the new tab to appear (Zustand update + React re-render)
  99  |     const editorTabsAfter = page.locator('[data-testid^="workbench-tab-editor"]');
  100 |     await expect(editorTabsAfter).toHaveCount(countBefore + 1, { timeout: 5_000 });
  101 | 
  102 |     // New tab should have a unique instanceId (not just "editor")
  103 |     const allTestIds: string[] = [];
  104 |     const countAfter = await editorTabsAfter.count();
  105 |     for (let i = 0; i < countAfter; i++) {
  106 |       const testId = await editorTabsAfter.nth(i).getAttribute("data-testid");
  107 |       allTestIds.push(testId ?? "");
  108 |     }
  109 |     const unique = new Set(allTestIds);
  110 |     expect(unique.size).toBe(allTestIds.length);
  111 |   });
  112 | 
  113 |   test("4: Multiple editor instances coexist independently", async ({ page }) => {
  114 |     const editorTabs = page.locator('[data-testid^="workbench-tab-editor"]');
  115 | 
  116 |     // Create two new editor instances
  117 |     for (let i = 0; i < 2; i++) {
  118 |       const countBefore = await editorTabs.count();
  119 |       await page.locator('[data-testid="open-tab-menu"]').click();
  120 |       const addBtn = page.locator('[data-testid="add-panel-editor"]');
  121 |       await expect(addBtn).toBeVisible({ timeout: 5_000 });
  122 |       await addBtn.click({ force: true });
```