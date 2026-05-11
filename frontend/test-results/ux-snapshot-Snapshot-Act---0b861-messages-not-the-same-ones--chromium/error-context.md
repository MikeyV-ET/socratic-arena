# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: ux-snapshot.spec.ts >> Snapshot/Act -- Scroll behavior >> Scrolling up reveals older messages (not the same ones)
- Location: tests/ux-snapshot.spec.ts:41:3

# Error details

```
Error: Scrolled up but see the same 5 messages. Before: 12, After: 12. Scroll may have snapped back.

expect(received).toBeGreaterThan(expected)

Expected: > 5
Received:   5
```

# Page snapshot

```yaml
- generic [ref=e2]:
  - banner [ref=e3]:
    - generic [ref=e4]:
      - heading "Socratic Arena" [level=1] [ref=e5]
      - combobox [ref=e6]:
        - option "Cinco" [selected]
        - option "Jr"
        - option "Q"
        - option "Sr"
        - option "Trip"
      - generic [ref=e9]: active
    - generic [ref=e10]:
      - combobox [ref=e11]:
        - option "Cinco" [selected]
      - generic [ref=e12]:
        - button "A-" [ref=e13]
        - generic [ref=e14]: "14"
        - button "A+" [ref=e15]
      - button "☀" [ref=e16]
      - generic [ref=e17]:
        - 'generic "Cinco context: 65% used" [ref=e18]'
        - generic [ref=e20]: 65%
      - generic [ref=e23]: Live
  - generic [ref=e24]:
    - generic [ref=e27]:
      - generic [ref=e29]:
        - button "A-" [ref=e30]
        - button "A+" [ref=e31]
      - generic [ref=e34]:
        - generic [ref=e37]:
          - generic [ref=e38]:
            - generic [ref=e40]: Cinco
            - button "⚑" [ref=e42]
          - button "▶ thinking" [ref=e43]:
            - generic [ref=e44]: ▶
            - text: thinking
          - paragraph [ref=e46]: Let me flush the lab notebook with today's findings before sleeping.
        - generic [ref=e49]:
          - generic [ref=e50]:
            - generic [ref=e52]: Cinco
            - button "⚑" [ref=e54]
          - paragraph [ref=e56]: Notebook flushed with today's findings. Sleeping until event.
        - generic [ref=e59]:
          - generic [ref=e60]:
            - generic [ref=e62]: Eric
            - button "⚑" [ref=e64]
          - paragraph [ref=e66]: "[clock (id=date_f41d9cad, ts=1778396401.2103028, reply_via=clock outbox)] [clock] Date changed: it is now Sunday, May 10, 2026."
        - generic [ref=e69]:
          - generic [ref=e70]:
            - generic [ref=e72]: Cinco
            - button "⚑" [ref=e74]
          - paragraph [ref=e76]: Noted.
        - generic [ref=e79]:
          - generic [ref=e80]:
            - generic [ref=e82]: Eric
            - button "⚑" [ref=e84]
          - paragraph [ref=e86]: "[clock (id=date_d408cf4e, ts=1778482801.6106389, reply_via=clock outbox)] [clock] Date changed: it is now Monday, May 11, 2026."
        - generic [ref=e89]:
          - generic [ref=e90]:
            - generic [ref=e92]: Cinco
            - button "⚑" [ref=e94]
          - paragraph [ref=e96]: Noted.
      - button "Jump to latest" [ref=e97]
      - generic [ref=e99]:
        - button "Attach file" [ref=e100]:
          - img [ref=e101]
        - textbox "Type a message..." [ref=e103]
        - button "Send" [disabled] [ref=e104]
    - separator [ref=e105]
    - generic [ref=e108]:
      - generic [ref=e109]:
        - generic [ref=e110] [cursor=pointer]:
          - generic [ref=e111]: History
          - button "×" [ref=e112]
        - generic [ref=e113] [cursor=pointer]:
          - generic [ref=e114]: Moments
          - button "×" [ref=e115]
        - generic [ref=e116] [cursor=pointer]:
          - generic [ref=e117]: Notebook
          - button "×" [ref=e118]
        - generic [ref=e119] [cursor=pointer]:
          - generic [ref=e120]: Prompt Dev
          - button "×" [ref=e121]
        - generic [ref=e122] [cursor=pointer]:
          - generic [ref=e123]: Prompt Test
          - button "×" [ref=e124]
        - generic [ref=e125] [cursor=pointer]:
          - generic [ref=e126]: Inspector
          - button "×" [ref=e127]
        - generic [ref=e128] [cursor=pointer]:
          - generic [ref=e129]: Artifact
          - button "×" [ref=e130]
        - generic [ref=e131] [cursor=pointer]:
          - generic [ref=e132]: Apps
          - button "×" [ref=e133]
        - generic [ref=e134] [cursor=pointer]:
          - generic [ref=e135]: Boundaries
          - button "×" [ref=e136]
        - generic [ref=e137] [cursor=pointer]:
          - generic [ref=e138]: Corrections
          - button "×" [ref=e139]
        - generic [ref=e140] [cursor=pointer]:
          - generic [ref=e141]: Episodes
          - button "×" [ref=e142]
        - button "+" [ref=e144]
        - generic [ref=e145]:
          - button "A-" [ref=e146]
          - button "A+" [ref=e147]
        - button "┅" [ref=e148]
        - button "┇" [ref=e149]
      - generic [ref=e150]:
        - generic [ref=e152]:
          - generic [ref=e154]:
            - generic [ref=e155]:
              - generic [ref=e156]: Agent
              - combobox [ref=e157]:
                - option "Cinco" [selected]
                - option "Jr"
                - option "Q"
                - option "Sr"
                - option "Trip"
              - combobox "Select session" [ref=e158]:
                - option "cinco - May 11 - 51.9MB"
                - option "019d1ec0 - May 11 - 51.9MB (live)" [selected]
                - option "019dbc75 - Apr 23 - 6.7KB"
            - button "Search" [ref=e159]
          - generic [ref=e162]:
            - generic [ref=e165]:
              - generic [ref=e166]:
                - generic [ref=e168]: Cinco
                - button "⚑" [ref=e170]
              - button "▶ thinking" [ref=e171]:
                - generic [ref=e172]: ▶
                - text: thinking
              - paragraph [ref=e174]: Let me flush the lab notebook with today's findings before sleeping.
            - generic [ref=e177]:
              - generic [ref=e178]:
                - generic [ref=e180]: Cinco
                - button "⚑" [ref=e182]
              - paragraph [ref=e184]: Notebook flushed with today's findings. Sleeping until event.
            - generic [ref=e187]:
              - generic [ref=e188]:
                - generic [ref=e190]: Eric
                - button "⚑" [ref=e192]
              - paragraph [ref=e194]: "[clock (id=date_f41d9cad, ts=1778396401.2103028, reply_via=clock outbox)] [clock] Date changed: it is now Sunday, May 10, 2026."
            - generic [ref=e197]:
              - generic [ref=e198]:
                - generic [ref=e200]: Cinco
                - button "⚑" [ref=e202]
              - paragraph [ref=e204]: Noted.
            - generic [ref=e207]:
              - generic [ref=e208]:
                - generic [ref=e210]: Eric
                - button "⚑" [ref=e212]
              - paragraph [ref=e214]: "[clock (id=date_d408cf4e, ts=1778482801.6106389, reply_via=clock outbox)] [clock] Date changed: it is now Monday, May 11, 2026."
            - generic [ref=e217]:
              - generic [ref=e218]:
                - generic [ref=e220]: Cinco
                - button "⚑" [ref=e222]
              - paragraph [ref=e224]: Noted.
        - option "Cinco" [selected]
        - option "Jr"
        - option "Q"
        - option "Sr"
        - option "Trip"
        - option "cinco - May 11 - 51.9MB"
        - option "019d1ec0 - May 11 - 51.9MB (live)" [selected]
        - option "019dbc75 - Apr 23 - 6.7KB"
        - option "Cinco" [selected]
        - option "Jr"
        - option "Q"
        - option "Sr"
        - option "Trip"
        - option "grok-4.20-0403-reasoning" [selected]
        - option "Sr"
        - option "Cinco"
        - option "Trip"
        - option "Q" [selected]
        - option "Jr"
        - option "#1 - Mar 24, 12:49 PM (turn 77)"
        - option "#2 - Mar 25, 10:48 AM (turn 12)"
        - option "#3 - Mar 26, 11:17 PM (turn 166)"
        - option "#4 - Mar 29, 10:20 AM (turn 302)"
        - option "#5 - Mar 29, 10:42 PM (turn 467)"
        - option "#6 - Mar 30, 07:28 PM (turn 327)"
        - option "#7 - Apr 1, 09:52 AM (turn 339)"
        - option "#8 - Apr 1, 11:21 AM (turn 306)"
        - option "#9 - Apr 1, 01:28 PM (turn 330)"
        - option "#10 - Apr 1, 01:54 PM (turn 307)"
        - option "#11 - Apr 15, 12:35 PM (turn 313)"
        - option "#12 - Apr 15, 12:38 PM (turn 315)"
        - option "#13 - Apr 15, 07:11 PM (turn 332)"
        - option "#14 - Apr 15, 11:06 PM (turn 355)"
        - option "#15 - Apr 16, 12:43 AM (turn 377)"
        - option "#16 - Apr 16, 09:44 AM (turn 391)"
        - option "#17 - Apr 16, 07:45 PM (turn 421)"
        - option "#18 - Apr 16, 10:10 PM (turn 438)"
        - option "#19 - Apr 17, 12:16 AM (turn 322)"
        - option "#20 - Apr 17, 12:44 AM (turn 330)"
        - option "#21 - Apr 17, 01:18 AM (turn 333)"
        - option "#22 - Apr 17, 02:03 AM (turn 334)"
        - option "#23 - Apr 17, 09:40 AM (turn 368)"
        - option "#24 - Apr 18, 06:14 AM (turn 408)"
        - option "#25 - Apr 18, 07:08 AM (turn 414)"
        - option "#26 - Apr 18, 01:17 PM (turn 449)"
        - option "#27 - Apr 18, 02:45 PM (turn 472)"
        - option "#28 - Apr 18, 06:47 PM (turn 536)"
        - option "#29 - Apr 18, 07:37 PM (turn 551)"
        - option "#30 - Apr 18, 09:18 PM (turn 584)"
        - option "#31 - Apr 18, 10:11 PM (turn 606)"
        - option "#32 - Apr 19, 04:14 AM (turn 633)"
        - option "#33 - Apr 19, 09:09 AM (turn 665)"
        - option "#34 - Apr 19, 09:55 PM (turn 372)"
        - option "#35 - Apr 19, 10:39 PM (turn 358)"
        - option "#36 - Apr 19, 11:10 PM (turn 366)"
        - option "#37 - Apr 20, 12:19 AM (turn 390)"
        - option "#38 - Apr 20, 01:01 PM (turn 367)"
        - option "#39 - Apr 20, 03:04 PM (turn 380)"
        - option "#40 - Apr 20, 10:06 PM (turn 409)"
        - option "#41 - Apr 20, 10:31 PM (turn 410)"
        - option "#42 - Apr 20, 11:04 PM (turn 411)"
        - option "#43 - Apr 21, 11:46 AM (turn 443)"
        - option "#44 - Apr 21, 01:47 PM (turn 388)"
        - option "#45 - Apr 22, 07:30 AM (turn 477)"
        - option "#46 - Apr 22, 06:58 PM (turn 501)"
        - option "#47 - Apr 23, 10:46 PM (turn 374)"
        - option "#48 - Apr 24, 06:59 PM (turn 396)"
        - option "#49 - Apr 24, 10:12 PM (turn 410)"
        - option "#50 - Apr 24, 11:35 PM (turn 465)"
        - option "#51 - Apr 26, 11:46 PM (turn 358)"
        - option "#52 - Apr 27, 12:15 AM (turn 373)"
        - option "#53 - Apr 30, 12:20 PM (turn 391)"
        - option "#54 - Apr 30, 02:22 PM (turn 360)"
        - option "#55 - May 4, 10:22 AM (turn 378)"
        - option "#56 - May 4, 04:53 PM (turn 385)"
        - option "#57 - May 4, 05:31 PM (turn 386)"
        - option "#58 - May 4, 05:51 PM (turn 396)"
        - option "#59 - May 5, 09:38 PM (turn 388)"
        - option "#60 - May 5, 10:09 PM (turn 401)"
        - option "#61 - May 8, 12:09 PM (turn 374)"
        - option "#62 - May 8, 12:48 PM (turn 382)"
        - option "#63 - May 8, 04:00 PM (turn 404)"
        - option "#64 - May 10, 05:29 PM (turn 375)"
        - option "#65 - May 10, 09:37 PM (turn 378)" [selected]
        - option "coding-mix-latest" [selected]
```

