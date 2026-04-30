# Socratic Arena

A collaborative workspace where AI agents and human mentors work together, with built-in tools for inspecting interactions, testing principle changes, and generating GRPO training data.

## What It Is

Socratic Arena is two things in one:

1. **A collaborative workspace** -- agents and mentors share a conversation, notebook, hosted applications, and artifacts. The daily driver for actual work.
2. **An inspection and training layer** -- the workspace interactions are captured data. Moments can be flagged, corrections authored, and parallel sessions run from compaction boundaries to validate principle changes and generate GRPO training signal.

The workspace produces the data. The inspection tools mine it. Same tool, two modes.

## Quick Start

```bash
# Clone and enter
git clone git@github.com:MikeyV-ET/socratic-arena.git
cd socratic-arena

# Backend
cd backend
pip install -r requirements.txt
cd ..

# Frontend
cd frontend
npm install
cd ..

# Launch everything (backend + frontend + adapter)
bash backend/launch_arena.sh Q

# Open in browser
# Frontend: http://localhost:5173
# Backend:  http://localhost:8000
```

To stop:
```bash
bash backend/launch_arena.sh --stop
```

## Architecture

```
Browser (React/Vite, port 5173)
  |
  |-- WebSocket (/ws) -- live conversation, streaming, live tailer
  |-- REST (/api/*) -- agents, notebooks, moments, corrections, panels, export
  |-- Xpra proxy (/api/panel/{id}/proxy/*) -- same-origin hosted app access
  |
FastAPI Backend (backend/main.py, port 8000)
  |-- In-memory state (conversation tree, notebook, prompts, corrections)
  |-- LiveTailer (streams agent session updates to arena)
  |-- PanelManager (Xpra lifecycle, hosted application panels)
  |-- Prompt test engine (GRPO parallel episode runner)
  |-- Compaction boundary browser (checkpoint catalog)
  |-- Training data export (GRPO JSONL)
  |-- HTTP+WS reverse proxy for Xpra panels
  |
Arena Adapter (backend/arena_adapter.py)
  |-- Polls backend for pending user messages
  |-- Writes to agent's asdaaas adapter inbox
  |-- Reads agent responses from adapter outbox
  |-- POSTs responses back to backend
  |
asdaaas (agent runtime, separate process)
  |-- Manages agent lifecycle, compaction, doorbells
  |-- Routes messages between adapters
```

## Project Structure

```
socratic-arena/
  backend/
    main.py              # FastAPI app, WebSocket, all REST endpoints, Xpra proxy
    arena_adapter.py     # Bridges arena <-> asdaaas agents (polls pending, relays responses)
    live_tailer.py       # Streams updates.jsonl to arena in real-time
    panel_manager.py     # Xpra lifecycle management (launch, stop, port/display allocation)
    agent_panel.py       # Agent-side panel interaction (Selenium CDP toolkit)
    models.py            # Pydantic models (CamelCase serialization)
    updates_parser.py    # Parses grok session updates.jsonl into tree
    notebook_parser.py   # Parses markdown lab notebooks
    shared_docs.py       # Shared collaborative editor (Yjs/pycrdt, file browser, REST API)
    session_parser.py    # Parses legacy session formats
    compaction_parser.py # Extracts compaction boundaries from session data
    checkpoint_replayer.py # Replays from compaction checkpoints
    corrections.py       # Correction CRUD and storage
    training_export.py   # GRPO training data export (JSONL)
    moment_scanner.py    # Scans sessions for candidate Socratic moments
    artifact_renderer.py # Renders markdown slides to HTML
    replay_router.py     # Routes replayed messages
    agent_stdio.py       # AsyncIO wrapper for grok agent stdio (historical, not used in live operation)
    demo_panel_agent.py  # Demo: agent controls a panel via Selenium
    launch_arena.sh      # Launches all components (backend + frontend + adapter, detached)
    requirements.txt     # Python dependencies
  frontend/
    src/
      App.tsx              # Root layout
      stores/arenaStore.ts # Zustand state management
      hooks/useWebSocket.ts # WebSocket connection + message routing + panel restore
      types/index.ts       # TypeScript interfaces
      components/
        conversation/      # ConversationPane, Message, InputBar, CorrectionButton, FlagButton, ForkButton
        editor/            # SharedEditorPane (collaborative editor, file browser, WYSIWYG, author colors)
        notebook/          # NotebookPane (lab notebook viewer)
        prompt/            # PromptTestPane, PromptDevPane
        workbench/         # Workbench (tabbed right panel), MomentsPane, CorrectionsPane,
                           # BoundariesPane, EpisodeRunnerPane
        layout/            # Header, PanelLayout, ArtifactPane, HostedAppPane (Xpra panels)
        inspector/         # SessionInspector
        tree/              # TreeView (branch visualization)
        common/            # FontSizeControl, PaneAgentSelector
    vite.config.ts         # Proxies /api (HTTP+WS) and /ws to backend
    package.json
  tests/                   # Cross-cutting browser-level tests
    test_roundtrip_e2e.py
    test_browser_rendering.py
    test_browser_with_delay.py
    test_livetailer_interference.py
    test_ws_sequence.py
  DESIGN.md              # System design document
  DESIGN_shared_editor.md # Shared collaborative editor design
  ROADMAP.md             # Feature roadmap and test plan
  SYSTEM_HACKATHON.md    # Archived hackathon-era system doc
  launch.sh              # Legacy launcher
  _backup_mvp/           # Archived Phase 1/2 code
```

