# Socratic Arena — Design Document

This document defines interfaces for parallel development. Three workstreams (backend, frontend, data) build against these contracts independently and converge at integration.

---

## 1. Data Shapes

### 1.1 Conversation Tree

The core data structure. A conversation is a tree of message nodes, not a linear thread.

```typescript
// Frontend (TypeScript)

interface ConversationNode {
  id: string;                    // globally unique: {sessionId}-{branchId}-{seq}
  parentId: string | null;       // null for root
  branchId: string;              // which branch this node belongs to
  role: "user" | "assistant" | "system";
  content: string;               // markdown text
  thinking?: string;             // agent thinking (collapsible in UI)
  timestamp: number;             // unix ms
  eventId: string;               // maps to updates.jsonl event
  children: string[];            // IDs of child nodes (branches)
  flags: Flag[];                 // user-applied flags
  metadata?: {
    modelId?: string;
    totalTokens?: number;
    toolCalls?: ToolCallSummary[];
  };
}

interface Flag {
  id: string;
  nodeId: string;
  type: "training_candidate";    // extensible later
  note?: string;                 // user annotation
  createdAt: number;
}

interface ToolCallSummary {
  toolCallId: string;
  title: string;
  status: "pending" | "completed" | "error";
}

interface Branch {
  id: string;
  parentNodeId: string;          // the node this branch forks from
  rootNodeId: string;            // first node on this branch
  sessionId: string;             // grok stdio session backing this branch
  label?: string;                // user-assigned name
  createdAt: number;
}

interface ConversationTree {
  id: string;
  branches: Record<string, Branch>;
  nodes: Record<string, ConversationNode>;
  rootNodeId: string;
  activeBranchId: string;        // currently viewed branch
  activeNodeId: string;          // currently viewed node (scroll position)
}
```

```python
# Backend (Pydantic)

class ConversationNode(BaseModel):
    id: str
    parent_id: str | None
    branch_id: str
    role: Literal["user", "assistant", "system"]
    content: str
    thinking: str | None = None
    timestamp: int
    event_id: str
    children: list[str] = []
    flags: list[Flag] = []
    metadata: dict | None = None

class Flag(BaseModel):
    id: str
    node_id: str
    type: str = "training_candidate"
    note: str | None = None
    created_at: int

class Branch(BaseModel):
    id: str
    parent_node_id: str
    root_node_id: str
    session_id: str
    label: str | None = None
    created_at: int
```

### 1.2 Lab Notebook

```typescript
interface NotebookEntry {
  id: string;
  branchId: string;
  eventIdRange: [string, string];  // first and last event this entry covers
  timestamp: number;
  title: string;
  content: string;                  // markdown
  tags?: string[];
}

interface Notebook {
  entries: NotebookEntry[];
}
```

### 1.3 Prompt Development

```typescript
interface TrainingPrompt {
  id: string;
  flagId: string;                   // the flag this was developed from
  sourceNodeId: string;             // the flagged conversation node
  systemPrompt: string;            // context-setting for the naive model
  userPrompt: string;              // the prompt that should reproduce the failure
  expectedBehavior: string;        // what "catching it" looks like
  failureBehavior: string;         // what "missing it" looks like
  status: "draft" | "testing" | "validated" | "rejected";
  testResults: PromptTestRun[];
}

interface PromptTestRun {
  id: string;
  promptId: string;
  n: number;                       // number of completions
  results: PromptTestResult[];
  varianceScore: number;           // 0-1, how much reward variance
  timestamp: number;
}

interface PromptTestResult {
  id: string;
  completion: string;
  caught: boolean;                 // did the model catch the gap?
  reward: number;                  // 0.0 or 1.0
}
```

### 1.4 Artifact

```typescript
interface Artifact {
  id: string;
  branchId: string;
  type: "presentation" | "writeup";
  filename: string;                // path relative to workspace
  title: string;
  lastModified: number;
}
```

---

## 2. WebSocket API

Single WebSocket connection between React frontend and FastAPI backend.

### 2.1 Connection

```
ws://localhost:8000/ws
```

### 2.2 Message Format

All messages are JSON with a `type` field for routing.

```typescript
// Client → Server
interface ClientMessage {
  type: string;
  payload: any;
}

// Server → Client
interface ServerMessage {
  type: string;
  payload: any;
}
```

### 2.3 Message Types

**Conversation:**

```typescript
// Client → Server: send a message in the conversation
{ type: "conversation.send", payload: { branchId: string, content: string } }

// Server → Client: agent response streaming (chunk by chunk)
{ type: "conversation.chunk", payload: { nodeId: string, content: string, done: boolean } }

// Server → Client: agent thinking streaming
{ type: "conversation.thinking", payload: { nodeId: string, content: string, done: boolean } }

// Server → Client: tool call notification
{ type: "conversation.tool_call", payload: { nodeId: string, toolCall: ToolCallSummary } }

// Server → Client: turn complete
{ type: "conversation.turn_complete", payload: { nodeId: string, branchId: string } }
```

