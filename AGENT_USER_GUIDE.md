# Socratic Arena -- Agent User Guide

This guide is for agents who will **use** Socratic Arena (SA) as their workspace with a human mentor. You don't need to understand the codebase -- just how to work through it.

## What SA Is

SA is a shared workspace where you and a human collaborate in real time. It runs in a browser. You communicate through it the same way you communicate through IRC or TUI -- via your asdaaas adapter inbox/outbox.

The human sees: a conversation pane, your lab notebook, session history, flagged moments, and optionally hosted applications (browsers, terminals, editors).

You see: messages arriving as doorbells from the `arena` adapter.

## Setup

SA connects to you through the **arena adapter** (`arena_adapter.py`). Your asdaaas operator starts it. Once running:

1. Set your gaze to arena:
   ```json
   {"action": "gaze", "adapter": "arena", "room": "arena"}
   ```

2. Your stdout goes to the SA conversation pane. Messages from the human arrive as arena adapter doorbells.

3. That's it. You talk normally. The adapter handles routing.

## What the Human Sees

| Pane | Content |
|------|---------|
| **Conversation** | Your live responses, streamed in real time as you generate them |
| **History** | Full session history with search. Can view any agent's past sessions |
| **Notebook** | Your lab notebook (parsed from `lab_notebook_<name>.md`) |
| **Moments** | Messages the human has flagged for review |
| **Tree** | Visual branch map of the conversation |
| **Shared Editor** | Collaborative documents (you and the human edit simultaneously) |
| **Hosted Apps** | Browsers, terminals, or other applications you can control via Selenium/CDP |

## How Messages Flow

**Human to you:**
1. Human types in SA browser
2. Message arrives in your `adapters/arena/inbox/` as a doorbell
3. You respond naturally (stdout)

**You to human:**
1. Your stdout is captured by asdaaas
2. Routed to `adapters/arena/outbox/`
3. Arena adapter delivers to SA backend
4. Human sees your response stream in real time

## Agent Commands via WebSocket

SA's backend accepts WebSocket messages you can send through the adapter. These let you control the UI programmatically.

### Navigate the workspace
```json
{
  "type": "workspace.navigate",
  "payload": {
    "tab": "notebook",
    "scrollTo": "entry-id"
  }
}
```

Supported tabs: `conversation`, `history`, `notebook`, `moments`, `editor`, `inspector`

### Search
```json
{
  "type": "workspace.search",
  "payload": {
    "pane": "history",
    "query": "compaction"
  }
}
```

Panes: `history`, `notebook`

### Highlight text in shared editor
```json
{
  "type": "doc.highlight",
  "payload": {
    "docId": "doc-id",
    "ranges": [{"from": 0, "to": 50, "color": "blue"}]
  }
}
```

## Hosted Application Panels

SA can host X11 applications (Chrome, terminals, file managers) in panels. The human sees the app visually via Xpra. You control it programmatically.

### Launch a panel (via REST API)
```
POST /api/panel/launch
{"preset": "chrome", "url": "https://example.com"}
```

Presets: `chrome` (web browser), `terminal` (xterm), `files` (file manager)

### Control Chrome via Selenium
When a Chrome panel launches, it gets a CDP port (93xx). Use Selenium to interact:
```python
from selenium import webdriver
from selenium.webdriver.chrome.options import Options
opts = Options()
opts.add_experimental_option("debuggerAddress", f"127.0.0.1:{cdp_port}")
driver = webdriver.Chrome(options=opts)
```

The human sees your actions in real time in their panel.

## REST API (useful endpoints)

| Endpoint | Purpose |
|----------|---------|
| `GET /api/agents` | List available agents |
| `GET /api/agent/context` | Your context usage (%) |
| `GET /api/agent/{name}/notebook` | Fetch notebook content |
| `GET /api/agent/{name}/history` | Fetch session history |
| `GET /api/agent/{name}/history/search?q=term` | Search session history |
| `GET /api/agent/{name}/notebook/search?q=term` | Search notebook |
| `GET /api/panel/list` | List active hosted app panels |
| `POST /api/panel/launch` | Launch a hosted app |
| `DELETE /api/panel/{id}` | Stop a hosted app |
| `GET /api/health` | Backend health check |

The backend runs on port 8000 by default.

## Flags and Moments

The human can **flag** any message in the conversation. Flagged messages become "moments" -- points where they want to note something (a correction, an observation, a question).

You'll see flags in the conversation as they happen. You can also flag messages yourself via the API:
```
POST /api/agent/action
{"action": "flag", "nodeId": "node-id", "text": "reason"}
```

## What You Don't Need to Worry About

- **Frontend code**: SA's React app is not your concern
- **LiveTailer**: Streams your session data to the UI automatically
- **Streaming**: Your responses stream to the human in real time without any action from you
- **Persistence**: Arena chat survives backend restarts (saved to `arena_chat.jsonl`)
- **History loading**: The human can browse your full session history; it loads lazily

## Tips

1. **Write your lab notebook consistently.** The human can see it in real time.
2. **Use gaze commands** to switch between arena and other adapters as needed.
3. **Your tool calls are visible.** SA shows tool call names as badges on your messages. The human can see what you're doing.
4. **The human can view any agent.** SA supports multi-agent switching. The human may be looking at a sibling's session, not yours.
5. **Hosted apps are shared.** When you control a Chrome panel via Selenium, the human sees every action live.

## Launching SA

If you need to start SA yourself:
```bash
cd ~/projects/socratic-arena && bash launch.sh start
```

This starts the backend (port 8000), frontend (port 5173), and arena adapter. Stop with `bash launch.sh stop`.

The arena adapter can also run standalone:
```bash
python3 backend/arena_adapter.py --agent <YourName> --arena-url http://localhost:8000
```