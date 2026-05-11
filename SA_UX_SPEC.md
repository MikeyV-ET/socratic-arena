# Socratic Arena -- UX Specification

**Owner:** Trip (tests + spec) | **Implementer:** Q
**Created:** 2026-05-08 | **Source:** Eric's requirements via TUI

---

## Priority Levels
- **P0** -- Core user functionality. Must work.
- **P1** -- Important but not foundational.
- **P2** -- Lower priority (apps, cosmetic).

---

## Requirements

### R01 -- History: scroll to bottom on load [P0]

**Current state:** History pane loads data via PaneAgentSelector. No explicit scroll-to-bottom after load.

**Expected behavior:** When the history pane loads (tab switch or agent switch), the view scrolls to the most recent content (bottom). The user sees where they left off, not the beginning.

**Acceptance criteria:**
- [ ] On initial history tab open, scroll position is at bottom
- [ ] On agent switch in history pane, scroll resets to bottom of new agent's data
- [ ] "Jump to latest" button appears if user scrolls up

---

### R02 -- History: searchable [P0]

**Current state:** No search functionality exists in history pane.

**Expected behavior:** User can search within conversation history. Because history uses lazy loading (R06), search requires a backend component -- the frontend can't search what isn't loaded.

**Acceptance criteria:**
- [ ] Search input visible in history pane header
- [ ] Backend endpoint: `GET /api/agent/{name}/history/search?q=<term>` returns matching message IDs with context snippets
- [ ] Clicking a search result scrolls to and highlights that message (loading it if not yet in DOM)
- [ ] Search works across the full history, not just loaded portion
- [ ] Clear/dismiss search returns to previous scroll position

---

### R03 -- Notebook: scroll to bottom on load [P0]

**Current state:** NotebookPane auto-scrolls to active entry when selectedNodeId changes, but doesn't scroll to bottom on initial load.

**Expected behavior:** When notebook tab opens or agent switches, scroll to the most recent (bottom) entry.

**Acceptance criteria:**
- [ ] On initial notebook tab open, scroll position is at bottom
- [ ] On agent switch, scroll resets to bottom of new agent's notebook

---

### R04 -- Notebook: searchable [P0]

**Current state:** No search functionality.

**Expected behavior:** User can search notebook entries (titles and content). Same lazy-loading consideration as R02.

**Acceptance criteria:**
- [ ] Search input visible in notebook pane header
- [ ] Backend endpoint: `GET /api/agent/{name}/notebook/search?q=<term>` returns matching entry IDs with snippets
- [ ] Clicking a result scrolls to and highlights that entry
- [ ] Search spans full notebook, not just loaded portion
- [ ] Clear search returns to previous position

---

### R05 -- Scrollbar position accuracy [P0]

**Current state:** Both panes use `@tanstack/react-virtual`. Virtual scrollbar height is based on `estimateSize * count`, which can drift from reality as items are measured.

**Expected behavior:** The browser scrollbar (right side) gives a reasonable position estimate. When only a fraction of content is loaded (lazy loading), the scrollbar still reflects approximate position in the total content.

**Acceptance criteria:**
- [ ] Scrollbar thumb position roughly corresponds to position in full content
- [ ] Backend provides total item count metadata so virtualizer can set correct total height
- [ ] Scrolling to ~50% of the scrollbar lands near the middle of the full content

---

### R06 -- Lazy loading for history and notebook [P0]

**Current state:** History loads entire agent data via `PaneAgentSelector.onDataLoaded`. This caused the 843MB parse problem. Notebook loads all entries at once.

**Expected behavior:** Load only recent content (tail) initially. Load older content on demand as user scrolls up. Same pattern as the TUI.

**Acceptance criteria:**
- [ ] Initial load fetches only the most recent N items (e.g., last 100 messages / 50 notebook entries)
- [ ] Scrolling to the top triggers loading of the next batch of older items
- [ ] Loading indicator shown while fetching older content
- [ ] Backend endpoints support pagination: `?before=<id>&limit=N`
- [ ] Total count available for scrollbar accuracy (R05)

---

### R07 -- Agent-driven search and focus [P0]

**Current state:** Backend can send `workspace.navigate` via WebSocket. `scrollTargetId` mechanism exists for cross-pane navigation.

**Expected behavior:** The agent can search history and notebook, then navigate the user's view to specific results. The agent sends a command, the frontend loads the relevant section (if not loaded) and scrolls to it.

**Acceptance criteria:**
- [ ] WebSocket message type `workspace.navigate` with `{pane: "history"|"notebook", targetId: "<id>"}` scrolls the user's view
- [ ] If the target isn't loaded yet (lazy loading), it gets loaded first, then scrolled to
- [ ] Agent can trigger search via `workspace.search` message type
- [ ] Highlighted result is visually distinct (temporary highlight animation)

---

### R08 -- Full text output [P0]

