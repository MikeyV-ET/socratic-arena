# Socratic Arena — System Documentation

**Last updated:** 2026-04-12
**Authors:** Bishop (frontend), Rook (backend)

---

## 1. What This Is

A web-based workspace where a domain expert (PI) and an AI agent collaborate on real research. The system captures Socratic correction moments — where a short question from the PI reveals a gap the model already had everything to close — and transforms them into GRPO training data.

The core claim: frontier models have the capability to catch their own hidden assumptions but lack spontaneous activation. A 5-word question activates what was already there. RLHF can't see this signal because the model's outputs look confident and correct. GRPO can train on the variance between catching and missing.

---

## 2. Architecture Overview

```
┌──────────────────────────────────────────────────────────┐
│  Browser (React, port 5173 dev / served from port 8000)  │
│                                                          │
│  ┌─────────────────┐  ┌──────────────────────────────┐   │
│  │ ConversationPane│  │  Workbench (tabbed)           │   │
│  │ (left, always)  │  │  History | Notebook |         │   │
│  │                 │  │  Prompt Dev | Prompt Test |   │   │
│  │  InputBar       │  │  Artifact                    │   │
│  └────────┬────────┘  └──────────────┬───────────────┘   │
│           │           WebSocket      │                   │
│           └──────────────┬───────────┘                   │
└──────────────────────────┼───────────────────────────────┘
                           │ ws://host/path/ws
┌──────────────────────────┼───────────────────────────────┐
│  FastAPI (Python, port 8000)                             │
│                                                          │
│  WebSocket handler  ──  REST endpoints  ──  Static files │
│         │                                                │
│  ┌──────┴──────────┐   ┌───────────────┐                 │
│  │  In-memory state │   │ grok agent    │                 │
│  │  (StateSnapshot) │   │ stdio process │                 │
│  └─────────────────┘   └───────────────┘                 │
│         │                     │                          │
│  ┌──────┴──────────┐   ┌─────┴──────────┐               │
│  │  Session parser  │   │  updates.jsonl  │               │
│  │  Updates parser  │   │  (grok session)  │              │
│  │  Notebook parser │   └────────────────┘               │
│  └─────────────────┘                                     │
└──────────────────────────────────────────────────────────┘
```

### Two-pane layout

- **Left pane (40%):** Live conversation with the agent. Always visible. This is the collaborator, not a tool.
- **Right pane (60%):** Tabbed workbench. Everything the PI and agent examine together. Tabs: History, Notebook, Prompt Dev, Prompt Test, Artifact. Splittable horizontally or vertically.

Both the user and the agent can control the right pane (switch tabs, scroll to content, populate editors). Agent control is visible — like a colleague operating the interface.

### Data flow

1. User types in the left pane → WebSocket `conversation.send` → backend creates user node + spawns agent response
2. Agent streams response → `conversation.chunk` / `conversation.thinking` → `conversation.turn_complete`
3. All state changes broadcast as `state.snapshot` to all connected clients
4. Backend state is in-memory (`StateSnapshot`), populated on startup from `updates.jsonl`

### Single source of truth

`updates.jsonl` is the canonical record. Both panes read from it:
- Left pane = tail (live, growing with each turn)
- Right pane (History tab) = full file (browsable)

The agent (knight-bio) is bound to a persistent grok session. The Arena connects to it, doesn't create/destroy it.

---

## 3. File Structure