**Branching:**

```typescript
// Client → Server: fork from a node
{ type: "branch.create", payload: { fromNodeId: string, label?: string } }

// Server → Client: branch created
{ type: "branch.created", payload: { branch: Branch } }

// Client → Server: switch active view to a branch
{ type: "branch.switch", payload: { branchId: string } }
```

**Flagging:**

```typescript
// Client → Server: flag a node
{ type: "flag.create", payload: { nodeId: string, note?: string } }

// Server → Client: flag created
{ type: "flag.created", payload: { flag: Flag } }

// Client → Server: remove a flag
{ type: "flag.delete", payload: { flagId: string } }
```

**Prompt Development:**

```typescript
// Client → Server: create prompt from flagged node
{ type: "prompt.create", payload: { flagId: string, systemPrompt: string, userPrompt: string, expectedBehavior: string, failureBehavior: string } }

// Server → Client: prompt created
{ type: "prompt.created", payload: { prompt: TrainingPrompt } }

// Client → Server: update prompt
{ type: "prompt.update", payload: { promptId: string, fields: Partial<TrainingPrompt> } }
```

**Prompt Testing:**

```typescript
// Client → Server: run test
{ type: "prompt_test.run", payload: { promptId: string, n: number } }

// Server → Client: individual result (streams as each completion finishes)
{ type: "prompt_test.result", payload: { promptId: string, runId: string, result: PromptTestResult, progress: { completed: number, total: number } } }

// Server → Client: run complete with summary
{ type: "prompt_test.complete", payload: { promptId: string, run: PromptTestRun } }
```

**Notebook:**

```typescript
// Client → Server: request notebook
{ type: "notebook.get", payload: { branchId?: string } }

// Server → Client: notebook contents
{ type: "notebook.data", payload: { notebook: Notebook } }

// Server → Client: new entry added (push notification)
{ type: "notebook.entry_added", payload: { entry: NotebookEntry } }
```

**State:**

```typescript
// Client → Server: request full state (on connect / reconnect)
{ type: "state.sync", payload: {} }

// Server → Client: full state dump
{ type: "state.snapshot", payload: { tree: ConversationTree, notebook: Notebook, prompts: TrainingPrompt[], artifacts: Artifact[] } }
```

---

## 3. REST Endpoints

For non-streaming operations that don't need WebSocket.

```
GET  /api/health                    → { status: "ok" }
GET  /api/tree                      → ConversationTree
GET  /api/tree/node/{nodeId}        → ConversationNode
GET  /api/flags                     → Flag[]
GET  /api/prompts                   → TrainingPrompt[]
GET  /api/prompts/{promptId}        → TrainingPrompt
GET  /api/notebook                  → Notebook
GET  /api/artifacts                 → Artifact[]
POST /api/artifacts                 → create artifact
GET  /api/artifacts/{id}/content    → raw file content
```

---

## 4. Component Inventory

### 4.1 Layout

```
+------------------------------------------------------------------+
|  Header: "Socratic Arena" + session info + branch selector        |
+------------------+-----------------------------------------------+
|                  |                                                 |
|   Tree View      |   Main Conversation                            |
|   (collapsible)  |   (scrollable, markdown-rendered messages)      |
|                  |   [flag button per message]                     |
|   - visual tree  |   [branch point indicators]                     |
|   - click to     |                                                 |
|     navigate     |   +--input bar---------------------------+      |
|                  |   | Type a message...            [Send]  |      |
|                  |   +--------------------------------------+      |
+------------------+-----------------------------------------------+
|                  |                          |                      |
|   Lab Notebook   |   Prompt Development     |   Prompt Testing     |
|   (scrollable    |   (form + preview)       |   (results grid +    |
|    markdown)     |                          |    variance meter)   |
|                  |                          |                      |
+------------------+--------------------------+----------------------+
```

All panels resizable via react-resizable-panels. Bottom row collapsible.

### 4.2 Component Tree