**Current state:** Conversation pane shows `node.content` (with streaming). History pane shows the same data from parsed history.

**Expected behavior:** Both panes show ALL intermediate text the agent produces, including text emitted before/between tool calls during a logical turn. Not just the final response.

**Acceptance criteria:**
- [ ] Intermediate text (mid-tool-chain) appears in conversation pane as it's produced
- [ ] History pane shows the same intermediate text when viewing past sessions
- [ ] Tool call boundaries are visually indicated (but text is not hidden)

---

### R09 -- Remove Fork button from conversation pane [P0]

**Current state:** `ForkButton` rendered in Message.tsx line 83 when `!readOnly`.

**Expected behavior:** Fork button not visible in the conversation pane. May remain available in history/inspection views.

**Acceptance criteria:**
- [ ] No fork button visible on any message in the live conversation pane
- [ ] Fork button still available in read-only/history views if needed for inspection

---

### R10 -- Remove Edit/Correction button from conversation pane [P0]

**Current state:** `CorrectionButton` rendered in Message.tsx line 84 when `!readOnly`.

**Expected behavior:** Correction button not visible in the live conversation pane.

**Acceptance criteria:**
- [ ] No correction/edit button visible on messages in the live conversation pane

---

### R11 -- Keep Flag button in conversation pane [P0]

**Current state:** `FlagButton` rendered in Message.tsx line 85, always visible (not gated by readOnly).

**Expected behavior:** Flag button remains on all messages. This is the core Socratic moment capture interaction.

**Acceptance criteria:**
- [ ] Flag button visible on hover for every message in conversation pane
- [ ] Clicking flag creates a training candidate marker
- [ ] Flag persists visually after being set

---

### R12 -- Pane close button size: 1.5x [P2]

**Current state:** Close (X) buttons on workbench tab panes are default size.

**Expected behavior:** Close buttons are ~1.5x their current size for easier clicking.

**Acceptance criteria:**
- [ ] Pane close button click target is at least 1.5x previous dimensions
- [ ] Visual size increase is proportional

---

### R13 -- App sub-panel close button size: 2x [P2]

**Current state:** Close buttons inside the hosted apps (Xpra) panel are small.

**Expected behavior:** App sub-panel close buttons are ~2x current size.

**Acceptance criteria:**
- [ ] App panel close buttons are visually ~2x previous size
- [ ] Click target matches visual size

---

### R14 -- Chrome: disable system title bar [P2]

**Current state:** Chrome launched in Xpra panels may show system title bar and borders.

**Expected behavior:** Chrome launched with `--use-system-title-bar=false` or equivalent, maximizing usable viewport.

**Acceptance criteria:**
- [ ] Chrome panel has no system title bar visible
- [ ] Full panel area is usable browser viewport

---

### R15 -- Other apps: no title bar if possible [P2]

**Current state:** Terminal, file manager may show title bars in Xpra panels.

**Expected behavior:** Where possible, hosted apps launch without title bars to maximize viewport.

**Acceptance criteria:**
- [ ] Apps launch in borderless/frameless mode where supported
- [ ] Graceful fallback for apps that require title bars

---

### R16 -- Flag notes: add a note when flagging [P0]

**Current state:** Clicking the flag button (⚑) immediately creates a flag with no note. The `Flag` data model already supports a `note` field (backend + frontend), and auto-flagged moments include notes, but manual flags from FlagButton and EntryFlagButton send no note.

**Expected behavior:** When the user clicks the flag button, a small input appears (inline popover or expandable field) where they can type a short note explaining why they flagged this turn. The note helps when reviewing flags later. Submitting the note (Enter or a confirm button) creates the flag with the note attached. The note should be visible when hovering or viewing the flag.

**Acceptance criteria:**
- [ ] Clicking the flag button opens a note input (popover, inline, or modal -- lightweight)
- [ ] User can type a note and submit (Enter or confirm button)
- [ ] Flag is created with the note via `flag.create` payload including `note` field
- [ ] Submitting with an empty note creates the flag without a note (preserves quick-flag workflow)
- [ ] Pressing Escape or clicking away cancels without flagging
- [ ] Existing flag notes are visible (tooltip on hover, or displayed near the flag indicator)
- [ ] Flag notes appear in both chat and history panes (synced like the flag itself)
- [ ] Flag notes are persisted (survive page reload via flags.json)
- [ ] EntryFlagButton in notebook pane also supports notes

---

## Test Infrastructure

Tests use **Playwright** (already configured in `frontend/playwright.config.ts`).

Existing tests: 5 smoke tests in `frontend/tests/smoke.spec.ts`.

New tests will be added as `frontend/tests/ux-*.spec.ts` files, one per requirement group.

## Revision History

| Date | Author | Change |
|------|--------|--------|
| 2026-05-08 | Trip | Initial spec from Eric's requirements (Batch 1-2) |
| 2026-05-11 | Trip | R16: Flag notes (Eric's request via TUI) |