```
/projects/workspace/
├── AGENTS.md              # Root agent instructions (shared context)
├── DESIGN.md              # Interface contract (data shapes, WebSocket API)
├── SYSTEM.md              # This file
├── lab_notebook.md         # Rook's lab notebook
│
├── frontend/              # React app (Bishop's territory)
│   ├── src/
│   │   ├── App.tsx                          # Root: Header + PanelLayout + useWebSocket
│   │   ├── main.tsx                         # React entry point
│   │   ├── index.css                        # Tailwind v4 theme (Berkeley palette)
│   │   ├── types/index.ts                   # All TypeScript interfaces from DESIGN.md
│   │   ├── stores/arenaStore.ts             # Zustand store (all state + actions)
│   │   ├── hooks/useWebSocket.ts            # WebSocket connection, message routing, reconnect
│   │   ├── data/mockData.ts                 # Offline demo data (not used by default)
│   │   └── components/
│   │       ├── layout/
│   │       │   ├── Header.tsx               # Title, segment picker, branch picker, connection status
│   │       │   ├── PanelLayout.tsx           # Two-column: conversation | workbench
│   │       │   └── ArtifactPane.tsx          # Iframe for reveal.js presentation
│   │       ├── conversation/
│   │       │   ├── ConversationPane.tsx      # Message list + scroll management + InputBar
│   │       │   ├── Message.tsx              # Single message (markdown, thinking toggle, flags)
│   │       │   ├── InputBar.tsx             # Text input + send
│   │       │   ├── FlagButton.tsx           # Toggle training candidate flag on a node
│   │       │   └── ForkButton.tsx           # Fork conversation from a node
│   │       ├── workbench/
│   │       │   └── Workbench.tsx            # Tabbed right pane with split support
│   │       ├── notebook/
│   │       │   └── NotebookPane.tsx         # Lab notebook entries with click-to-navigate
│   │       ├── prompt/
│   │       │   ├── PromptDevPane.tsx        # Prompt editor (system/user prompt, expected/failure)
│   │       │   └── PromptTestPane.tsx       # Run prompts against models, variance scoring
│   │       └── tree/
│   │           └── TreeView.tsx             # d3 tree visualization (shelved from main layout)
│   ├── dist/                                # Built output (served by backend)
│   ├── vite.config.ts                       # base: './' for proxy-safe paths
│   └── package.json
│
├── backend/               # FastAPI app (Rook's territory)
│   ├── main.py                              # FastAPI app, WebSocket handler, REST endpoints
│   ├── models.py                            # Pydantic models (CamelModel base for auto camelCase)
│   ├── agent_stdio.py                       # AsyncIO wrapper for grok agent stdio subprocess
│   ├── session_parser.py                    # Claude Code JSONL → ConversationTree
│   ├── updates_parser.py                    # updates.jsonl → ConversationTree
│   ├── notebook_parser.py                   # Markdown → NotebookEntry list (auto-tagging)
│   ├── cc_to_updates.py                     # Claude Code JSONL → updates.jsonl converter
│   ├── demo_dataset.py                      # 6 curated Socratic correction moments
│   ├── mock_data.py                         # Original mock data (fallback)
│   ├── moment_scanner.py                    # Automated candidate moment detection
│   ├── artifacts/
│   │   └── demo_presentation.html           # 10-slide reveal.js presentation
│   ├── data/
│   │   ├── candidate_moments.json           # 139 candidate moments from scanner
│   │   ├── moment_node_mappings.json        # Mapped to tree node IDs
│   │   ├── verified_moments.json            # Agent-verified moments
│   │   ├── socratic_moments.json            # Confirmed Socratic moments
│   │   └── test_runs.json                   # Persisted prompt test results
│   ├── tests/
│   │   └── test_arena_e2e.py                # 6 end-to-end tests
│   └── requirements.txt
│
├── agents/                # Agent sessions and configuration
│   ├── bishop/            # Frontend agent (this agent)
│   │   ├── AGENTS.md
│   │   ├── lab_notebook.md
│   │   └── asdaaas/       # Agent runtime state
│   ├── rook/              # Backend agent
│   │   ├── AGENTS.md
│   │   └── asdaaas/
│   ├── knight-bio/        # The research agent (Sixel's distilled history)
│   │   ├── AGENTS.md
│   │   ├── lab_notebook.md
│   │   └── updates.jsonl  # 5,617 entries from desire detection work
│   └── launch_arena.sh    # Launch asdaaas for all agents
│
├── agentabide/            # Multi-agent infrastructure (from MikeyV-Sr)
│   ├── core/
│   │   ├── asdaaas.py     # Agent orchestrator
│   │   ├── asdaaas_config.py
│   │   └── config.json
│   ├── adapters/
│   │   ├── localmail.py   # Inter-agent messaging
│   │   └── tui_adapter.py # Terminal UI for human interaction
│   └── ops/
│       └── arena_agents.json
│
└── sixel-as-a-scientist-in-training/  # Source research data
    ├── sixel-bio-session.jsonl         # 32,100 lines, full Claude Code session
    ├── sixel-desire-notebook.md        # 2,255 lines, research lab notebook
    ├── interaction_traces.md           # 3 worked Socratic correction examples
    └── eval_methodology.md             # 6-step verification process
```

---

## 4. WebSocket Protocol