## Key Concepts

- **Episodes**: The session between two compaction boundaries. Each episode is a self-contained unit of agent-mentor interaction. This is the natural unit for capture, replay, and training.
- **Moments**: Points within an episode where the agent made a choice that could have gone differently. Can be auto-detected or manually flagged. These are the test cases for both GRPO training and AGENTS.md iteration.
- **Compaction Boundaries**: The only points where agent state is cleanly captured and reproducible. Agent state mid-session is the entire context window (not portable). At a compaction boundary, state collapses to a compact text artifact (the compaction summary). These are the isolation points for episodes.
- **Parallel Sessions**: Start N independent sessions from the same compaction checkpoint with modified instructions. Each session is a sample of what the agent would do differently.
- **Compaction Checkpoints**: The grok binary stores checkpoints at each compaction boundary (`~/.grok/sessions/.../compaction_checkpoints/`). Each checkpoint contains the full conversation state (system prompt, compacted history, user info, file paths) -- everything needed to seed a parallel session.
- **Corrections**: Structured annotations on conversation nodes. Three fields: what was missing, what should have happened, correction text. These become training signal.
- **Hosted Panels**: Desktop applications (Chrome, terminal, file manager) hosted via Xpra and embedded as iframes. Human sees pixels via Xpra HTML5 client; agent controls via Selenium/CDP. Same application, different interfaces.
- **Training Data Export**: GRPO-format JSONL export combining corrections (reward=0) and episode scores (normalized 0-1).
- **Shared Editor**: Real-time collaborative document editor (Yjs/pycrdt). Supports WYSIWYG markdown, author coloring, agent-initiated line highlighting. Can open files from disk and save back.
- **Live Tailer**: Streams the agent's real-time session activity into the arena. Filters arena turns to prevent dual delivery.
- **Arena Adapter**: Bridges arena UI messages to asdaaas agents via the standard inbox/outbox filesystem protocol.
- **Arena Chat Persistence**: Conversation nodes stored in `arena_chat.jsonl` sidecar file, surviving backend restarts.

## REST API

### Conversation and State
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/health` | Health check |
| GET | `/api/tree` | Full conversation tree |
| GET | `/api/tree/node/{id}` | Single node |
| GET | `/api/flags` | All flags |
| GET | `/api/notebook` | Notebook entries |
| GET | `/api/viewport` | Current viewport state |
| POST | `/api/agent/action` | Programmatic agent control |

### Agents
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/agents` | Discover available agents |
| POST | `/api/agent/switch` | Switch active agent |
| GET | `/api/agent/{name}/notebook` | Agent's lab notebook |
| GET | `/api/agent/{name}/history` | Agent's session history |
| GET | `/api/agent/context` | Agent context info |
| GET | `/api/agent/status` | Agent process status |
| POST | `/api/agent/start` | Start grok agent stdio |
| POST | `/api/agent/stop` | Stop agent |
| POST | `/api/agent/compact` | Trigger agent compaction |