```
App
├── Header
│   ├── SessionInfo
│   └── BranchSelector (dropdown)
├── PanelLayout (react-resizable-panels)
│   ├── TopRow (horizontal split)
│   │   ├── TreeView (d3 conversation tree visualization)
│   │   │   └── TreeNode (interactive, click to navigate)
│   │   └── ConversationPane
│   │       ├── MessageList
│   │       │   └── Message (role, content, thinking toggle, flag button)
│   │       │       ├── FlagButton
│   │       │       └── BranchIndicator
│   │       └── InputBar
│   └── BottomRow (horizontal split, collapsible)
│       ├── NotebookPane
│       │   └── NotebookEntryList
│       │       └── NotebookEntryCard
│       ├── PromptDevPane
│       │   ├── PromptForm (system prompt, user prompt, expected, failure)
│       │   └── PromptPreview
│       └── PromptTestPane
│           ├── TestControls (n slider, run button)
│           ├── ResultsGrid (completion cards, color-coded caught/missed)
│           └── VarianceMeter (visual: 0% = useless, 50% = ideal, 100% = useless)
└── WebSocketProvider (context, manages connection + reconnect)
```

### 4.3 Artifact Pane (stretch goal)

Rendered as an additional panel or popout. Embeds reveal.js iframe pointing at artifact file served by the backend. Not in initial build — the core five panes come first.

---

## 5. File Ownership

To prevent collisions between parallel agents:

```
/projects/workspace/
├── DESIGN.md                    ← shared reference (read-only during build)
├── AGENTS.md                    ← Rook only
├── lab_notebook.md              ← Rook only
│
├── backend/                     ← BACKEND AGENT
│   ├── main.py                  ← FastAPI app, WebSocket handler
│   ├── models.py                ← Pydantic models (from §1)
│   ├── session_manager.py       ← grok stdio subprocess management
│   ├── conversation_tree.py     ← tree data model + operations
│   ├── notebook_store.py        ← notebook read/write
│   ├── prompt_store.py          ← prompt CRUD + test execution
│   ├── requirements.txt
│   └── tests/
│
├── frontend/                    ← FRONTEND AGENT
│   ├── src/
│   │   ├── App.tsx
│   │   ├── components/
│   │   │   ├── layout/          ← PanelLayout, Header
│   │   │   ├── conversation/    ← ConversationPane, MessageList, Message, InputBar
│   │   │   ├── tree/            ← TreeView (d3)
│   │   │   ├── notebook/        ← NotebookPane
│   │   │   ├── prompt/          ← PromptDevPane, PromptTestPane
│   │   │   └── common/          ← shared UI components
│   │   ├── hooks/
│   │   │   └── useWebSocket.ts  ← WebSocket connection + message routing
│   │   ├── types/
│   │   │   └── index.ts         ← TypeScript interfaces (from §1)
│   │   └── stores/
│   │       └── arenaStore.ts    ← state management (zustand or context)
│   ├── package.json
│   └── vite.config.ts
│
└── data/                        ← DATA AGENT
    ├── parse_updates_jsonl.py   ← transform updates.jsonl → ConversationTree JSON
    ├── sample_tree.json         ← pre-parsed sample data for demo
    ├── sample_notebook.json     ← pre-parsed notebook data
    └── raw/                     ← raw session data from sixel-comms
```

---

## 6. Integration Checklist

When the three workstreams converge:

- [ ] Frontend connects to backend WebSocket at ws://localhost:8000/ws
- [ ] `state.sync` on connect returns full tree + notebook + prompts
- [ ] Sending a message via `conversation.send` produces streaming chunks
- [ ] Tree visualization updates when new nodes/branches are created
- [ ] Flagging a message persists and appears in prompt dev pane
- [ ] Prompt testing fires n completions and streams results
- [ ] Sample data loads on startup for demo mode
- [ ] Notebook pane renders entries and updates on push

---

## 7. Demo Mode vs Live Mode

**Demo mode** (for hackathon presentation): loads pre-parsed sample data from `data/sample_tree.json`. Navigation, flagging, prompt development, and prompt testing all work against this data. No live `grok agent stdio` process needed.

**Live mode** (full system): manages a real `grok agent stdio` subprocess. Streams responses in real-time. Creates branches by forking sessions. This is the target architecture but demo mode ships first.

Both modes use the same frontend. The backend switches data source based on configuration.

---

## 8. Sequence: What Gets Built First

1. **Backend skeleton** — FastAPI app, WebSocket handler, REST endpoints returning mock data, Pydantic models
2. **Frontend skeleton** — Vite + React scaffold, panel layout, WebSocket hook, type definitions
3. **Data parsing** — transform sample updates.jsonl into ConversationTree JSON
4. **Conversation pane** — message list rendering from sample data, input bar (demo: no-op or echo)
5. **Tree visualization** — d3 interactive tree from sample data, click to navigate
6. **Flagging** — flag button on messages, flag list
7. **Prompt development** — form to craft prompt from flagged node
8. **Prompt testing** — fire prompt n times, stream results, display variance
9. **Notebook pane** — render notebook entries
10. **Integration** — connect frontend to real backend, live streaming
11. **Polish** — styling, animations, responsive layout, error states
12. **Artifact pane** — reveal.js embed (stretch)