All communication between frontend and backend uses WebSocket at `ws://host/path/ws`.

### Client → Server

| Type | Payload | Description |
|------|---------|-------------|
| `state.sync` | `{}` | Request full state snapshot |
| `conversation.send` | `{branchId, content}` | Send a message |
| `branch.create` | `{fromNodeId, label?}` | Fork from a node |
| `branch.switch` | `{branchId}` | Switch active branch |
| `flag.create` | `{nodeId, note?}` | Flag a node as training candidate |
| `flag.delete` | `{flagId}` | Remove a flag |
| `prompt.create` | `{flagId, sourceNodeId}` | Create training prompt from flag |
| `prompt.update` | `{promptId, fields}` | Update prompt fields |
| `prompt_test.run` | `{promptId, n, model}` | Test prompt against model n times |
| `notebook.get` | `{}` | Request notebook data |
| `tree.window` | `{centerNodeId, radius, expandedBranches}` | Request windowed tree view |
| `tree.stats` | `{}` | Request tree statistics |

### Server → Client

| Type | Payload | Description |
|------|---------|-------------|
| `state.snapshot` | `{tree, notebook, prompts, artifacts}` | Full state (sent on connect + after mutations) |
| `conversation.chunk` | `{nodeId, content, done?}` | Streaming agent response text |
| `conversation.thinking` | `{nodeId, content}` | Streaming agent thinking |
| `conversation.turn_complete` | `{nodeId}` | Agent turn finished |
| `flag.created` | `{flag}` | Flag was created |
| `notebook.data` | `{notebook}` | Notebook entries |
| `tree.window` | `{nodes, collapsedBranches, stats}` | Windowed tree data |
| `tree.stats` | `{totalNodes, totalBranches, totalFlags, timeRange}` | Tree statistics |
| `workspace.navigate` | `{tab?, scrollTo?, populate?}` | Agent controls workbench |
| `layout.update` | `{panels: {name: size}}` | Agent resizes panels |

### Agent Workspace Control

The agent can control the right pane through `workspace.navigate`:

```json
// Switch tab
{"type": "workspace.navigate", "payload": {"tab": "history"}}

// Scroll to a conversation node
{"type": "workspace.navigate", "payload": {"tab": "history", "scrollTo": "node-id"}}

// Populate the prompt editor
{"type": "workspace.navigate", "payload": {"tab": "prompt-dev", "populate": {
  "systemPrompt": "...", "userPrompt": "...",
  "expectedBehavior": "...", "failureBehavior": "..."
}}}
```

---

## 5. REST Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/health` | Health check |
| GET | `/api/tree` | Full conversation tree |
| GET | `/api/tree/node/{id}` | Single node |
| GET | `/api/flags` | All flags |
| GET | `/api/prompts` | All training prompts |
| GET | `/api/prompts/{id}` | Single prompt |
| GET | `/api/notebook` | Notebook entries |
| GET | `/api/artifacts` | Artifact list |
| GET | `/api/artifacts/{id}/content` | Serve artifact content |
| GET | `/api/artifacts/presentation` | Serve reveal.js presentation |
| GET | `/api/models` | Available xAI models (proxied from api.x.ai) |
| GET | `/api/test-runs` | All persisted prompt test runs |
| GET | `/api/session/segments` | Session segment metadata (42 segments) |
| POST | `/api/session/load-segment` | Load a specific segment |
| POST | `/api/session/load` | Load from JSONL with filters |
| POST | `/api/session/load-updates` | Load from updates.jsonl |
| POST | `/api/session/demo` | Load curated demo dataset |
| POST | `/api/session/reset` | Reset to mock data |
| POST | `/api/agent/start` | Start grok agent stdio |
| POST | `/api/agent/stop` | Stop agent |
| GET | `/api/agent/status` | Agent process status |

---

## 6. State Management (Frontend)

Zustand store (`arenaStore.ts`) holds all application state:

### Core Data
- `tree: ConversationTree` — nodes, branches, active branch/node
- `notebook: Notebook` — lab notebook entries
- `prompts: TrainingPrompt[]` — training prompts with test results
- `artifacts: Artifact[]` — presentations, writeups