### Arena Adapter
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/adapter/pending` | Poll for pending user messages (destructive read) |
| POST | `/api/adapter/response` | Deliver agent response |
| POST | `/api/adapter/chunk` | Deliver streaming chunk |

### Hosted Panels (Xpra)
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/panel/presets` | Available panel presets (Chrome, Terminal, File Manager) |
| POST | `/api/panel/launch` | Launch a new panel |
| GET | `/api/panel/list` | List active panels |
| DELETE | `/api/panel/{id}` | Stop and remove a panel |
| POST | `/api/panel/{id}/agent-claim` | Agent claims control of panel |
| POST | `/api/panel/{id}/agent-release` | Agent releases control |
| POST | `/api/panel/{id}/agent-status` | Update agent status text |
| GET | `/api/panel/{id}/agent-state` | Get agent control state |
| GET | `/api/panel/{id}/proxy/{path}` | HTTP proxy to Xpra (with retry) |
| WS | `/api/panel/{id}/proxy` | WebSocket proxy to Xpra |

### Inspection and Training
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/moments` | List flagged moments |
| GET | `/api/moments/{index}` | Single moment |
| DELETE | `/api/moments/{index}` | Delete a moment |
| POST | `/api/moments/ab-test` | A/B test a moment |
| GET | `/api/compaction-boundaries` | List compaction boundaries |
| GET | `/api/compaction-boundaries/{id}` | Single boundary detail |
| GET | `/api/corrections` | List all corrections |
| POST | `/api/corrections` | Create a correction |
| GET | `/api/corrections/{id}` | Single correction |
| PUT | `/api/corrections/{id}` | Update a correction |
| DELETE | `/api/corrections/{id}` | Delete a correction |
| POST | `/api/episode-scores` | Submit episode scores |
| GET | `/api/episode-scores` | List episode scores |
| GET | `/api/export/training-data` | Export GRPO training JSONL |

### Prompts and Testing
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/prompts` | All training prompts |
| GET | `/api/prompts/{id}` | Single prompt |
| GET | `/api/prompts/{id}/test-runs` | Test runs for a prompt |
| GET | `/api/test-runs` | All test runs |
| GET | `/api/models` | Available xAI models |

### Artifacts and Sessions
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/artifacts` | Artifact list |
| POST | `/api/artifacts` | Create artifact |
| GET | `/api/artifacts/{id}/content` | Serve artifact content |
| GET | `/api/artifacts/presentation` | Serve reveal.js presentation |
| POST | `/api/artifacts/slides` | Create/update slides |
| GET | `/api/artifacts/slides` | Get slides |
| DELETE | `/api/artifacts/slides` | Delete slides |
| GET | `/api/session/segments` | Session segment metadata |
| POST | `/api/session/load-segment` | Load a specific segment |
| POST | `/api/session/load` | Load from JSONL with filters |
| POST | `/api/session/load-updates` | Load from updates.jsonl |

### Shared Editor
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/docs` | List all open documents |
| POST | `/api/docs` | Create a new document |
| GET | `/api/docs/{id}` | Get document metadata |
| DELETE | `/api/docs/{id}` | Delete a document |
| POST | `/api/docs/{id}/highlight` | Add agent-initiated line highlight |
| DELETE | `/api/docs/{id}/highlight` | Remove highlight |
| POST | `/api/docs/{id}/save-to-file` | Save document back to source file on disk |

