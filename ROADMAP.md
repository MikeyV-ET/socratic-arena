# Socratic Arena — Roadmap and Test Plan

**Last updated:** 2026-04-20

## What SA Is

Two things in one:
1. **Collaborative workspace** — agent + mentor work together (conversation, notebook, hosted apps). The daily driver.
2. **Inspection and training-data layer** — every interaction between compaction boundaries is a captured episode. Work itself IS the training data.

---

## Completed Features

### 1. Live Conversation (Phase 1+2)
**What the user sees:** Real-time conversation with the agent. Messages appear as you type them. Agent responses stream in.
**Tested:**
- 14 arena e2e tests (message roundtrip, WebSocket delivery)
- 8 arena roundtrip tests
- Browser-level e2e test (Selenium: type message, click send, verify response in DOM)
- LiveTailer filtering: 24 tests (system doorbells hidden, only human messages shown)

### 2. Session Inspector
**What the user sees:** Browse past conversation sessions, view source, replay moments.
**Tested:** Manual testing. No automated browser tests yet.

### 3. Notebook Pane
**What the user sees:** Agent's notebook entries, scrollable.
**Tested:** Renders from WebSocket state. No dedicated tests.

### 4. Prompt Dev / Prompt Test
**What the user sees:** Edit prompts, run test completions against them.
**Tested:** WebSocket fix (commit 4262e6d). Manual testing.

### 5. Hosted Apps (Panel Architecture)
**What the user sees:** Apps tab in workbench. Launch Chrome, Terminal, or File Manager. Each runs in an iframe. Switch between panels via tabs. Pop out to separate window. Close with X. Survives page refresh.
**Tested:**
- 11 API-level tests (launch, list, close, Selenium DOM read, navigation, presets, port isolation)
- 12 browser-level Selenium tests (click through Apps tab, launch dialog, panel creation, close, refresh survival, pop-out)
- Agent control: demo script connects Selenium via CDP port, reads/navigates DOM

### 6. Streaming Unification
**What the user sees:** Agent's live responses appear in the arena conversation pane in real-time.
**Tested:** Commit 56a76d3. LiveTailer redirects chunks to arena placeholder nodes.

### 7. Workbench Split View
**What the user sees:** Split workbench into two panes (horizontal or vertical), each showing a different tab.
**Tested:** Manual testing only.

---

## In Progress

### 8. Xpra Stability Fixes (uncommitted)
**What the user sees:** File Manager launches without "Xsession" error dialog. Thunar opens cleanly.
**What was wrong:** `--start` triggered full X session wrapper; pcmanfm crashes on Xpra.
**Fix:** `--start-child` + prefer thunar over pcmanfm.
**Test plan:** Update browser test to include file manager launch verification. Manual verification done.

---

## Not Yet Implemented (in priority order)

### 9. Agent Controls a Panel While User Watches
**What the user sees:** Agent launches a Chrome panel, navigates to a page, clicks elements, fills forms — user watches in real-time via the Xpra iframe. Agent actions appear as conversation messages ("I'm navigating to X...").
**Implementation:** Demo script exists (`demo_panel_agent.py`). Needs: integration with arena adapter so agent can request panel launch and get CDP port in response. UI indicator showing "agent is controlling this panel."
**Test plan:**
- API test: agent sends panel launch request via arena, receives CDP port
- Selenium test: agent navigates, verify page content changes
- Browser test: user sees panel update in iframe while agent acts

### 10. Compaction Boundary Browser
**What the user sees:** A timeline or list of compaction boundaries from agent history. Click one to see the compaction summary (the "seed" for that episode). Browse what the agent knew at each boundary.
**Implementation:** Parse session data to extract compaction events. Display as selectable list with summary preview.
**Test plan:**
- Unit test: parser extracts compaction boundaries from updates.jsonl
- API test: endpoint returns list of boundaries with timestamps and summaries
- Browser test: user clicks a boundary, sees summary text

### 11. Correction Authoring UI
**What the user sees:** Select a moment in conversation history. Write structured feedback: "what was missing," "what should have happened," "correction." Saved as training annotation.
**Implementation:** New pane or modal. Data model for corrections (linked to node IDs). Storage and export.
**Test plan:**
- Unit test: correction data model serialization
- API test: create, read, update, delete corrections
- Browser test: user selects a node, opens correction dialog, fills fields, saves, sees it persist

### 12. Parallel Episode Runner
**What the user sees:** Pick a compaction boundary seed. Run N parallel completions from that seed. See them side-by-side. Score each one.
**Implementation:** Extends PromptTestPane concept. Backend spawns multiple completions. Frontend renders comparison view.
**Test plan:**
- API test: submit seed, receive N completions
- Browser test: user sees N columns with different completions, can score each

### 13. Scoring and Training Data Export
**What the user sees:** Export button. Produces JSONL with: prompt prefix, completion, reward score. Ready for GRPO training.
**Implementation:** Aggregate corrections + scores into training format. Export endpoint.
**Test plan:**
- Unit test: export format matches GRPO schema
- API test: export endpoint returns valid JSONL
- Integration test: exported data loads in training pipeline

### 14. Dockable/Closeable Tabs
**What the user sees:** Drag workbench tabs to reorder. Close tabs you don't need. Save/restore layouts.
**Implementation:** Replace fixed tab bar with a docking library (e.g., react-mosaic, flexlayout-react, or custom).
**Test plan:**
- Browser test: drag tab to new position, verify order persists
- Browser test: close tab, verify it disappears
- Browser test: refresh page, verify layout restores

---

## Testing Philosophy

Eric's directive: "For everything you think you've built, define/predict how it will behave from the user's perspective and do everything you can to verify that this is in fact how it behaves from the user's perspective."

Every feature gets three levels of testing:
1. **Unit/API tests** — verify backend logic in isolation
2. **Browser tests** — Selenium clicks through the actual UI, verifies DOM state
3. **Manual walkthrough** — Eric tries it live, reports what he sees

Current test counts:
- 12 browser-level panel tests
- 11 API-level panel tests
- 24 LiveTailer filtering tests
- 14 arena e2e tests
- 8 arena roundtrip tests
- 1 browser e2e closed-loop test
- Various other test files (checkpoint replayer, navigation)
