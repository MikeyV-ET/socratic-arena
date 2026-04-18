# Socratic Arena

A collaborative workspace where AI agents and human mentors work together, with built-in tools for inspecting interactions, testing principle changes, and generating GRPO training data.

## What It Is

Socratic Arena is two things in one:

1. **A collaborative workspace** -- agents and mentors share a conversation, notebook, and artifacts. The daily driver for actual work.
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
- **Moments**: Points in the conversation where the agent made a choice that could have gone differently. Can be auto-detected or manually flagged. These are the test cases for both GRPO training and AGENTS.md iteration.
- **Compaction Boundaries**: The only points where agent state is cleanly captured and reproducible. Agent state mid-session is the entire context window (not portable). At a compaction boundary, state collapses to a compact text artifact (the compaction summary). These are the fork points for parallel sessions.
- **Parallel Sessions**: Instead of "forking" (wrong metaphor -- there's no persistent state to fork), you start N independent sessions from the same compaction checkpoint with modified instructions. Each session is a sample of what the agent would do differently.
- **Compaction Checkpoints**: The grok binary stores checkpoints at each compaction boundary (`~/.grok/sessions/.../compaction_checkpoints/`). Each checkpoint contains the full conversation state (system prompt, compacted history, user info, file paths) -- everything needed to seed a parallel session.
- **Prompts**: Training prompt configurations derived from flagged moments. Include system prompt, context, probe, and expected/failure behaviors.
- **Prompt Testing**: Run N completions from the same prompt to measure catch rate variance. Good variance (30-70% catch rate) = good GRPO training signal. The parallel session architecture scales this from isolated prompts to full conversation replays.
- **Live Tailer**: Streams the agent's real-time session activity into the arena tree.
- **Arena Adapter**: Bridges arena UI messages to asdaaas agents via the standard inbox/outbox filesystem protocol.

## Parallel Sessions -- The Training Loop

The core training loop for RLAIHIS (Reinforcement Learning from AI-Human Interaction Sessions):

```
1. CAPTURE -- Agent + mentor work together in the workspace.
   Every interaction between compaction boundaries is a captured episode.

2. IDENTIFY -- Find "moments" where the agent chose wrong.
   Example: agent implements a fix before building a test,
   despite the mentor asking for test-first workflow.

3. FORK -- Go back to the compaction boundary that preceded the moment.
   The checkpoint file is the seed. Modify the agent's instructions
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
