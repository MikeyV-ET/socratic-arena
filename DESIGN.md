# Socratic Arena -- Design Document

> RLAIHIS: Reinforcement Learning from AI-Human Interaction Sessions

## Vision

Socratic Arena treats real working sessions between AI agents and human mentors as training data. The workspace IS the data collection instrument -- there is no separate "training mode." An agent working with a mentor on real tasks produces exactly the episodes needed for training. Every interaction between compaction boundaries is a captured episode.

The key insight: when a mentor corrects an agent's reasoning process ("you should have built the test first"), that correction identifies a missing operating principle. The Socratic Arena makes these principles empirically testable by replaying sessions from compaction boundaries with modified instructions and measuring whether the agent handles the moment differently.

## Background

This system formalizes methodology developed by Eric Terry and documented in [sixel-as-a-scientist-in-training](https://github.com/sixel-et/sixel-as-a-scientist-in-training): Socratic correction at moments of scientific failure produces training signal that standard RLHF cannot capture.

RLHF rewards outputs. RLAIHIS targets the reasoning process -- which operating constraint was missing, and can we install it?

## Two Capabilities in One Tool

### 1. Collaborative Workspace

Agents and mentors share a conversation, notebook, and artifacts. This is the daily driver for actual work -- coding, research, debugging, planning. The workspace captures everything automatically:

- Full conversation tree (branching, not linear)
- Agent's real-time session activity (tool calls, thinking, file operations)
- Lab notebook entries
- Flagged moments and corrections

### 2. Inspection and Training Layer

The same tool provides:

- Compaction boundary browser (catalog of session seeds)
- Correction authoring UI (structured "what was missing" on a moment)
- Parallel session runner (N sessions from same seed, different instructions)
- Scoring and training data export (GRPO format)

The workspace produces the data. The inspection tools mine it.

## System Context

Socratic Arena operates within the **asdaaas** (Agent State Directory As A Service) ecosystem:

- **asdaaas**: Agent runtime. Manages lifecycle, compaction, message routing, doorbells (notifications), and continuous existence. Each agent is a directory (`~/agents/<Name>/`).
- **grok binary**: Model interface (`grok agent stdio`). Runs the language model with tool access. Manages sessions and compaction checkpoints.
- **Adapters**: IRC, localmail, arena, remind, heartbeat -- each bridges a communication channel to the agent's filesystem inbox/outbox.

## Architecture

```
Browser (React/Vite)
  |
  |-- WebSocket (/ws)     live conversation, streaming, live tailer
  |-- REST (/api/*)       agents, notebooks, moments, prompts, artifacts
  |
FastAPI Backend (main.py)
  |-- In-memory conversation tree (from updates.jsonl)
  |-- LiveTailer (streams agent session to arena)
  |-- Prompt test engine (parallel completions)
  |
Arena Adapter (arena_adapter.py)
  |-- Polls backend for pending user messages
  |-- Writes to agent asdaaas inbox
  |-- Reads agent responses from outbox
  |-- POSTs responses back to backend
  |
asdaaas + grok binary (separate process)
  |-- Agent runtime, compaction, doorbells
  |-- updates.jsonl (session log)
  |-- compaction_checkpoints/ (fork points)
```

### Data Flows

**User message to agent:**
1. User types in browser -> WebSocket `conversation.send` -> backend stores in queue
2. Arena adapter polls backend, picks up message
3. Adapter writes to agent's `adapters/arena/inbox/`
4. asdaaas delivers to agent on next turn

**Agent response to user:**
1. Agent stdout captured by asdaaas
2. Routed to `adapters/arena/outbox/`
3. Arena adapter polls outbox, POSTs to backend
4. Backend broadcasts `conversation.node_update` via WebSocket

**Live session stream:**
1. grok binary writes turns to `updates.jsonl`
2. LiveTailer watches file, broadcasts new nodes as `tree.live_node`
3. Browser renders agent's real-time activity

## Core Concepts

### Agent State and Compaction

Agent state mid-session = entire context window (hundreds of thousands of tokens). Not portable, not reproducible. But the grok binary performs **compaction** at ~85% context usage, summarizing the conversation into a compact text artifact.

At a compaction boundary:
- State collapses to compaction summary (a few thousand tokens)
- grok binary stores a **checkpoint file** with full prompt state
- Agent resumes with summary as history

Compaction boundaries are the natural isolation points. Each session between two boundaries is a self-contained episode.

### Compaction Checkpoints

Stored at: `~/.grok/sessions/<encoded-path>/<session-id>/compaction_checkpoints/<uuid>.json`

Each checkpoint contains:

| Field | Description |
|-------|-------------|
| `checkpoint_id` | UUID |
| `compacted_history` | Full conversation state: system prompt + turns |
| `schema_version` | Format version (currently 1) |
| `created_at` | ISO timestamp |
| `original_user_info` | Workspace context (OS, shell, CWD, project layout) |
| `reread_file_paths` | Files to re-inject after compaction |
| `prompt_index_at_compaction` | Which turn triggered compaction |

The `compacted_history` array is the complete seed. Item 0 is the system prompt (~48K, includes AGENTS.md, tool definitions, identity). Subsequent items are conversation turns.

### Moments

A point in a session where the agent made a decision the mentor would correct. Identified:

- **Manually**: Mentor flags a message
- **By pattern**: Scanning transcripts for known anti-patterns
- **By correction**: When mentor corrects, the preceding choice is the moment

Moments live within episodes (sessions between compaction boundaries). To test whether a principle change would have caught the moment, isolate the episode by its preceding compaction boundary and replay from there.

### Parallel Sessions

To test a principle change (e.g., adding "reproduce at the level the user experiences the problem" to AGENTS.md):

1. Isolate the episode containing the moment (bounded by compaction checkpoints)
2. Patch the system prompt with modified AGENTS.md
3. Start N independent sessions from the patched checkpoint
4. Feed the same user messages that led to the moment
5. Score: did the agent handle the moment differently?

No shared state. Just N samples from the same starting point with different instructions.

### The RLAIHIS Training Loop

```
1. CAPTURE    Agent + mentor work together in the workspace.
              Every interaction between compaction boundaries is a captured episode.

2. IDENTIFY   Find moments where the agent chose wrong.
              Example: agent implements a fix before building a test,
              despite the mentor asking for test-first workflow.

3. ISOLATE    Identify the compaction boundary preceding the moment.
              The checkpoint file is the episode seed.
              Modify the agent's instructions (e.g., add a principle to AGENTS.md).

4. REPLAY     Spawn N parallel sessions from the modified checkpoint.
              Feed the same user messages that led to the moment.

5. SCORE      Did the agent handle the moment differently?
              Binary (right/wrong) or nuanced reward signal.

6. OUTPUT     Two things:
              a. GRPO training data (prompt + N completions + rewards)
              b. AGENTS.md validation (does this principle change work?)
```

### Two Outputs from One Loop

**GRPO training data**: prompt prefix (checkpoint) + N sampled completions (parallel sessions) + reward scores. Standard GRPO input format.

**AGENTS.md validation**: Does adding principle X cause the agent to handle moment Y correctly? Empirically testable. A/B test principle changes like code changes.

## Frontend

### State Management (Zustand -- arenaStore.ts)

- Conversation tree (nodes, branches, active tracking)
- History tree (separate, can view different agent's session)
- Per-pane agent selection (conversation, history, notebook, moments each independent)
- Streaming state (in-progress chunks)
- UI state (selections, scroll targets, fonts, theme, panels)

### Components

| Component | Purpose |
|-----------|---------|
| ConversationPane | Live chat with agent, auto-scroll, markdown, streaming |
| HistoryPane | Browse full session tree, navigate to any node |
| NotebookPane | Lab notebook viewer (parses markdown) |
| MomentsPane | Flagged moments with corrections |
| PromptTestPane | Run N completions, variance meter for GRPO signal quality |
| PromptDevPane | Author/edit training prompts from moments |
| TreeView | Branch visualization |

### WebSocket Protocol

| Type | Direction | Purpose |
|------|-----------|---------|
| `state.snapshot` | S->C | Full tree on connect |
| `conversation.send` | C->S | User message |
| `conversation.node_update` | S->C | Agent response |
| `conversation.chunk` | S->C | Streaming chunk |
| `conversation.turn_complete` | S->C | Stream finished |
| `tree.live_node` | S->C | Live-tailed node |
| `workspace.navigate` | S->C | Scroll to node |
| `viewport.focus` | C->S | User scrolled (agent awareness) |
| `prompt_test.run` | C->S | Start test |
| `prompt_test.result` | S->C | Individual result |
| `prompt_test.complete` | S->C | All tests done |

## Backend

### FastAPI (main.py)
- In-memory conversation tree from `updates.jsonl`
- WebSocket pool with broadcast
- REST: agents, notebooks, moments, prompts, artifacts
- Agent action endpoint for programmatic control

### LiveTailer (live_tailer.py)
- Watches `updates.jsonl`, streams new entries as `tree.live_node`
- Node deduplication (`_known_ids` set prevents parent cycles)
- Incremental file reading, graceful reconnection

### Arena Adapter (arena_adapter.py)
- Bridges UI to asdaaas agents via filesystem inbox/outbox
- Multi-agent routing (switch between agents)

### Updates Parser (updates_parser.py)
- Parses `updates.jsonl` into conversation tree
- Reconstructs parent-child relationships and branches

## File Locations

```
# Grok session data (checkpoints live here)
~/.grok/sessions/<encoded-workspace-path>/<session-id>/
  updates.jsonl                    # Turn-by-turn session log
  chat_history.jsonl               # Conversation messages
  summary.json                     # Session metadata
  compaction_checkpoints/          # Fork points
    <uuid>.json                    # One per compaction

# Agent runtime (asdaaas manages these)
~/agents/<Name>/
  AGENTS.md                        # Identity and operating principles
  lab_notebook_<name>.md           # Append-only record
  notes_to_self.md                 # Mutable working memory
  asdaaas/
    gaze.json                      # Where speech goes
    awareness.json                 # Background notifications
    health.json                    # Status (model, tokens, context)
    adapters/arena/inbox/          # Messages from arena UI
    adapters/arena/outbox/         # Responses to arena UI

# Socratic Arena codebase
~/projects/socratic-arena/
  backend/                         # FastAPI + adapter + tests
  frontend/                        # React + Vite
```

## Concrete Example: Two Moments from One Session

On 2026-04-18, during a live walkthrough of the arena, two moments were captured where the agent (Q) implemented fixes before building browser-level tests, despite the mentor (Eric) repeatedly asking for test-first workflow:

1. **Moment 1**: Agent built 3 layers of backend tests before browser-level test for a rendering bug. Eric: "was it unclear that this is what I wanted?"
2. **Moment 2**: Agent implemented workspace.navigate fix before building browser test. Eric: "did you create a way to test it?"

The compaction checkpoint preceding these moments is `e6572ec4` (2026-04-18 07:08, 170KB). This checkpoint is the seed for testing whether adding "reproduce at the level the user experiences the problem" to AGENTS.md changes the agent's behavior at these moments.

## Application Hosting & Panel Architecture

SA panels host desktop applications -- browsers, document editors,
terminals, any X11 program. The human and agent interact with the same running
application through different channels optimized for their respective strengths.

This extends SA from a conversation-plus-notebook tool to a universal
collaborative workspace. The conversation panel is one pane among many; the
others can be live applications that both parties control.

### Hosting Mechanism: Xpra

Xpra forwards individual application windows (not the whole desktop) to an HTML5
client that embeds in an iframe. Each application gets its own Xpra session and
its own SA panel.

```
SA in Browser
+-- ConversationPane (existing)
+-- Panel: Xpra -> chrome --app=docs.google.com
+-- Panel: Xpra -> libreoffice --writer
+-- Panel: Xpra -> terminal
+-- Panel: Xpra -> any X11 application
```

Chrome's `--app=URL` mode strips browser chrome (no address bar, no tabs),
making web apps look like standalone applications in their panels.

Server-side: Xpra starts a virtual display, launches the application on it,
and serves the HTML5 client on a local port. The SA backend reverse-proxies
Xpra (both HTTP and WebSocket) through `/api/panel/{id}/proxy/` so all
panel traffic is same-origin -- no CORS issues.

### Panel Manager (backend/panel_manager.py)

Manages Xpra panel lifecycle:
- Three presets: Chrome (`--app=URL`), Terminal (xterm), File Manager (pcmanfm)
- Per-panel port and X display allocation (ports 10000+, displays :10+)
- Xpra flags: `--encodings=png,rgb,jpeg --video-encoders=none --pulseaudio=no`
- CDP port allocation for agent Selenium access
- Panel URLs use same-origin proxy: `/api/panel/{id}/proxy/?path=...`

### Xpra Reverse Proxy (backend/main.py)

- HTTP: `GET /api/panel/{id}/proxy/{path}` -- proxies to Xpra's web server with retry logic (5 attempts, 1s backoff)
- WebSocket: `WS /api/panel/{id}/proxy` -- bidirectional WebSocket proxy
- Auto-refresh fallback HTML on connection failure (handles Xpra startup race)

### Asymmetric Interaction Model

The human and agent control the same application through different interfaces:

| Party | Interface | Mechanism |
|-------|-----------|-----------|
| Human | Visual (pixels + mouse/keyboard) | Xpra HTML5 client in panel |
| Agent | Programmatic (structured API) | Selenium, UNO, AT-SPI, shell |

This asymmetry is deliberate. Humans are good at visual interaction; agents
are good at API-level control. Both act on the same application instance.

**Agent control channels by application type:**

| Application | Agent API | Notes |
|-------------|-----------|-------|
| Chrome/Firefox | Selenium/CDP | DOM access, element selection, form interaction |
| LibreOffice | UNO API (Python) | Document model: paragraphs, cells, formatting |
| GTK/Qt apps | AT-SPI | Accessibility tree: buttons, menus, text fields |
| Terminal | Shell | Direct command execution |
| Arbitrary | Screenshots + vision + xdotool | Fallback for apps without structured APIs |

### Panel Detachment

Any SA panel can be popped out into its own browser window via `window.open()`.
The detached window loads a standalone route (e.g., `/panel/{type}?session={id}`)
and connects to the same WebSocket backend. Both windows share session state.

This allows multi-monitor workflows: conversation on one screen, a hosted
application on another. Reattach by closing the detached window.

The existing react-resizable-panels layout supports this without architectural
changes. The detached window renders the same panel component in isolation.

### Integration with Existing Architecture

- **LiveTailer** continues to stream `updates.jsonl` for the conversation pane
- **Arena adapter** continues to bridge user messages to the agent
- Xpra panels are additive -- new panel types alongside ConversationPane,
  NotebookPane, MomentsPane, etc.
- WebSocket protocol extends with `panel.host` (C->S, launch app) and
  `panel.detach`/`panel.reattach` messages

### Prerequisites

Server-side packages (all in Ubuntu repos):
- `xpra` -- application forwarding with HTML5 client
- Xvfb (if no physical display) -- virtual X display

Already available on current infrastructure:
- Google Chrome, LibreOffice Writer, xdotool
- Selenium 4.41, AT-SPI (Q's launch_arena_browser.sh)
- X display at :0

### Product Identity Note

This capability shifts SA from a developer/research tool to a general-purpose
collaborative workspace platform. The research layer (moments, corrections,
fork-and-replay, GRPO export) remains, but the base layer -- agent and human
sharing applications with equal control -- serves any workflow: office tasks,
document editing, web research, data analysis. The research apparatus is what
makes the interactions improvable; the workspace is what makes them possible.

## Open Questions

1. **Seeding mechanism**: How to feed a checkpoint to `grok agent stdio` to start a parallel session. No CLI flag exists. Options: session directory manipulation, direct xAI API with conversation prefix, feature request.

2. **Message replay**: Extracting user messages from session data to replay. Messages exist in `updates.jsonl` and profile data but need extraction tooling.

3. **Scoring**: Manual review, automated heuristic, or model-as-judge for evaluating parallel session outcomes.

4. **AGENTS.md injection**: Patching the system prompt in `compacted_history[0]` to test modified principles.

5. **Non-determinism**: Same seed + same messages may produce different agent behavior due to model sampling. N parallel sessions address this statistically.

## Development Status

### Built (14 roadmap items + post-roadmap features)

**Roadmap items (1-14):**
- Live workspace (conversation, notebook, history panes)
- Real-time session streaming (LiveTailer with arena filtering)
- Two-way communication (user <-> agent via arena adapter)
- Multi-agent support (discovery, switching, per-pane selection, arena state clearing)
- Workspace navigation (scroll to any node)
- Prompt testing (N completions, variance measurement)
- Moment flagging and correction authoring
- Hosted application panels (Xpra + same-origin proxy)
- Agent panel control (claim/release with UI indicators, Selenium/CDP toolkit)
- Compaction boundary browser (40+ boundaries, expandable summaries, filter)
- Correction authoring UI (structured 3-field annotations, CRUD)
- Parallel episode runner (boundary selector, model picker, N slider, scoring)
- Training data export (GRPO JSONL with corrections and episode scores)
- Dockable/closeable tabs (close, reopen from menu, drag to reorder, localStorage persistence)
- Streaming unification (LiveTailer chunks redirect to arena placeholder nodes)
- Workbench split view (horizontal or vertical)

**Post-roadmap features:**
- Shared collaborative editor (Yjs/pycrdt, real-time, WYSIWYG markdown, author coloring, line highlighting)
- File browser (browse filesystem, open files into editor, save back to disk)
- Arena chat persistence (arena_chat.jsonl sidecar, survives backend restart)
- Tail-only startup (100KB tail read instead of full updates.jsonl parse)
- Font size controls (A-/A+ in header, CSS variable, localStorage persistence)
- Panel refresh survival (frontend fetches /api/panel/list on WebSocket connect)
- Xpra reverse proxy (HTTP+WS, same-origin, retry logic for startup race)
- Agent-side Selenium (agent_panel.py CDP toolkit)

**Historical (hackathon-era, not used in live operation):**
- agent_stdio.py (direct grok subprocess management -- replaced by arena adapter)
- Session segment loading (42 segments from sixel-bio -- demo data)
- mock_data.py, demo_dataset.py (fallback/demo data generators)

### Not yet built
- Checkpoint seeding mechanism (feeding checkpoint to `grok agent stdio` for parallel sessions)
- Automated message replay extraction
- AGENTS.md diff visualization

## Prior Art

- **Process reward models** (Lightman et al., 2023): Reward intermediate steps via automated verification. RLAIHIS sources signal from expert interaction.
- **Constitutional AI** (Bai et al., 2022): Principles guide behavior, written a priori. Here, principles are extracted from observed failures and empirically validated.
- **Debate** (Irving et al., 2018): Agents argue to reveal truth. RLAIHIS has a mentor who probes.
- **RLHF**: Rewards outputs. RLAIHIS targets the reasoning process.

---

*Eric Terry (eterry@teachx.ai) -- research direction and mentorship methodology*
*MikeyV agents (Q, Cinco, Sr) -- design and implementation*