### File Browser
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/files/browse` | Browse filesystem directory (defaults to agent home) |
| POST | `/api/files/open` | Open a file from disk into a new editor document |

## WebSocket Protocol (/ws)

| Type | Direction | Purpose |
|------|-----------|---------|
| `state.snapshot` | S->C | Full tree on connect |
| `conversation.send` | C->S | User message |
| `conversation.node_update` | S->C | Agent response content |
| `conversation.chunk` | S->C | Streaming chunk |
| `conversation.turn_start` | S->C | Agent turn begun (includes nodeId) |
| `conversation.turn_complete` | S->C | Agent turn finished |
| `tree.live_node` | S->C | Live-tailed node from agent session |
| `workspace.navigate` | S->C | Scroll/tab control |
| `viewport.focus` | C->S | User scrolled (agent awareness) |
| `panel.launched` | S->C | Panel created |
| `panel.stopped` | S->C | Panel removed |
| `prompt_test.run` | C->S | Start test |
| `prompt_test.result` | S->C | Individual result |
| `prompt_test.complete` | S->C | All tests done |
| `doc.created` | S->C | New shared document created |
| `doc.deleted` | S->C | Shared document deleted |
| `doc.updated` | S->C | Document metadata updated |
| `highlight.set` | S->C | Agent highlight applied to editor line |
| `highlight.clear` | S->C | Agent highlight removed |

## Parallel Sessions -- The Training Loop

The core training loop for RLAIHIS (Reinforcement Learning from AI-Human Interaction Sessions):

```
1. CAPTURE -- Agent + mentor work together in the workspace.
   Every interaction between compaction boundaries is a captured episode.

2. IDENTIFY -- Find "moments" where the agent chose wrong.
   Example: agent implements a fix before building a test,
   despite the mentor asking for test-first workflow.

3. ISOLATE -- Identify the compaction boundary preceding the moment.
   The checkpoint file is the episode seed. Modify the agent's instructions
   (e.g., add a principle to AGENTS.md).

4. REPLAY -- Spawn N parallel sessions from the modified checkpoint.
   Feed the same user messages that led to the moment.

5. SCORE -- Did the agent handle the moment differently?
   Binary (right/wrong) or nuanced reward signal.

6. OUTPUT -- Two things:
   a. GRPO training data (prompt + N completions + rewards)
   b. AGENTS.md validation (does this principle change produce better behavior?)
```

### Compaction Checkpoint Schema

Each checkpoint file (`compaction_checkpoints/<uuid>.json`) contains:

| Field | Description |
|-------|-------------|
| `checkpoint_id` | UUID identifier |
| `compacted_history` | Full conversation state (system prompt + turns) |
| `schema_version` | Format version (currently 1) |
| `created_at` | ISO timestamp of compaction |
| `original_user_info` | Workspace context (OS, shell, CWD, project layout) |
| `reread_file_paths` | Files to re-inject into context after compaction |
| `prompt_index_at_compaction` | Which turn triggered compaction |

### Open Questions

1. **Seeding mechanism**: How to feed a checkpoint to `grok agent stdio` to start a parallel session. No CLI flag exists yet.
2. **Message replay**: Extracting user messages from session data to replay in parallel sessions.
3. **Scoring**: Manual review, automated heuristic, or model-as-judge.
4. **AGENTS.md injection**: Patching the system prompt in `compacted_history` to test modified principles.

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `ARENA_AGENT` | No | Default agent name (default: Q) |
| `XAI_API_KEY` | For prompt testing | xAI API key for running completions |

## Logs

When launched via `launch_arena.sh`:
- `/tmp/arena_backend.log` -- FastAPI/uvicorn backend
- `/tmp/arena_frontend.log` -- Vite dev server
- `/tmp/arena_adapter.log` -- Arena adapter
- PIDs tracked in `/tmp/arena_pids.txt`

## Tests

```bash
cd backend

# Arena round-trip tests (hop-by-hop pipeline)
python -m pytest test_arena_roundtrip.py -v

# Arena E2E tests (adapter routing, WS delivery)
python -m pytest test_arena_e2e.py -v
python -m pytest tests/test_arena_e2e.py -v

# Browser-level tests (Selenium, require running backend+frontend)
python -m pytest test_browser_e2e.py -v
python -m pytest test_panel_browser.py -v
python -m pytest test_compaction_browser.py -v
python -m pytest test_dockable_tabs.py -v

# Component-specific tests
python -m pytest test_corrections.py -v
python -m pytest test_training_export.py -v
python -m pytest test_episode_runner.py -v
python -m pytest test_agent_panel.py -v
python -m pytest test_livetailer_filtering.py -v

# Cross-cutting tests (from repo root)
cd ..
python -m pytest tests/ -v
```

## Status

Active development. Private repo (MikeyV-ET/socratic-arena).

---

*Part of the MikeyV project by Eric Terry (eterry@teachx.ai)*
