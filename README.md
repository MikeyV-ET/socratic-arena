# Socratic Arena

A collaborative workspace where AI agents and human mentors work together, with built-in tools for inspecting interactions and generating training data.

## What It Is

Socratic Arena is two things in one:

1. **A collaborative workspace** -- agents and mentors share a conversation, notebook, and artifacts. The daily driver for actual work.
2. **An inspection and training layer** -- the workspace interactions are captured data. Moments can be flagged, corrections authored, and parallel episodes run to generate GRPO training signal.

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
Browser (React)
  |
  |-- WebSocket (/ws) -- live conversation, streaming, live tailer
  |-- REST (/api/*) -- agents, notebooks, moments, prompts, artifacts
  |
FastAPI Backend (backend/main.py)
  |-- In-memory state (conversation tree, notebook, prompts)
  |-- LiveTailer (streams agent session updates to arena)
  |-- Prompt test engine (GRPO parallel episode runner)
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
    main.py              # FastAPI app, WebSocket, all endpoints
    arena_adapter.py     # Bridges arena <-> asdaaas agents
    live_tailer.py       # Streams updates.jsonl to arena in real-time
    models.py            # Pydantic models (CamelCase serialization)
    updates_parser.py    # Parses grok session updates.jsonl into tree
    notebook_parser.py   # Parses markdown lab notebooks
    session_parser.py    # Parses legacy session formats
    moment_scanner.py    # Scans sessions for candidate Socratic moments
    artifact_renderer.py # Renders markdown slides to HTML
    launch_arena.sh      # Launches all components (detached)
    requirements.txt     # Python dependencies
    test_arena_e2e.py    # E2E tests (adapter routing, WS round-trip)
    test_arena_roundtrip.py  # Hop-by-hop pipeline tests
  frontend/
    src/
      App.tsx            # Root layout
      stores/arenaStore.ts  # Zustand state management
      hooks/useWebSocket.ts # WebSocket connection + message routing
      components/
        conversation/    # ConversationPane, Message, InputBar
        notebook/        # NotebookPane (lab notebook viewer)
        prompt/          # PromptTestPane, PromptDevPane
        workbench/       # MomentsPane, Workbench (tabbed right panel)
        layout/          # Header, PanelLayout, ArtifactPane
        tree/            # TreeView (branch visualization)
    package.json
    vite.config.ts       # Proxies /api and /ws to backend
  _backup_mvp/           # Archived Phase 1/2 code (fork engine, etc.)
```

## Key Concepts

- **Conversation Tree**: Messages form a tree (not a list). Branches allow exploring alternative paths from any point.
- **Moments**: Points in the conversation where something interesting happened. Can be auto-detected or manually flagged.
- **Prompts**: Training prompt configurations derived from flagged moments. Include system prompt, context, probe, and expected/failure behaviors.
- **Prompt Testing**: Run N completions from the same prompt to measure catch rate variance. Good variance (30-70% catch rate) = good GRPO training signal.
- **Live Tailer**: Streams the agent's real-time session activity into the arena tree.
- **Arena Adapter**: Bridges arena UI messages to asdaaas agents via the standard inbox/outbox filesystem protocol.

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `ARENA_AGENT` | No | Default agent name (default: Q) |
| `XAI_API_KEY` | For prompt testing | xAI API key for running completions |

## Logs

All logs are written to `/tmp/`:
- `/tmp/arena_backend.log` -- FastAPI/uvicorn backend
- `/tmp/arena_frontend.log` -- Vite dev server
- `/tmp/arena_adapter.log` -- Arena adapter

## Tests

```bash
cd backend

# Unit + integration tests
python -m pytest test_arena_roundtrip.py -v

# E2E tests (requires asdaaas routing functions)
python -m pytest test_arena_e2e.py -v

# All backend tests
python -m pytest tests/ -v
```

## Status

Active development. Private repo -- will be made public once verified clean of sensitive data.

---

*Part of the MikeyV project by Eric Terry (eterry@teachx.ai)*