# Test source

```ts
  1   | import { test, expect } from "@playwright/test";
  2   | 
  3   | /**
  4   |  * UX tests using the snapshot/act pattern.
  5   |  *
  6   |  * These tests interact with SA the way an agent (or user) would:
  7   |  * read what's visible, act on it, read again to see the result.
  8   |  *
  9   |  * No data-testid, no data-pane-id, no implementation coupling.
  10  |  * Uses ariaSnapshot() for reading and getByRole/getByText for acting.
  11  |  */
  12  | 
  13  | /** Parse message entries from an ariaSnapshot string.
  14  |  *  Messages appear as: sender name line, then paragraph with content. */
  15  | function extractMessages(snapshot: string): { sender: string; text: string }[] {
  16  |   const messages: { sender: string; text: string }[] = [];
  17  |   const lines = snapshot.split("\n");
  18  |   for (let i = 0; i < lines.length; i++) {
  19  |     const line = lines[i].trim();
  20  |     // Sender lines look like: - text: Eric  or  - text: Trip
  21  |     // followed by button "⚑" then paragraph with content
  22  |     if (line.startsWith("- text:") || line.startsWith("text:")) {
  23  |       const sender = line.replace(/^-?\s*text:\s*/, "").trim();
  24  |       if (["Eric", "Trip", "Q", "Sr", "Jr", "Cinco"].includes(sender)) {
  25  |         // Look ahead for paragraph content
  26  |         for (let j = i + 1; j < Math.min(i + 5, lines.length); j++) {
  27  |           const pLine = lines[j].trim();
  28  |           if (pLine.startsWith("- paragraph:") || pLine.startsWith("paragraph:")) {
  29  |             const text = pLine.replace(/^-?\s*paragraph:\s*/, "").replace(/^"|"$/g, "");
  30  |             messages.push({ sender, text: text.slice(0, 120) });
  31  |             break;
  32  |           }
  33  |         }
  34  |       }
  35  |     }
  36  |   }
  37  |   return messages;
  38  | }
  39  | 
  40  | test.describe("Snapshot/Act -- Scroll behavior", () => {
  41  |   test("Scrolling up reveals older messages (not the same ones)", async ({ page }) => {
  42  |     await page.goto("/");
  43  |     // Wait for messages to appear -- an agent would just wait until it sees content
  44  |     await page.waitForTimeout(5000);
  45  | 
  46  |     // SNAPSHOT: What messages can I see right now?
  47  |     const beforeSnapshot = await page.locator("body").ariaSnapshot();
  48  |     const beforeMessages = extractMessages(beforeSnapshot);
  49  | 
  50  |     // Skip if not enough messages to scroll
  51  |     if (beforeMessages.length < 2) {
  52  |       test.skip(true, "Too few messages to test scrolling");
  53  |       return;
  54  |     }
  55  | 
  56  |     // Remember the first message visible (should be near the bottom / most recent)
  57  |     const lastMessageBefore = beforeMessages[beforeMessages.length - 1].text;
  58  | 
  59  |     // ACT: Scroll up with mouse wheel (the way a user does)
  60  |     // Find the conversation area -- an agent would look for where the messages are
  61  |     const messageArea = page.getByText(beforeMessages[0].text).first();
  62  |     await messageArea.hover();
  63  |     for (let i = 0; i < 15; i++) {
  64  |       await page.mouse.wheel(0, -600);
  65  |     }
  66  |     await page.waitForTimeout(2000);
  67  | 
  68  |     // SNAPSHOT: What do I see now?
  69  |     const afterSnapshot = await page.locator("body").ariaSnapshot();
  70  |     const afterMessages = extractMessages(afterSnapshot);
  71  | 
  72  |     // ASSERT: After scrolling up, we should see different messages than before.
  73  |     // If the same last message is still the last visible, scroll had no effect
  74  |     // (snap-back or no content loaded).
  75  |     if (afterMessages.length > 0) {
  76  |       const lastMessageAfter = afterMessages[afterMessages.length - 1].text;
  77  |       // At minimum, the set of visible messages should have changed
  78  |       const beforeTexts = new Set(beforeMessages.map((m) => m.text));
  79  |       const afterTexts = new Set(afterMessages.map((m) => m.text));
  80  |       const overlap = [...afterTexts].filter((t) => beforeTexts.has(t)).length;
  81  |       const totalUnique = new Set([...beforeTexts, ...afterTexts]).size;
  82  | 
  83  |       // If every message after scroll is identical to before, scroll did nothing
  84  |       expect(
  85  |         totalUnique,
  86  |         `Scrolled up but see the same ${overlap} messages. Before: ${beforeMessages.length}, After: ${afterMessages.length}. Scroll may have snapped back.`
> 87  |       ).toBeGreaterThan(beforeTexts.size);
      |         ^ Error: Scrolled up but see the same 5 messages. Before: 12, After: 12. Scroll may have snapped back.
  88  |     }
  89  |   });
  90  | 
  91  |   test("Scroll position holds after mouse wheel up (no snap-back)", async ({ page }) => {
  92  |     await page.goto("/");
  93  |     await page.waitForTimeout(5000);
  94  | 
  95  |     // SNAPSHOT: See what's on screen
  96  |     const initialSnapshot = await page.locator("body").ariaSnapshot();
  97  |     const initialMessages = extractMessages(initialSnapshot);
  98  |     if (initialMessages.length < 2) {
  99  |       test.skip(true, "Too few messages to test scroll stability");
  100 |       return;
  101 |     }
  102 | 
  103 |     // ACT: Scroll up
  104 |     const messageArea = page.getByText(initialMessages[0].text).first();
  105 |     await messageArea.hover();
  106 |     for (let i = 0; i < 5; i++) {
  107 |       await page.mouse.wheel(0, -400);
  108 |     }
  109 |     await page.waitForTimeout(500);
  110 | 
  111 |     // SNAPSHOT: What do I see right after scrolling?
  112 |     const rightAfterSnapshot = await page.locator("body").ariaSnapshot();
  113 |     const rightAfterMessages = extractMessages(rightAfterSnapshot);
  114 | 
  115 |     // Wait 3 seconds (snap-back happens after a delay)
  116 |     await page.waitForTimeout(3000);
  117 | 
  118 |     // SNAPSHOT: What do I see 3 seconds later?
  119 |     const laterSnapshot = await page.locator("body").ariaSnapshot();
  120 |     const laterMessages = extractMessages(laterSnapshot);
  121 | 
  122 |     // ASSERT: The messages visible right after scroll should be the same 3s later.
  123 |     // If they changed, something moved the scroll position (snap-back).
  124 |     if (rightAfterMessages.length > 0 && laterMessages.length > 0) {
  125 |       const afterFirst = rightAfterMessages[0].text;
  126 |       const laterFirst = laterMessages[0].text;
  127 |       expect(
  128 |         laterFirst,
  129 |         `Snap-back detected: right after scroll saw "${afterFirst.slice(0, 60)}...", but 3s later saw "${laterFirst.slice(0, 60)}..."`
  130 |       ).toBe(afterFirst);
  131 |     }
  132 |   });
  133 | });
  134 | 
  135 | test.describe("Snapshot/Act -- Page structure", () => {
  136 |   test("SA shows agent selector, messages, input box, and workbench tabs", async ({ page }) => {
  137 |     await page.goto("/");
  138 |     await page.waitForTimeout(3000);
  139 | 
  140 |     const snapshot = await page.locator("body").ariaSnapshot();
  141 | 
  142 |     // An agent should see these elements in SA:
  143 |     // 1. A heading identifying the app
  144 |     expect(snapshot).toContain('heading "Socratic Arena"');
  145 | 
  146 |     // 2. An agent selector (combobox with agent names)
  147 |     expect(snapshot).toMatch(/combobox[\s\S]*option "Q"/);
  148 | 
  149 |     // 3. Messages with sender names and content
  150 |     const messages = extractMessages(snapshot);
  151 |     expect(messages.length).toBeGreaterThan(0);
  152 | 
  153 |     // 4. An input area to type messages
  154 |     expect(snapshot).toContain('textbox "Type a message..."');
  155 | 
  156 |     // 5. Workbench tabs
  157 |     expect(snapshot).toContain("History");
  158 |     expect(snapshot).toContain("Notebook");
  159 |   });
  160 | 
  161 |   test("Clicking History tab shows history pane with session selector", async ({ page }) => {
  162 |     await page.goto("/");
  163 |     await page.waitForTimeout(3000);
  164 | 
  165 |     // ACT: Click the History tab (by its visible text)
  166 |     await page.getByText("History", { exact: true }).first().click();
  167 |     await page.waitForTimeout(2000);
  168 | 
  169 |     // SNAPSHOT: History pane should now be visible with a session selector
  170 |     const snapshot = await page.locator("body").ariaSnapshot();
  171 |     expect(snapshot).toMatch(/combobox "Select session"/);
  172 |     expect(snapshot).toContain('button "Search"');
  173 |   });
  174 | });
  175 | 
  176 | test.describe("Snapshot/Act -- History search", () => {
  177 |   test("Searching in history shows matching results", async ({ page }) => {
  178 |     await page.goto("/");
  179 |     await page.waitForTimeout(3000);
  180 | 
  181 |     // ACT: Open history tab
  182 |     await page.getByText("History", { exact: true }).first().click();
  183 |     await page.waitForTimeout(2000);
  184 | 
  185 |     // ACT: Click search button
  186 |     await page.getByRole("button", { name: "Search" }).last().click();
  187 |     await page.waitForTimeout(500);
```