### UI State
- `selectedNodeId` — currently focused node (gold indicator in conversation)
- `scrollTargetId` — node to scroll to (set by tree click or cross-pane navigation)
- `scrollTrigger` — reactive counter for auto-scroll-to-bottom
- `activeTab` — active workbench tab (history, notebook, prompt-dev, prompt-test, artifact)
- `splitTab` — second tab when workbench is split (null = no split)
- `streamingNodeId / streamingContent / streamingThinking` — live streaming state

### Prompt Draft
- `promptDraft` — editable state for prompt dev editor, populatable by agent via WebSocket

### Connection
- `connected: boolean` — WebSocket connection status
- `sendWs` — function to send WebSocket messages (null when disconnected)

### Key Actions
- `getActiveBranchNodes()` — walks the tree to get ordered nodes for the active branch
- `switchBranch(id)` — switches branch and notifies backend
- `scrollToNode(id)` — sets selectedNodeId + scrollTargetId for cross-pane navigation
- `triggerScrollToBottom()` — increments scrollTrigger to force scroll-to-bottom
- `finalizeStream(id)` — merges streaming content into tree node
- `populatePromptDraft(fields)` — agent populates prompt editor fields

---

## 7. Key Frontend Components

### ConversationPane
The left pane. Renders ordered messages for the active branch. Features:
- `readOnly` prop — hides InputBar (used in History tab on the right)
- Auto-scroll to bottom on new content, agent turns, and data source changes
- Respects user scroll position (won't auto-scroll if user scrolled up)
- IntersectionObserver tracks which message is visible (updates tree selection)
- Observer gated behind `userScrolling` ref to prevent feedback loops from programmatic scrolls
- Gold left border + warm background on selected message

### Workbench
The right pane. Tabbed interface with 5 tabs. Features:
- Split mode: divides into two panels, each with its own tab bar
- Split direction: horizontal (stacked) or vertical (side-by-side)
- Tab switching controlled by both user clicks and agent WebSocket messages

### Message
Individual message rendering. Features:
- Markdown via react-markdown + remark-gfm (tables, strikethrough, task lists)
- Collapsible thinking section
- Flag badges with "Develop prompt" button
- Fork button (creates new branch from this message)
- Role display: "Eric" for user, agent label for assistant

### PromptDevPane
Prompt editor for crafting training prompts from flagged moments. Features:
- Monospace text editors for system prompt, user prompt
- Side-by-side expected/failure behavior editors
- Source moment card (clickable, navigates to source in conversation)
- Agent-populatable via `promptDraft` store state
- Save sends `prompt.update` via WebSocket

### PromptTestPane
Tests prompts against models to verify failure reproduction. Features:
- Model selector (fetches all models from xAI API)
- n slider (how many test runs)
- Progress bar during testing
- Results grid: each run shows pass/fail with completion text
- Summary stats: caught/missed counts, average reward
- Variance meter with ideal zone indicator
- Run history persisted across tests

### Header
Top bar with:
- "Socratic Arena" title
- Active branch label
- Segment picker (42 segments from sixel-bio session)
- Connection status indicator (green dot = live, red = disconnected)

---

## 8. Backend Components

### main.py
FastAPI application. Handles:
- WebSocket endpoint with message routing for all protocol types
- REST endpoints for data access
- State management (in-memory StateSnapshot)
- Agent subprocess management (grok agent stdio)
- Static file serving for built frontend

### models.py
Pydantic models with `CamelModel` base class. Auto-serializes Python snake_case to JSON camelCase. All 13 data shapes from DESIGN.md.

### agent_stdio.py
AsyncIO wrapper for `grok agent stdio` subprocess:
- JSON-RPC 2.0 handshake (initialize → notifications/initialized → session/new)
- `prompt()` async iterator yields text/thinking chunks and tool calls
- Manages session lifecycle, prevents concurrent prompts

### session_parser.py
Parses Claude Code session JSONL into ConversationTree:
- Handles thinking block merging (Claude Code stores thinking as separate entries)
- Time/UUID-based windowing
- Tool-only entry filtering
- Segment discovery (42 compaction-bounded segments)
- Iterative tree building (handles 4000+ node segments without recursion)

### updates_parser.py
Parses grok updates.jsonl into ConversationTree:
- Groups consecutive chunks from same turn into single nodes
- Handles compaction checkpoints
- Labels nodes based on live session ID (Sixel vs Knight)

### notebook_parser.py
Parses markdown lab notebooks into NotebookEntry objects:
- Splits on `## ` headers
- Auto-tags via regex (12 categories: socratic-moment, hidden-assumption, grpo, etc.)
- 33 entries from sixel-desire-notebook.md

### moment_scanner.py
Automated candidate moment detection:
- Scans for pattern: short user probe (< 150 chars) → long assistant response (> 300 chars)
- Builds A/B prompt pairs for testing
- 139 candidates identified in desire detection subset

### demo_dataset.py
6 curated Socratic correction moments with conversation nodes, flags, and training prompts.

---

## 9. Deployment

### Build
```bash
cd /projects/workspace/frontend && npm run build
```
Output goes to `frontend/dist/`. Backend serves it as static files. No restart needed.

### Run backend
```bash
cd /projects/workspace/backend && uvicorn main:app --host 0.0.0.0 --port 8000
```

### Preview URL
```
https://autoqa.teachx.ai/hackathon/preview/eric-terry/
```
Proxied through hackathon infrastructure to port 8000 on this container.

### Proxy-safe URLs
All WebSocket and API URLs derived from `window.location.pathname`:
```typescript
const basePath = window.location.pathname.replace(/\/+$/, "");
const WS_URL = `${wsProto}//${window.location.host}${basePath}/ws`;
```
Works under any URL prefix (direct localhost or proxied path).

---

## 10. Visual Design

Berkeley palette (Eric's direction: "UC Berkeley style"):
- **Primary:** Berkeley blue (#1e4976)
- **Accent:** California gold (#c4943a) — used for flags, warnings, focused turns
- **Success:** Muted teal (#3a8a6e) — agent messages
- **Destructive:** Terracotta (#b04a3a)
- **Background:** Deep midnight navy (#0b1120)
- **Typography:** Inter (UI) + JetBrains Mono (code/prompts)

---

## 11. Agent Infrastructure

### Asdaaas
Agent orchestrator from MikeyV-Sr. Manages agent sessions, adapters, inter-agent communication.

### Localmail
Inter-agent messaging system. Agents communicate asynchronously:
```python
from localmail import send_mail, read_mail
send_mail(from_agent='bishop', to_agent='rook', text='message')
msgs = read_mail('bishop')
```

### Agents
- **Rook:** Backend engineer. Owns `backend/`, `data/`, design doc, lab notebook.
- **Bishop:** Frontend engineer. Owns `frontend/`.
- **Knight-bio:** Research agent. Sixel's distilled history from desire detection work. Bound to persistent grok session with 5,617 updates.jsonl entries.

---

## 12. What's Built

### Complete
- Two-pane layout (conversation + tabbed workbench)
- Full WebSocket protocol (14+ message types)
- Conversation rendering with markdown, thinking, flags, forks
- Virtualized message list (@tanstack/react-virtual, ~30 DOM nodes vs 1189)
- Cross-pane navigation (click flag / moment / notebook entry navigates across panes)
- Training pipeline: flag → develop prompt → test against model → variance scoring
- Session segment loading (42 segments from real research data)
- Lab notebook integration (33 entries, auto-tagged)
- Artifact pane (reveal.js presentation)
- Agent workspace control (tab switching, scrolling, prompt population)
- Agent REST bridge (POST /api/agent/action for knight-bio curl access)
- Viewport tracking (closed loop: frontend reports scroll/click/tab changes to backend)
- Activity indicator (thinking/writing status with auto-timeout and dismiss)
- Live streaming display in messages (progressive content with pulsing cursor)
- Workbench tab scroll preservation (all tabs stay mounted, CSS visibility)
- Workbench split (horizontal/vertical)
- Auto-growing textarea with Shift+Enter for newlines
- File attachment upload (multi-file, base64 encoding, removable chips)
- Auto-scroll to bottom on agent turns
- GFM markdown tables
- Prompt test persistence
- Light/dark theme toggle (persisted in localStorage)
- Per-pane font size controls (CSS zoom)
- grok agent stdio integration
- Inter-agent communication (localmail)
- Playwright test suite (23 tests: smoke, UI, tab navigation, agent interaction)

### Remaining
- File attachment backend handling (frontend sends base64, backend needs to save/forward)
- updates.jsonl as live data source for both panes (architecture defined, wiring in progress)
- Tree visualization as a workbench tab (shelved from main layout, component exists)
- Video narrative preparation (3 minutes, for Diego Pasini / Elon Musk)