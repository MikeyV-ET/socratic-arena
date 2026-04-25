# Design: Shared Editor + Real-Agent E2E Testing

## Overview

Two features supporting a single use case: Eric and an agent collaboratively review a lab notebook and edit a prompt together in Socratic Arena.

1. **Shared Editor** -- a collaborative text editor where both user and agent can directly edit the same document in real time
2. **Real-Agent E2E Tests** -- Trip (as user via Selenium) and Q (as agent via backend) exercise the full workflow

## Use Case

Jr runs prompt experiments via `grok -`, recording results in its lab notebook. Eric wants to:
1. Review Jr's notebook entries together with the agent in SA
2. Collaboratively edit the prompt text with the agent -- both typing in the same editor
3. Iterate on the prompt and re-test

## Part 1: Shared Editor

### Architecture

```
Browser (Eric)                    Backend                     Agent (Q/Jr)
     |                               |                            |
  CodeMirror                    Yjs sync hub                  Yjs client
  + Yjs provider  <-- WS -->   (y-websocket)  <-- WS -->    (y-websocket)
     |                               |                            |
  Local edits                   Broadcasts                   Programmatic
  rendered live                 CRDT updates                  read/write
```

**Yjs** handles conflict-free merging. No custom OT needed. The backend runs a y-websocket provider that both browser and agent connect to.

### Components

#### Backend

**New file: `shared_docs.py`**
- Yjs document store (in-memory, persist to disk on change)
- Each document has an ID, title, content type (plaintext/markdown)
- CRUD endpoints:
  - `POST /api/docs` -- create document, returns `{id, title}`
  - `GET /api/docs` -- list documents
  - `GET /api/docs/{id}` -- get document metadata
  - `DELETE /api/docs/{id}` -- delete document

**New WS route: `/api/docs/{id}/ws`**
- y-websocket provider endpoint
- Both browser and agent connect here
- Yjs handles sync automatically

**main.py changes:**
- Mount shared_docs router
- New WS broadcast: `doc.created`, `doc.deleted` (notify all clients when doc list changes)

#### Frontend

**New component: `SharedEditorPane.tsx`**
- CodeMirror 6 editor with Yjs binding (`y-codemirror.next`)
- Connects to `/api/docs/{id}/ws` via `y-websocket` provider
- Shows cursor positions/names for all connected editors (awareness protocol)
- Toolbar: document title, save status, connected users indicator
- Markdown preview toggle (optional, later)

**Workbench integration:**
- New tab type: "Editor" in the workbench tab menu
- Creating a new editor doc opens the tab
- Agent can open it via `workspace.navigate` with `tab: "editor"`

#### Agent API

Agent connects to the same Yjs WebSocket as the browser. Using `y-websocket` Python client or raw Yjs CRDT updates:

```python
# Agent creates a shared doc
POST /api/docs {"title": "Prompt Draft", "content": "initial text"}

# Agent connects to edit
ws = connect("ws://localhost:8000/api/docs/{id}/ws")
# Send/receive Yjs sync messages (binary protocol)

# Agent navigates user to the doc
ws.send({"type": "workspace.navigate", "payload": {"tab": "editor", "docId": id}})
```

For simplicity, also provide a REST endpoint for agents that don't need real-time sync:
- `PUT /api/docs/{id}/content` -- overwrite full content (for batch updates)
- `GET /api/docs/{id}/content` -- read current text

### Dependencies

```
Frontend:
  codemirror (^6.x)
  @codemirror/lang-markdown
  y-codemirror.next
  yjs
  y-websocket

Backend:
  ypy (Yjs Python bindings) or y-py
  -- OR --
  Run y-websocket-server as a subprocess (Node.js)
  -- OR --
  Implement minimal Yjs sync protocol in Python (sync step 1/2 + update forwarding)
```

**Recommended approach:** Minimal Python sync hub. The Yjs wire protocol for WebSocket is simple: sync step 1 (state vector), sync step 2 (diff), and update messages. We relay binary messages between connected clients and persist the Yjs document state. Libraries: `pycrdt` (Python CRDT compatible with Yjs).

### Data Model

```python
class SharedDoc:
    id: str
    title: str
    created_at: float  # epoch seconds
    updated_at: float  # epoch seconds
    # Content stored as Yjs document state (binary)
    # Text access via Yjs Text type
```

Persisted to `data/docs/{id}.yjs` (binary Yjs state) + `data/docs/index.json` (metadata).

## Part 2: Notebook Viewer Integration

The notebook viewer already exists. For the use case, the agent needs to:

1. **Load external notebook content** -- Push Jr's notebook entries into SA's notebook viewer
   - Use existing `notebook.data` WS message
   - Agent formats Jr's markdown entries as `NotebookEntry` objects

2. **Navigate user to a specific entry** -- Already supported
   - `workspace.navigate` with `tab: "notebook"` and `scrollTo: entryId`

No new components needed. Just agent-side code to format and push notebook content.

## Part 3: data-testid Audit

Current coverage: 28 test IDs across 8 files. Gaps that need filling for Selenium testing:

| Element | File | Proposed testid |
|---------|------|-----------------|
| Conversation text input | ConversationPane.tsx | `conversation-input` |
| Send button | ConversationPane.tsx | `conversation-send` |
| Tab bar (main layout) | Layout or App.tsx | `main-tab-{name}` |
| Notebook entry | NotebookPane.tsx | `notebook-entry-{id}` |
| Notebook tab content | NotebookPane.tsx | `notebook-pane` |
| Shared editor content | SharedEditorPane.tsx (new) | `shared-editor` |
| Shared editor title | SharedEditorPane.tsx (new) | `shared-editor-title` |
| Panel iframe | HostedAppPane.tsx | `panel-iframe-{id}` |
| Apps tab launch button | HostedAppPane.tsx | `panel-launch-btn` |
| Conversation messages container | ConversationPane.tsx | `conversation-messages` |

## Part 4: Real-Agent E2E Test Plan

### Roles
- **Trip** = "user" (drives Chrome via Selenium, interacts with SA frontend)
- **Q** = "agent" (connected to SA backend via WebSocket and REST API)

### Test Infrastructure

```
Trip (Selenium)                SA Frontend              SA Backend              Q (agent)
  Chrome browser  ---------->  localhost:5173  -------> localhost:8000  <------- WS + REST
  CDP port 9222                  (Vite)                  (uvicorn)
```

Trip launches headed Chrome pointed at SA. Q connects to backend WS as the agent participant.

### Test Scenarios

#### T1: Notebook Review Flow
1. Q loads Jr's notebook entries into SA notebook viewer
2. Q navigates to a specific entry (`workspace.navigate`)
3. Trip verifies: notebook tab is active, correct entry is scrolled into view
4. Trip reads entry content, sends a conversation message about it
5. Q receives the message, responds in conversation
6. Trip verifies: response appears in conversation pane

**Pass criteria:** Entry visible, conversation round-trip works, no stale DOM.

#### T2: Shared Editor Creation
1. Q creates a shared doc via `POST /api/docs`
2. Q navigates Trip to the editor tab
3. Trip verifies: editor tab opens, document title visible, editor is editable
4. Trip types text into the editor
5. Q reads the text via API or Yjs sync
6. Q verifies: text matches what Trip typed

**Pass criteria:** Document created, Trip can type, Q can read Trip's edits.

#### T3: Collaborative Editing
1. Q creates a shared doc with initial prompt text
2. Trip sees the initial text in the editor
3. Q edits the document (appends a line)
4. Trip verifies: new line appears in editor without page refresh
5. Trip edits the document (modifies a word)
6. Q verifies: modification appears in Q's view
7. Both verify: no content loss, no duplication

**Pass criteria:** Bidirectional real-time sync, no data loss.

#### T4: Full Workflow (Integration)
1. Q loads Jr's notebook, navigates to the experiment entry
2. Trip reads the entry, discusses in conversation
3. Q creates a shared doc with the prompt from the notebook
4. Trip and Q both edit the prompt
5. Q takes the final prompt text and runs it (via `grok -` or prompt test)
6. Results appear in conversation or workbench

**Pass criteria:** Complete workflow without manual intervention beyond Trip's Selenium actions and Q's API calls.

### Test Runner

Tests live in `tests/test_e2e_collab.py`. Each test:
1. Starts SA backend (or uses running instance)
2. Trip launches Chrome, connects to SA
3. Q connects to SA backend WS
4. Execute scenario steps with assertions
5. Clean up (close docs, clear state)

Trip's Selenium code and Q's agent code run in the same pytest process using `asyncio` for coordination, or in separate processes communicating via localmail.

## Implementation Order

1. **data-testid additions** (small, unblocks Trip's Selenium work)
2. **Shared doc backend** (CRUD + Yjs sync hub)
3. **Shared editor frontend** (CodeMirror + Yjs + workbench tab)
4. **Agent-side Yjs client** (Python, connect to shared doc)
5. **Notebook loading from external source** (agent pushes Jr's entries)
6. **E2E test scaffolding** (pytest + Selenium + agent WS)
7. **Test scenarios T1-T4**
